/**
 * QCC Workbench · 数据集金标校验（data.test.mjs）
 * =============================================================================
 * 不依赖 API：直接读取 data/manifest.json、data/qc/dataset.json、
 * data/sentiment/dataset.json，按 specs/004-data-model.md §7 与
 * specs/007-evaluation-spec.md §2/§5/§6 校验金标数据集的规模、配额、结构与
 * 可复算性；并 spawn `node data/scripts/generate.mjs --check` 断言生成器自检通过。
 *
 * 断言口径（Lead m00224 裁决 + 004/007）：
 *  - QC：60 条（违规 40 / 正常 20），标签配额 attitude≥8 forbidden≥8 off_topic≥7
 *    wrong_knowledge≥7 timeout≥6 escalation≥6，低置信度边界（confidence 0.60–0.74）≥10；
 *  - 舆情：120 条，按 (primaryTopic, 日期) 聚簇 12–16 个、每簇 4–12 条，
 *    簇级别 = max(单条最大级别, 聚合升级级别)（007 §5），P0≥2 / P1≥3 / P2≥3 / none≥3 簇，
 *    负面≥60、正面≥25、中性≥15、噪声≥8、来源五类齐全、日期 2026-10-20~2026-11-02。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

import {
  QC_TAG_CODES,
  REPO_ROOT,
  SENTIMENT_SOURCES,
  TOPIC_DICT,
  assertDeepEqual,
  readJsonFile,
  repoFileExists,
} from './helpers.mjs';

const QC_CHANNELS = ['online', 'ticket', 'phone'];
const QC_ROLES = ['customer', 'agent', 'system'];
const QC_VERDICTS = ['pass', 'violation'];
const SENTIMENTS = ['positive', 'neutral', 'negative'];
const LEVELS = ['P0', 'P1', 'P2', 'none'];
const LEVEL_RANK = { none: 0, P2: 1, P1: 2, P0: 3 };
const LEVEL_BY_RANK = { 0: 'none', 1: 'P2', 2: 'P1', 3: 'P0' };
const DATE_START = '2026-10-20';
const DATE_END = '2026-11-02';

// 脱敏检查：不含未打码的 11 位手机号，也不含未打码邮箱（本地部分不含 *）。
const RAW_MOBILE_PATTERN = /(?<!\d)1[3-9]\d{9}(?!\d)/;
const RAW_EMAIL_PATTERN = /(?<![*\w.+-])[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/;

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const isInteger = (value) => Number.isInteger(value);
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const parseTime = (value, label) => {
  const time = Date.parse(value);
  assert.ok(Number.isFinite(time), `${label} 应为可解析的 ISO 8601 时间，实际 ${JSON.stringify(value)}`);
  return time;
};
const dateOf = (iso) => {
  const time = Date.parse(iso);
  assert.ok(Number.isFinite(time), `发布时间不可解析：${JSON.stringify(iso)}`);
  // 数据集统一使用 +08:00 时区书写，日期取字符串前 10 位（聚合键口径 007 §5）。
  return String(iso).slice(0, 10);
};

// ---------------------------------------------------------------------------
// 载入数据集（失败时给出明确中文原因）
// ---------------------------------------------------------------------------
const manifest = readJsonFile('data/manifest.json');
const qc = readJsonFile('data/qc/dataset.json');
const sentiment = readJsonFile('data/sentiment/dataset.json');

const qcItems = qc.items;
const sentimentItems = sentiment.items;

test('数据 manifest.json：结构完整且与数据集文件一致（004 §7.2）', () => {
  assert.ok(isPlainObject(manifest), 'manifest 应为 JSON 对象');
  for (const field of ['version', 'generatedAt', 'description', 'datasets']) {
    assert.ok(field in manifest, `manifest 缺少 004 §7.2 必填字段 ${field}`);
  }
  assert.ok(isNonEmptyString(manifest.version), 'manifest.version 应为非空字符串');
  if ('datasetVersion' in manifest) {
    assert.ok(isNonEmptyString(manifest.datasetVersion), 'manifest.datasetVersion 若存在应为非空字符串（Lead m00224）');
  }
  parseTime(manifest.generatedAt, 'manifest.generatedAt');
  assert.ok(isNonEmptyString(manifest.description), 'manifest.description 应为非空字符串');
  assert.ok(isPlainObject(manifest.datasets), 'manifest.datasets 应为对象映射（004 §7.2）');
  assertDeepEqual(
    Object.keys(manifest.datasets).sort(),
    ['qc', 'sentiment'],
    'manifest.datasets 应包含 qc 与 sentiment 两个数据集',
  );

  // 数据集文件存在、itemCount 与文件实际条数一致、datasetId/version 与数据集顶层字段一致
  const loaded = { qc, sentiment };
  const counts = { qc: qcItems.length, sentiment: sentimentItems.length };
  for (const name of ['qc', 'sentiment']) {
    const entry = manifest.datasets[name];
    assert.ok(isPlainObject(entry), `manifest.datasets.${name} 应为对象`);
    assert.ok(isNonEmptyString(entry.datasetId), `manifest.datasets.${name}.datasetId 应为非空字符串`);
    assert.ok(isNonEmptyString(entry.version), `manifest.datasets.${name}.version 应为非空字符串`);
    assert.ok(isNonEmptyString(entry.file), `manifest.datasets.${name}.file 应为非空字符串`);
    assert.ok(repoFileExists(path.join('data', entry.file)), `manifest.datasets.${name}.file 指向的文件不存在：data/${entry.file}`);
    assert.equal(entry.itemCount, counts[name], `manifest.datasets.${name}.itemCount 应等于数据集实际条数`);
    assert.equal(entry.datasetId, loaded[name].datasetId, `manifest.datasets.${name}.datasetId 应与数据集文件一致`);
    assert.equal(entry.version, loaded[name].version, `manifest.datasets.${name}.version 应与数据集文件一致`);
  }
});

test('数据 QC 数据集：顶层结构与条目必填字段（004 §7.3）', () => {
  for (const field of ['datasetId', 'version', 'description', 'items']) {
    assert.ok(field in qc, `qc/dataset.json 缺少字段 ${field}`);
  }
  assert.ok(isNonEmptyString(qc.datasetId), 'qc.datasetId 应为非空字符串');
  assert.ok(isNonEmptyString(qc.version), 'qc.version 应为非空字符串');
  assert.ok(isNonEmptyString(qc.description), 'qc.description 应为非空字符串');
  assert.ok(Array.isArray(qc.items), 'qc.items 应为数组');
  assert.equal(qcItems.length, 60, 'QC 数据集应为 60 条（004 §7.3 / 007 §2.1）');

  const ids = new Set();
  for (const [index, item] of qcItems.entries()) {
    const where = `qc.items[${index}]（${item?.id ?? '无 id'}）`;
    assert.ok(isPlainObject(item), `${where} 应为对象`);
    assert.ok(isNonEmptyString(item.id), `${where}.id 应为非空字符串`);
    assert.ok(!ids.has(item.id), `${where}.id 重复：${item.id}`);
    ids.add(item.id);
    assert.ok(QC_CHANNELS.includes(item.channel), `${where}.channel 应为 ${QC_CHANNELS.join('|')}`);
    assert.ok(isNonEmptyString(item.product), `${where}.product 应为非空字符串`);
    assert.ok(isPlainObject(item.agent), `${where}.agent 应为对象`);
    assert.ok(isNonEmptyString(item.agent.id), `${where}.agent.id 应为非空字符串`);
    assert.ok(isNonEmptyString(item.agent.name), `${where}.agent.name 应为非空字符串`);
    assert.ok(isPlainObject(item.customer), `${where}.customer 应为对象`);
    assert.ok(isNonEmptyString(item.customer.id), `${where}.customer.id 应为非空字符串`);
    assert.ok(isNonEmptyString(item.customer.name), `${where}.customer.name 应为非空字符串`);
    const startedAt = parseTime(item.startedAt, `${where}.startedAt`);
    assert.ok(isInteger(item.durationSec) && item.durationSec > 0, `${where}.durationSec 应为正整数`);
    assert.ok(Array.isArray(item.messages), `${where}.messages 应为数组`);
    assert.ok(
      item.messages.length >= 4 && item.messages.length <= 14,
      `${where}.messages 条数应为 4–14，实际 ${item.messages.length}`,
    );
    assert.ok(isPlainObject(item.labels), `${where}.labels 应为对象`);

    // 时间范围：2026-10-20 ~ 2026-11-02（004 §7.3 / 007 §2）
    assert.ok(
      startedAt >= Date.parse(`${DATE_START}T00:00:00+08:00`) && startedAt < Date.parse('2026-11-03T00:00:00+08:00'),
      `${where}.startedAt 应落在 ${DATE_START}~${DATE_END}，实际 ${item.startedAt}`,
    );

    // 消息结构：seq 从 1 连续、atSec 严格递增、gapSec 与相邻差值一致、role 合法、text 非空
    let previousAtSec = null;
    for (const [msgIndex, message] of item.messages.entries()) {
      const msgWhere = `${where}.messages[${msgIndex}]`;
      assert.ok(isPlainObject(message), `${msgWhere} 应为对象`);
      assert.equal(message.seq, msgIndex + 1, `${msgWhere}.seq 应从 1 连续递增`);
      assert.ok(QC_ROLES.includes(message.role), `${msgWhere}.role 应为 ${QC_ROLES.join('|')}`);
      assert.ok(isNonEmptyString(message.text), `${msgWhere}.text 应为非空字符串`);
      assert.ok(isInteger(message.atSec) && message.atSec >= 0, `${msgWhere}.atSec 应为非负整数`);
      if (previousAtSec !== null) {
        assert.ok(message.atSec > previousAtSec, `${msgWhere}.atSec 应严格递增`);
        if ('gapSec' in message) {
          assert.equal(message.gapSec, message.atSec - previousAtSec, `${msgWhere}.gapSec 应等于与上一条 atSec 的差值`);
        }
      } else if ('gapSec' in message) {
        assert.equal(message.gapSec, 0, `${msgWhere}.gapSec 首条应为 0`);
      }
      previousAtSec = message.atSec;
    }
  }

  // 覆盖度：三渠道全覆盖、≥4 名坐席、≥3 个产品、≥10 个不同日期（004 §7.3）
  assertDeepEqual(
    [...new Set(qcItems.map((item) => item.channel))].sort(),
    [...QC_CHANNELS].sort(),
    'QC 数据集应覆盖 online/ticket/phone 三渠道',
  );
  assert.ok(new Set(qcItems.map((item) => item.agent.name)).size >= 4, 'QC 数据集应覆盖 ≥4 名坐席');
  assert.ok(new Set(qcItems.map((item) => item.product)).size >= 3, 'QC 数据集应覆盖 ≥3 个产品');
  assert.ok(
    new Set(qcItems.map((item) => dateOf(item.startedAt))).size >= 10,
    'QC 数据集应覆盖 ≥10 个不同日期',
  );
});

test('数据 QC 金标：verdict/tags/primaryTag 一致，pass 无标签（004 §7.3）', () => {
  let passCount = 0;
  let violationCount = 0;
  const tagHits = Object.fromEntries(QC_TAG_CODES.map((code) => [code, 0]));

  for (const [index, item] of qcItems.entries()) {
    const labels = item.labels;
    const where = `qc.items[${index}]（${item.id}）.labels`;
    assert.ok(QC_VERDICTS.includes(labels.verdict), `${where}.verdict 应为 pass|violation`);
    assert.ok(Array.isArray(labels.tags), `${where}.tags 应为 string[]（tags 为标签 code 数组，Lead m00039）`);
    assert.ok(isNonEmptyString(labels.note), `${where}.note 应为非空字符串`);

    const seen = new Set();
    for (const code of labels.tags) {
      assert.ok(QC_TAG_CODES.includes(code), `${where}.tags 含非法标签 code：${JSON.stringify(code)}`);
      assert.ok(!seen.has(code), `${where}.tags 不应重复：${code}`);
      seen.add(code);
      tagHits[code] += 1;
    }

    if (labels.verdict === 'violation') {
      violationCount += 1;
      assert.ok(labels.tags.length >= 1, `${where}：verdict=violation 时 tags 应至少 1 个（BR-02）`);
      assert.ok(isNonEmptyString(labels.primaryTag), `${where}：verdict=violation 时 primaryTag 应非空`);
      assert.ok(labels.tags.includes(labels.primaryTag), `${where}：primaryTag 应属于 tags（004 §7.3）`);
    } else {
      passCount += 1;
      assertDeepEqual(labels.tags, [], `${where}：verdict=pass 时 tags 应为空（004 §7.3）`);
      assert.ok(labels.primaryTag === null || labels.primaryTag === undefined, `${where}：verdict=pass 时 primaryTag 应为空`);
    }
  }

  assert.equal(qcItems.length, passCount + violationCount, 'QC 数据集 verdict 应完整二分');
  assert.equal(passCount, 20, 'QC 金标正常对话应为 20 条（007 §2.1）');
  assert.equal(violationCount, 40, 'QC 金标违规对话应为 40 条（007 §2.1）');

  // 标签配额（004 §7.3，按标签实例计数，多标签重复计数）
  const minimums = { attitude: 8, forbidden: 8, off_topic: 7, wrong_knowledge: 7, timeout: 6, escalation: 6 };
  for (const [code, minimum] of Object.entries(minimums)) {
    assert.ok(tagHits[code] >= minimum, `标签 ${code} 命中数应 ≥${minimum}（004 §7.3），实际 ${tagHits[code]}`);
  }
});

test('数据 QC 低置信度边界样本可机械校验：confidence 0.60–0.74 ≥10（evaluation checklist）', () => {
  let needsReviewCount = 0;
  let boundaryCount = 0;
  let lowConfidenceCount = 0;
  for (const [index, item] of qcItems.entries()) {
    const labels = item.labels;
    const where = `qc.items[${index}]（${item.id}）.labels`;
    assert.ok(typeof labels.confidence === 'number', `${where}.confidence 应为 number（低置信度边界样本可机械校验）`);
    assert.ok(labels.confidence >= 0 && labels.confidence <= 1, `${where}.confidence 应落在 [0,1]`);
    if (labels.needsReview === true) needsReviewCount += 1;
    if (labels.confidence < 0.75) lowConfidenceCount += 1;
    if (labels.confidence >= 0.6 && labels.confidence <= 0.74) boundaryCount += 1;
  }
  assert.ok(needsReviewCount >= 10, `低置信度/边界样本 needsReview=true 应 ≥10（004 §7.3），实际 ${needsReviewCount}`);
  assert.ok(
    boundaryCount >= 10,
    `confidence 落在 0.60–0.74 的边界样本应 ≥10（specs/checklists/evaluation.md），实际 ${boundaryCount}`,
  );
  // 生成器自检口径：needsReview=true 即低置信度（confidence<0.75）样本（004 §7.3 / FR-QC-005）
  assert.equal(
    needsReviewCount,
    lowConfidenceCount,
    'needsReview=true 的样本数与 confidence<0.75 的样本数应一致（金标自洽）',
  );
});

test('数据 QC 标签证据可定位：evidenceSeq 存在且 quote 来自原文（FR-QC-003 / TEST-QC-EVID-01）', () => {
  for (const [index, item] of qcItems.entries()) {
    const where = `qc.items[${index}]（${item.id}）`;
    if (!Array.isArray(item.labels.tagEvidence)) continue;
    const messageBySeq = new Map(item.messages.map((message) => [message.seq, message.text]));
    // 扩展字段 tagEvidence 提供每个标签的定位证据
    for (const evidence of item.labels.tagEvidence) {
      assert.ok(isPlainObject(evidence), `${where}.labels.tagEvidence 条目应为对象`);
      assert.ok(QC_TAG_CODES.includes(evidence.code), `${where}.tagEvidence.code 应为合法标签，实际 ${JSON.stringify(evidence.code)}`);
      assert.ok(
        item.labels.tags.includes(evidence.code),
        `${where}.tagEvidence.code=${evidence.code} 应属于 labels.tags`,
      );
      assert.ok(messageBySeq.has(evidence.evidenceSeq), `${where}.tagEvidence（${evidence.code}）.evidenceSeq 应指向存在的消息`);
      assert.ok(isNonEmptyString(evidence.quote), `${where}.tagEvidence（${evidence.code}）.quote 应为非空字符串`);
      assert.ok(
        messageBySeq.get(evidence.evidenceSeq).includes(evidence.quote),
        `${where}.tagEvidence（${evidence.code}）.quote 应为 seq=${evidence.evidenceSeq} 消息原文的子串`,
      );
    }
  }
});

test('数据 QC 文本已脱敏：不含未打码手机号/邮箱（FR-QC-010 原文只存在于 data/）', () => {
  for (const item of qcItems) {
    for (const message of item.messages) {
      assert.ok(
        !RAW_MOBILE_PATTERN.test(message.text),
        `qc ${item.id} 的对话文本含未打码手机号：${JSON.stringify(message.text)}`,
      );
      assert.ok(
        !RAW_EMAIL_PATTERN.test(message.text),
        `qc ${item.id} 的对话文本含未打码邮箱：${JSON.stringify(message.text)}`,
      );
    }
  }
});

test('数据舆情数据集：顶层结构与条目必填字段（004 §7.4 / FR-SEN-001）', () => {
  for (const field of ['datasetId', 'version', 'description', 'items']) {
    assert.ok(field in sentiment, `sentiment/dataset.json 缺少字段 ${field}`);
  }
  assert.ok(isNonEmptyString(sentiment.datasetId), 'sentiment.datasetId 应为非空字符串');
  assert.ok(isNonEmptyString(sentiment.version), 'sentiment.version 应为非空字符串');
  assert.ok(Array.isArray(sentiment.items), 'sentiment.items 应为数组');
  assert.equal(sentimentItems.length, 120, '舆情数据集应为 120 条（004 §7.4 / 007 §2.1）');

  const ids = new Set();
  for (const [index, item] of sentimentItems.entries()) {
    const where = `sentiment.items[${index}]（${item?.id ?? '无 id'}）`;
    assert.ok(isPlainObject(item), `${where} 应为对象`);
    assert.ok(isNonEmptyString(item.id), `${where}.id 应为非空字符串`);
    assert.ok(!ids.has(item.id), `${where}.id 重复：${item.id}`);
    ids.add(item.id);
    assert.ok(SENTIMENT_SOURCES.includes(item.source), `${where}.source 应为 ${SENTIMENT_SOURCES.join('|')}`);
    assert.ok(isNonEmptyString(item.brand), `${where}.brand 应为非空字符串`);
    assert.ok(isNonEmptyString(item.author), `${where}.author 应为非空字符串`);
    assert.ok(isNonEmptyString(item.text), `${where}.text 应为非空字符串`);
    const publishedAt = parseTime(item.publishedAt, `${where}.publishedAt`);
    const publishedDate = dateOf(item.publishedAt);
    assert.ok(
      publishedDate >= DATE_START && publishedDate <= DATE_END,
      `${where}.publishedAt 日期应落在 ${DATE_START}~${DATE_END}，实际 ${item.publishedAt}`,
    );
    assert.ok(publishedAt > 0, `${where}.publishedAt 应有效`);

    const labels = item.labels;
    assert.ok(isPlainObject(labels), `${where}.labels 应为对象`);
    assert.ok(SENTIMENTS.includes(labels.sentiment), `${where}.labels.sentiment 应为 ${SENTIMENTS.join('|')}`);
    assert.ok(
      typeof labels.sentimentScore === 'number' && labels.sentimentScore >= -1 && labels.sentimentScore <= 1,
      `${where}.labels.sentimentScore 应为 [-1,1] 数值`,
    );
    assert.ok(Array.isArray(labels.topics), `${where}.labels.topics 应为数组`);
    assert.ok(labels.topics.length >= 1 && labels.topics.length <= 3, `${where}.labels.topics 应为 1–3 个主题`);
    assert.ok(new Set(labels.topics).size === labels.topics.length, `${where}.labels.topics 不应重复`);
    for (const topic of labels.topics) {
      assert.ok(TOPIC_DICT.includes(topic), `${where}.labels.topics 含非法主题：${JSON.stringify(topic)}`);
    }
    assert.ok(TOPIC_DICT.includes(labels.primaryTopic), `${where}.labels.primaryTopic 应为 7 主题之一`);
    assert.ok(labels.topics.includes(labels.primaryTopic), `${where}.labels.primaryTopic 应属于 topics`);
    assert.ok(LEVELS.includes(labels.expectedLevel), `${where}.labels.expectedLevel 应为 P0|P1|P2|none`);
    assert.equal(typeof labels.noise, 'boolean', `${where}.labels.noise 应为布尔值（Lead m00039）`);
    assert.ok(isNonEmptyString(labels.note), `${where}.labels.note 应为非空字符串`);
    if (labels.noise === true) {
      assert.equal(labels.expectedLevel, 'none', `${where}：noise=true 时 expectedLevel 应为 none（007 §6.1）`);
      assert.equal(labels.sentiment, 'neutral', `${where}：噪声评论应为中性情绪（007 §6.1）`);
    }
    // 扩展字段 severity 若存在，应与 expectedLevel 小写一致（生成器自检 SE-19）
    if ('severity' in labels) {
      assert.equal(
        String(labels.severity).toLowerCase(),
        labels.expectedLevel.toLowerCase(),
        `${where}.labels.severity 应与 expectedLevel 对应（小写）`,
      );
    }
  }
});

test('数据舆情全局配额：负面≥60、正面≥25、中性≥15、噪声≥8、五来源齐全（004 §7.4 / checklist）', () => {
  const countBy = (field) => {
    const result = {};
    for (const item of sentimentItems) result[item.labels[field]] = (result[item.labels[field]] ?? 0) + 1;
    return result;
  };
  const sentimentCounts = countBy('sentiment');
  assert.ok(sentimentCounts.negative >= 60, `负面评论应 ≥60（007 §2.1），实际 ${sentimentCounts.negative}`);
  assert.ok(sentimentCounts.positive >= 25, `正面评论应 ≥25（checklist），实际 ${sentimentCounts.positive}`);
  assert.ok(sentimentCounts.neutral >= 15, `中性评论应 ≥15（checklist），实际 ${sentimentCounts.neutral}`);
  assert.equal(
    (sentimentCounts.positive ?? 0) + (sentimentCounts.neutral ?? 0) + (sentimentCounts.negative ?? 0),
    sentimentItems.length,
    '舆情情绪应完整三分',
  );
  const noiseCount = sentimentItems.filter((item) => item.labels.noise === true).length;
  assert.ok(noiseCount >= 8, `噪声评论应 ≥8（004 §7.4），实际 ${noiseCount}`);
  assertDeepEqual(
    [...new Set(sentimentItems.map((item) => item.source))].sort(),
    [...SENTIMENT_SOURCES].sort(),
    '舆情数据集应覆盖 steam/taptap/googleplay/community/ticket 五来源',
  );
  assertDeepEqual(
    [...new Set(sentimentItems.map((item) => item.labels.primaryTopic))].sort(),
    [...TOPIC_DICT].sort(),
    '舆情数据集应覆盖 7 个主题',
  );
  const levelCounts = countBy('expectedLevel');
  for (const level of LEVELS) {
    assert.ok((levelCounts[level] ?? 0) >= 1, `舆情金标应包含 ${level} 级别样本`);
  }
});

test('数据舆情聚簇可复算：12–16 簇、每簇 4–12 条、簇级别符合 007 §5/§6.2', () => {
  const clusters = new Map();
  for (const item of sentimentItems) {
    const key = `${item.labels.primaryTopic}|${dateOf(item.publishedAt)}`;
    if (!clusters.has(key)) clusters.set(key, { key, items: [] });
    clusters.get(key).items.push(item);
  }

  assert.ok(
    clusters.size >= 12 && clusters.size <= 16,
    `舆情应按 (primaryTopic, 日期) 聚为 12–16 簇（004 §7.4），实际 ${clusters.size} 簇`,
  );

  const clusterLevels = [];
  const sizesByLevel = { P0: [], P1: [], P2: [], none: [] };
  let aggregateUpgradedP0 = 0;
  for (const [key, cluster] of clusters) {
    const where = `簇 ${key}`;
    assert.ok(cluster.items.length >= 4 && cluster.items.length <= 12, `${where} 应有 4–12 条评论，实际 ${cluster.items.length}`);
    const dates = new Set(cluster.items.map((item) => dateOf(item.publishedAt)));
    assert.equal(dates.size, 1, `${where} 内发布日期应一致（聚合键可复算）`);
    const topics = new Set(cluster.items.map((item) => item.labels.primaryTopic));
    assert.equal(topics.size, 1, `${where} 内 primaryTopic 应一致（聚合键可复算）`);

    const negativeCount = cluster.items.filter((item) => item.labels.sentiment === 'negative').length;
    const singleMaxRank = Math.max(...cluster.items.map((item) => LEVEL_RANK[item.labels.expectedLevel]));
    const aggregatedRank = negativeCount >= 8 ? 3 : negativeCount >= 3 ? 2 : negativeCount >= 1 ? 1 : 0;
    const clusterRank = Math.max(singleMaxRank, aggregatedRank);
    const clusterLevel = LEVEL_BY_RANK[clusterRank];
    clusterLevels.push(clusterLevel);
    sizesByLevel[clusterLevel].push(cluster.items.length);
    if (clusterLevel === 'P0' && singleMaxRank < 3) aggregateUpgradedP0 += 1;
  }

  // 007 §2.3：P0 簇 5–10 条、P1 簇 4–8 条、P2 簇 3–6 条、none 簇 3–6 条
  const sizeRanges = { P0: [5, 10], P1: [4, 8], P2: [3, 6], none: [3, 6] };
  for (const level of LEVELS) {
    const [min, max] = sizeRanges[level];
    for (const size of sizesByLevel[level]) {
      assert.ok(
        size >= min && size <= max,
        `${level} 簇条数应落在 ${min}–${max}（007 §2.3），实际 ${size}`,
      );
    }
  }

  const levelCounts = { P0: 0, P1: 0, P2: 0, none: 0 };
  for (const level of clusterLevels) levelCounts[level] += 1;
  assert.ok(levelCounts.P0 >= 2, `P0 簇应 ≥2（004 §7.4 / 007 §2.3），实际 ${levelCounts.P0}`);
  assert.ok(levelCounts.P1 >= 3, `P1 簇应 ≥3，实际 ${levelCounts.P1}`);
  assert.ok(levelCounts.P2 >= 3, `P2 簇应 ≥3，实际 ${levelCounts.P2}`);
  assert.ok(levelCounts.none >= 3, `none 簇应 ≥3，实际 ${levelCounts.none}`);
  assert.ok(
    aggregateUpgradedP0 >= 1,
    '应至少 1 个 P0 簇由聚合升级产生（007 §2.3，验证告警升级链路）',
  );
});

test('数据生成器自检：node data/scripts/generate.mjs --check 退出码为 0', () => {
  const scriptPath = path.join(REPO_ROOT, 'data', 'scripts', 'generate.mjs');
  assert.ok(repoFileExists(path.join('data', 'scripts', 'generate.mjs')), '生成器脚本 data/scripts/generate.mjs 应存在');
  const result = spawnSync(process.execPath, [scriptPath, '--check'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 120_000,
  });
  assert.equal(
    result.error ?? null,
    null,
    `生成器 --check 执行失败：${result.error?.message ?? ''}`,
  );
  assert.equal(
    result.status,
    0,
    `生成器 --check 退出码应为 0，实际 ${result.status}\n--- stdout ---\n${result.stdout ?? ''}\n--- stderr ---\n${result.stderr ?? ''}`,
  );
});
