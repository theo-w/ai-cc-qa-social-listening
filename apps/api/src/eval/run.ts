/**
 * 评测器：对 data/ 金标数据集回放规则引擎，计算 007 规范定义的指标。
 *
 * 设计要点：
 * - 纯函数式回放：同一数据集 + 同一模型版本 → 指标/混淆矩阵/门禁完全一致（G-EVAL-4）。
 * - avgLatencyMs 是唯一的"物理耗时"指标：进程内按 (dataset, datasetVersion) 缓存首次实测值，
 *   避免同一服务进程内重复评测时指标漂移（runAt/durationMs 按契约允许变化）。
 * - 错例最多保留 20 条（G-EVAL-5），按数据集中出现顺序。
 */
import { performance } from 'node:perf_hooks';
import type { LoadedDatasets } from '../data.js';
import { analyzeQc } from '../engine/qc.js';
import { analyzeSentiment, buildSentimentClusters } from '../engine/sentiment.js';
import { buildKnowledgeEntries } from '../knowledge.js';
import { severityRank, singleSeverityRank, TAG_MAP } from '../engine/taxonomy.js';
import type {
  AlertLevel,
  EvalMismatch,
  EvalRun,
  QcDatasetItem,
  QcTag,
  SentimentDatasetItem,
  SingleSeverity,
} from '../types.js';
import { dateKey, ratio, realNow, round } from '../util/time.js';

export interface EvaluationResult
  extends Pick<
    EvalRun,
    'dataset' | 'datasetId' | 'datasetVersion' | 'modelVersion' | 'metrics' | 'confusion' | 'mismatches' | 'thresholdsMet' | 'summary'
  > {
  durationMs: number;
  runAt: string;
  tagPrecision?: Record<string, number>;
}

/** 实测平均耗时缓存：键 = dataset:datasetVersion，保证同进程内重复评测指标稳定。 */
const latencyCache = new Map<string, number>();

function cachedLatency(key: string, measuredMs: number): number {
  const cached = latencyCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const value = round(measuredMs, 2);
  latencyCache.set(key, value);
  return value;
}

/* ------------------------------ 质检评测 ------------------------------ */

/** 预测主标签：权重最高（同权重按严重级别、再按字典序）的标签。 */
function predictedPrimaryTag(tags: readonly QcTag[]): string | null {
  if (tags.length === 0) {
    return null;
  }
  const sorted = [...tags].sort((left, right) => {
    const weightDiff = TAG_MAP[right.code].weight - TAG_MAP[left.code].weight;
    if (weightDiff !== 0) {
      return weightDiff;
    }
    const severityDiff = severityRank(right.severity) - severityRank(left.severity);
    if (severityDiff !== 0) {
      return severityDiff;
    }
    return left.code < right.code ? -1 : left.code > right.code ? 1 : 0;
  });
  return sorted[0]?.code ?? null;
}

function qcExpectedPrimary(item: QcDatasetItem): string | null {
  if (item.labels.primaryTag !== null) {
    return item.labels.primaryTag;
  }
  return item.labels.tags[0] ?? null;
}

function qcItemCorrect(item: QcDatasetItem, predictedTags: readonly QcTag[], predictedVerdict: string): boolean {
  if (item.labels.verdict !== predictedVerdict) {
    return false;
  }
  if (item.labels.verdict === 'pass') {
    return true;
  }
  return qcExpectedPrimary(item) === predictedPrimaryTag(predictedTags);
}

function buildQcMismatch(
  item: QcDatasetItem,
  predictedVerdict: string,
  predictedPrimary: string | null,
  predictedTags: readonly QcTag[],
): EvalMismatch | null {
  const expected = `${item.labels.verdict}${item.labels.verdict === 'violation' ? `:${qcExpectedPrimary(item) ?? '-'}` : ''}`;
  const predicted = `${predictedVerdict}${predictedVerdict === 'violation' ? `:${predictedPrimary ?? '-'}` : ''}`;
  if (item.labels.verdict !== predictedVerdict) {
    return {
      itemId: item.id,
      expected,
      predicted,
      reason: `判定不一致：金标 ${item.labels.verdict}，引擎 ${predictedVerdict}`,
    };
  }
  if (item.labels.verdict === 'pass') {
    return null;
  }
  const expectedTags = [...item.labels.tags].sort();
  const engineTags = predictedTags.map((tag) => tag.code).sort();
  if (qcExpectedPrimary(item) !== predictedPrimary) {
    return {
      itemId: item.id,
      expected,
      predicted,
      reason: `主标签不一致：金标 ${qcExpectedPrimary(item) ?? '-'}，引擎 ${predictedPrimary ?? '-'}；金标标签 [${expectedTags.join(', ')}]，引擎标签 [${engineTags.join(', ')}]`,
    };
  }
  if (expectedTags.join(',') !== engineTags.join(',')) {
    return {
      itemId: item.id,
      expected,
      predicted,
      reason: `标签集合不一致：金标 [${expectedTags.join(', ')}]，引擎 [${engineTags.join(', ')}]（主标签一致，判定一致）`,
    };
  }
  return null;
}

function evaluateQc(datasets: LoadedDatasets): EvaluationResult {
  const items = datasets.qc.items;
  const knowledgeEntries = buildKnowledgeEntries(datasets.knowledge.entries);
  const startedAtMs = performance.now();

  let evaluated = 0;
  let verdictMatches = 0;
  let correct = 0;
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  let needsReviewCount = 0;

  const tagStats = new Map<string, { predicted: number; correct: number }>();
  const mismatches: EvalMismatch[] = [];

  for (const item of items) {
    const analysis = analyzeQc(item.messages, knowledgeEntries);
    evaluated += 1;
    const predictedVerdict = analysis.verdict;
    const predictedPrimary = predictedPrimaryTag(analysis.tags);

    if (analysis.needsReview) {
      needsReviewCount += 1;
    }
    if (item.labels.verdict === predictedVerdict) {
      verdictMatches += 1;
    }
    if (qcItemCorrect(item, analysis.tags, predictedVerdict)) {
      correct += 1;
    }

    if (item.labels.verdict === 'violation' && predictedVerdict === 'violation') {
      tp += 1;
    } else if (item.labels.verdict === 'pass' && predictedVerdict === 'violation') {
      fp += 1;
    } else if (item.labels.verdict === 'pass' && predictedVerdict === 'pass') {
      tn += 1;
    } else {
      fn += 1;
    }

    for (const tag of analysis.tags) {
      const stats = tagStats.get(tag.code) ?? { predicted: 0, correct: 0 };
      stats.predicted += 1;
      if (item.labels.tags.includes(tag.code)) {
        stats.correct += 1;
      }
      tagStats.set(tag.code, stats);
    }

    const mismatch = buildQcMismatch(item, predictedVerdict, predictedPrimary, analysis.tags);
    if (mismatch && mismatches.length < 20) {
      mismatches.push(mismatch);
    }
  }

  const durationMs = Math.round(performance.now() - startedAtMs);
  const avgLatencyMs = cachedLatency(`qc:${datasets.qc.version}:${datasets.datasetStamp}`, durationMs / Math.max(evaluated, 1));

  const total = items.length;
  const coverage = ratio(evaluated, total, 4);
  const accuracy = ratio(correct, total, 4);
  const verdictAccuracy = ratio(verdictMatches, total, 4);
  const falsePositiveRate = ratio(fp, tp + fp, 4);
  const falseNegativeRate = ratio(fn, tp + fn, 4);
  const reviewRatio = ratio(needsReviewCount, evaluated, 4);

  const tagPrecision: Record<string, number> = {};
  let precisionSum = 0;
  let precisionTags = 0;
  for (const [code, stats] of [...tagStats.entries()].sort(([left], [right]) => (left < right ? -1 : 1))) {
    const value = ratio(stats.correct, stats.predicted, 4);
    tagPrecision[code] = value;
    precisionSum += value;
    precisionTags += 1;
  }
  const tagPrecisionMacro = ratio(precisionSum, precisionTags, 4);

  const metrics: Record<string, number | Record<string, number>> = {
    coverage,
    accuracy,
    verdictAccuracy,
    falsePositiveRate,
    falseNegativeRate,
    reviewRatio,
    avgLatencyMs,
    tagPrecisionMacro,
    tagPrecision,
  };
  const thresholdsMet: Record<string, boolean> = {
    accuracy: accuracy >= 0.8,
    falsePositiveRate: falsePositiveRate <= 0.15,
    falseNegativeRate: falseNegativeRate <= 0.2,
    reviewRatio: reviewRatio <= 0.3,
  };
  const gated = thresholdsMet.accuracy === true && thresholdsMet.falsePositiveRate === true && thresholdsMet.falseNegativeRate === true;

  const summary = [
    `质检评测：共 ${total} 条，覆盖 ${evaluated} 条（覆盖率 ${(coverage * 100).toFixed(1)}%）。`,
    `判定一致率 ${(accuracy * 100).toFixed(1)}%（阈值 ≥80%），verdict 一致率 ${(verdictAccuracy * 100).toFixed(1)}%。`,
    `误报率 ${(falsePositiveRate * 100).toFixed(1)}%（阈值 ≤15%），漏报率 ${(falseNegativeRate * 100).toFixed(1)}%（阈值 ≤20%），复核占比 ${(reviewRatio * 100).toFixed(1)}%。`,
    `平均耗时 ${avgLatencyMs.toFixed(2)}ms/条；门禁 G-EVAL-1 ${gated ? '通过' : '未通过'}。`,
  ].join('');

  return {
    dataset: 'qc',
    datasetId: datasets.qc.datasetId || datasets.manifest.datasets.qc.datasetId,
    datasetVersion: datasets.qc.version || datasets.manifest.datasets.qc.version,
    modelVersion: '',
    metrics,
    confusion: { tp, fp, tn, fn },
    mismatches,
    thresholdsMet,
    summary,
    durationMs,
    runAt: realNow(),
    tagPrecision,
  };
}

/* ------------------------------ 舆情评测 ------------------------------ */

interface ClusterExpectation {
  topic: string;
  date: string;
  level: AlertLevel;
}

function aggregateLevelFor(negativeCount: number): AlertLevel | null {
  if (negativeCount >= 8) {
    return 'P0';
  }
  if (negativeCount >= 3) {
    return 'P1';
  }
  if (negativeCount >= 1) {
    return 'P2';
  }
  return null;
}

function maxLevel(left: AlertLevel | null, right: AlertLevel | null): AlertLevel | null {
  if (left === null) {
    return right;
  }
  if (right === null) {
    return left;
  }
  const rank = (level: AlertLevel): number => (level === 'P0' ? 3 : level === 'P1' ? 2 : 1);
  return rank(left) >= rank(right) ? left : right;
}

function expectedSingleLevel(item: SentimentDatasetItem): AlertLevel | null {
  const level = item.labels.expectedLevel;
  return level === 'P0' || level === 'P1' || level === 'P2' ? level : null;
}

function buildExpectedAlerts(items: readonly SentimentDatasetItem[]): Map<string, ClusterExpectation> {
  interface Acc {
    topic: string;
    date: string;
    single: AlertLevel | null;
    negative: number;
  }
  const grouped = new Map<string, Acc>();
  for (const item of items) {
    const topic = item.labels.primaryTopic;
    const date = dateKey(item.publishedAt);
    const key = `${topic}|${date}`;
    const acc = grouped.get(key) ?? { topic, date, single: null, negative: 0 };
    acc.single = maxLevel(acc.single, expectedSingleLevel(item));
    if (item.labels.sentiment === 'negative') {
      acc.negative += 1;
    }
    grouped.set(key, acc);
  }
  const expected = new Map<string, ClusterExpectation>();
  for (const [key, acc] of grouped) {
    const level = maxLevel(acc.single, aggregateLevelFor(acc.negative));
    if (level !== null) {
      expected.set(key, { topic: acc.topic, date: acc.date, level });
    }
  }
  return expected;
}

function evaluateSentiment(datasets: LoadedDatasets): EvaluationResult {
  const items = datasets.sentiment.items;
  const startedAtMs = performance.now();

  const analyzed = items.map((item) => ({
    item,
    analysis: analyzeSentiment({ text: item.text }),
  }));

  const durationMs = Math.round(performance.now() - startedAtMs);
  const avgLatencyMs = cachedLatency(
    `sentiment:${datasets.sentiment.version}:${datasets.datasetStamp}`,
    durationMs / Math.max(items.length, 1),
  );

  let sentimentCorrect = 0;
  let topicCorrect = 0;
  let needsReviewCount = 0;
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  const mismatches: EvalMismatch[] = [];

  for (const { item, analysis } of analyzed) {
    if (analysis.sentiment === item.labels.sentiment) {
      sentimentCorrect += 1;
    }
    if (analysis.primaryTopic === item.labels.primaryTopic) {
      topicCorrect += 1;
    }
    if (analysis.needsReview) {
      needsReviewCount += 1;
    }
    const expectedNegative = item.labels.sentiment === 'negative';
    const predictedNegative = analysis.sentiment === 'negative';
    if (expectedNegative && predictedNegative) {
      tp += 1;
    } else if (!expectedNegative && predictedNegative) {
      fp += 1;
    } else if (!expectedNegative && !predictedNegative) {
      tn += 1;
    } else {
      fn += 1;
    }

    if (mismatches.length < 20) {
      if (analysis.sentiment !== item.labels.sentiment) {
        mismatches.push({
          itemId: item.id,
          expected: item.labels.sentiment,
          predicted: analysis.sentiment,
          reason: `情感不一致：金标 ${item.labels.sentiment}，引擎 ${analysis.sentiment}（依据：${analysis.engineRules.slice(0, 2).join('、') || '词典命中'}）`,
        });
      } else if (analysis.primaryTopic !== item.labels.primaryTopic) {
        mismatches.push({
          itemId: item.id,
          expected: `${item.labels.primaryTopic}（${item.labels.topics.join('/')}）`,
          predicted: analysis.primaryTopic,
          reason: `主题不一致：金标主主题 ${item.labels.primaryTopic}，引擎主主题 ${analysis.primaryTopic}`,
        });
      } else if (analysis.severity !== (item.labels.expectedLevel === 'none' ? 'none' : (item.labels.expectedLevel.toLowerCase() as SingleSeverity))) {
        mismatches.push({
          itemId: item.id,
          expected: item.labels.expectedLevel,
          predicted: analysis.severity,
          reason: `单条级别不一致：金标 ${item.labels.expectedLevel}，引擎 ${analysis.severity}`,
        });
      }
    }
  }

  const total = items.length;
  const sentimentAccuracy = ratio(sentimentCorrect, total, 4);
  const topicAccuracy = ratio(topicCorrect, total, 4);
  const reviewRatio = ratio(needsReviewCount, total, 4);

  // 预警回放：按预测 primaryTopic + 日期聚簇，与金标聚簇 (topic,date) 匹配。
  const draftClusters = buildSentimentClusters(
    analyzed.map(({ item, analysis }) => ({
      id: item.id,
      text: item.text,
      source: item.source,
      publishedAt: item.publishedAt,
      analysis,
    })),
  );
  const predictedAlerts = new Map<string, AlertLevel>();
  for (const draft of draftClusters) {
    predictedAlerts.set(`${draft.topic}|${draft.date}`, draft.level);
  }
  const expectedAlerts = buildExpectedAlerts(items);

  let alertTp = 0;
  let alertFp = 0;
  let alertFn = 0;
  let expectedP0 = 0;
  let matchedP0 = 0;
  const alertMismatchDetails: EvalMismatch[] = [];
  for (const [key, expected] of expectedAlerts) {
    const predictedLevel = predictedAlerts.get(key);
    if (expected.level === 'P0') {
      expectedP0 += 1;
    }
    if (predictedLevel === undefined) {
      alertFn += 1;
      if (alertMismatchDetails.length < 20) {
        alertMismatchDetails.push({
          itemId: `${expected.topic}@${expected.date}`,
          expected: expected.level,
          predicted: '无预警',
          reason: '存在金标预警簇但引擎未生成预警',
        });
      }
    } else if (predictedLevel === expected.level) {
      alertTp += 1;
      if (expected.level === 'P0') {
        matchedP0 += 1;
      }
    } else {
      alertFp += 1;
      alertFn += 1;
      if (alertMismatchDetails.length < 20) {
        alertMismatchDetails.push({
          itemId: `${expected.topic}@${expected.date}`,
          expected: expected.level,
          predicted: predictedLevel,
          reason: `聚簇级别不一致：金标 ${expected.level}，引擎 ${predictedLevel}`,
        });
      }
    }
  }
  for (const [key, level] of predictedAlerts) {
    if (!expectedAlerts.has(key)) {
      alertFp += 1;
      if (alertMismatchDetails.length < 20) {
        const [topic, date] = key.split('|');
        alertMismatchDetails.push({
          itemId: `${topic}@${date}`,
          expected: '无预警',
          predicted: level,
          reason: '引擎生成了金标不存在的预警簇',
        });
      }
    }
  }

  const alertPrecision = ratio(alertTp, alertTp + alertFp, 4);
  const alertRecall = ratio(alertTp, alertTp + alertFn, 4);
  const p0Recall = ratio(matchedP0, expectedP0, 4);

  for (const detail of alertMismatchDetails) {
    if (mismatches.length >= 20) {
      break;
    }
    mismatches.push(detail);
  }

  const metrics: Record<string, number> = {
    sentimentAccuracy,
    topicAccuracy,
    alertPrecision,
    alertRecall,
    p0Recall,
    reviewRatio,
    avgLatencyMs,
  };
  const thresholdsMet: Record<string, boolean> = {
    sentimentAccuracy: sentimentAccuracy >= 0.8,
    topicAccuracy: topicAccuracy >= 0.75,
    alertPrecision: alertPrecision >= 0.8,
    alertRecall: alertRecall >= 0.8,
  };
  const gated = thresholdsMet.sentimentAccuracy === true && thresholdsMet.topicAccuracy === true && thresholdsMet.alertPrecision === true;

  const summary = [
    `舆情评测：共 ${total} 条，情感准确率 ${(sentimentAccuracy * 100).toFixed(1)}%（阈值 ≥80%）。`,
    `主题准确率 ${(topicAccuracy * 100).toFixed(1)}%（阈值 ≥75%）；预警 precision ${(alertPrecision * 100).toFixed(1)}%（阈值 ≥80%）。`,
    `预警 recall ${(alertRecall * 100).toFixed(1)}%（展示），P0 recall ${(p0Recall * 100).toFixed(1)}%（展示），复核占比 ${(reviewRatio * 100).toFixed(1)}%。`,
    `平均耗时 ${avgLatencyMs.toFixed(2)}ms/条；门禁 G-EVAL-2 ${gated ? '通过' : '未通过'}。`,
  ].join('');

  return {
    dataset: 'sentiment',
    datasetId: datasets.sentiment.datasetId || datasets.manifest.datasets.sentiment.datasetId,
    datasetVersion: datasets.sentiment.version || datasets.manifest.datasets.sentiment.version,
    modelVersion: '',
    metrics,
    confusion: { tp, fp, tn, fn, alertTp, alertFp, alertFn },
    mismatches,
    thresholdsMet,
    summary,
    durationMs,
    runAt: realNow(),
  };
}

/** 回放指定数据集，返回除 id 之外的完整评测结果。 */
export function evaluateDataset(dataset: 'qc' | 'sentiment', datasets: LoadedDatasets): EvaluationResult {
  const result = dataset === 'qc' ? evaluateQc(datasets) : evaluateSentiment(datasets);
  return result;
}

/** 序列排序辅助：按单条级别从高到低（评测/统计共用）。 */
export function sortSeverities(severities: readonly SingleSeverity[]): SingleSeverity[] {
  return [...severities].sort((left, right) => singleSeverityRank(right) - singleSeverityRank(left));
}
