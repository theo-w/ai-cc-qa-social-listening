/** 临时调试脚本：打印误判样本，用于校准规则引擎（交付前删除）。 */
import { getDatasets } from '../datasets.js';
import { analyzeQc } from '../engine/qc.js';
import { analyzeSentiment, buildSentimentClusters } from '../engine/sentiment.js';
import { severityRank, TAG_MAP } from '../engine/taxonomy.js';
import type { TagCode } from '../types.js';

const datasets = getDatasets();

function primaryTagCode(tags: { code: string; confidence: number }[]): string | null {
  const sorted = [...tags].sort((left, right) => {
    const leftTag = TAG_MAP[left.code as TagCode];
    const rightTag = TAG_MAP[right.code as TagCode];
    const weightDiff = (rightTag?.weight ?? 0) - (leftTag?.weight ?? 0);
    if (weightDiff !== 0) {
      return weightDiff;
    }
    const severityDiff = severityRank(rightTag?.severity ?? 'low') - severityRank(leftTag?.severity ?? 'low');
    return severityDiff !== 0 ? severityDiff : left.code.localeCompare(right.code);
  });
  return sorted[0]?.code ?? null;
}

console.log('=== QC 误判 ===');
for (const item of datasets.qc.items) {
  const analysis = analyzeQc(item.messages);
  const goldVerdict = item.labels.verdict;
  const goldPrimary = item.labels.primaryTag ?? null;
  const predictedPrimary = primaryTagCode(analysis.tags);
  const verdictOk = analysis.verdict === goldVerdict;
  const tagOk = analysis.verdict === 'pass' || predictedPrimary === goldPrimary;
  if (!verdictOk || !tagOk) {
    console.log(
      `${item.id} gold=${goldVerdict}/${goldPrimary} pred=${analysis.verdict}/${predictedPrimary} tags=${analysis.tags.map((t) => t.code).join(',')} note=${item.labels.note ?? ''}`,
    );
  }
}

console.log('\n=== sentiment 误判 ===');
const commentAnalysis = datasets.sentiment.items.map((item) => ({
  item,
  analysis: analyzeSentiment({ text: item.text }),
}));
for (const { item, analysis } of commentAnalysis) {
  const goldPrimary = item.labels.primaryTopic;
  if (analysis.sentiment !== item.labels.sentiment || analysis.primaryTopic !== goldPrimary) {
    console.log(
      `${item.id} gold=${item.labels.sentiment}/${goldPrimary}/${item.labels.expectedLevel} pred=${analysis.sentiment}/${analysis.primaryTopic}/${analysis.severity} text=${item.text.slice(0, 60)}`,
    );
  }
}

console.log('\n=== 聚类 ===');
const clusters = buildSentimentClusters(
  commentAnalysis.map(({ item, analysis }) => ({
    id: item.id,
    text: item.text,
    source: item.source,
    publishedAt: item.publishedAt,
    analysis,
  })),
);
const goldClusters = new Map<string, { levels: string[]; negative: number }>();
for (const item of datasets.sentiment.items) {
  const key = `${item.labels.primaryTopic}|${item.publishedAt.slice(0, 10)}`;
  const entry = goldClusters.get(key) ?? { levels: [], negative: 0 };
  entry.levels.push(item.labels.expectedLevel);
  if (item.labels.sentiment === 'negative') {
    entry.negative += 1;
  }
  goldClusters.set(key, entry);
}
console.log('gold clusters:', goldClusters.size, 'pred clusters:', clusters.length);
for (const cluster of clusters) {
  const key = `${cluster.topic}|${cluster.date}`;
  const gold = goldClusters.get(key);
  console.log(
    `pred ${key} level=${cluster.level} neg=${cluster.negativeCount}/${cluster.totalCount} gold=${gold ? `neg=${gold.negative} levels=${gold.levels.join(',')}` : 'NONE'}`,
  );
}
