/**
 * QCC Workbench · 契约测试（contract.test.mjs）
 * =============================================================================
 * 依据：specs/contracts/openapi.yaml（唯一契约事实来源）、specs/005-api-contract.md、
 *       specs/004-data-model.md。
 *
 * 覆盖 28 个 openapi operation 的 200 响应结构与字段类型/枚举：
 *   GET  /api/health、/api/meta、/api/dashboard/{summary,trends,anomalies}、
 *        /api/qc/stats、/api/qc/conversations、/api/qc/conversations/{id}、
 *        /api/badcases、/api/badcases/stats、/api/badcases/{id}、
 *        /api/sentiment/stats、/api/sentiment/comments、/api/sentiment/alerts、
 *        /api/sentiment/alerts/{id}、/api/clues、/api/clues/{id}、
 *        /api/eval/datasets、/api/eval/runs、/api/eval/runs/{id}；
 *   POST /api/admin/reset、/api/qc/conversations/{id}/reviews、
 *        /api/qc/conversations/{id}/badcases、/api/badcases/{id}/actions、
 *        /api/sentiment/alerts/{id}/actions、/api/clues、/api/clues/{id}/actions、
 *        /api/eval/runs。
 *
 * 同时覆盖：分页参数边界（pageSize 默认 20 / 最大值 100）、非法枚举 422 且
 * error.details.field 指明字段、404/409 错误体结构、排序与筛选语义。
 *
 * 运行前置：API 已启动并监听 BASE_URL（默认 http://127.0.0.1:8787）。
 * 本文件在 before 中调用一次 POST /api/admin/reset 还原演示数据，测试内不再重置。
 * =============================================================================
 */
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import {
  ALERT_SLA_MINUTES,
  BADCASE_SLA_BY_CATEGORY,
  CLUE_TARGETS,
  ERROR_CODE_BY_STATUS,
  QC_TAG_CODES,
  QC_TAG_WEIGHTS,
  ROLE_DICT,
  S,
  SEVERITY_RANK,
  SENTIMENT_SOURCES,
  TOPIC_DICT,
  assertApprox,
  assertDeepEqual,
  assertErrorResponse,
  assertHttpStatus,
  assertIsoDate,
  assertOk,
  assertPaginated,
  assertShape,
  ensureApi,
  get,
  listAll,
  post,
  resetDemoData,
  sleep,
} from './helpers.mjs';

// ---------------------------------------------------------------------------
// 共享响应形状（字段/枚举与 openapi components.schemas 一一对应）
// ---------------------------------------------------------------------------

const EVIDENCE_SHAPE = S.objectOf({
  seq: S.integerRange(0),
  quote: S.nonEmptyString,
  note: S.nullable('string'),
});

const QC_TAG_SHAPE = S.objectOf({
  code: S.enum(...QC_TAG_CODES),
  name: S.nonEmptyString,
  severity: S.enum('low', 'medium', 'high'),
  confidence: S.numberRange(0, 1),
  evidence: S.array(EVIDENCE_SHAPE),
  ruleId: S.nonEmptyString,
});

const QC_RESULT_SHAPE = S.objectOf({
  id: S.nonEmptyString,
  conversationId: S.nonEmptyString,
  score: S.integerRange(0, 100),
  verdict: S.enum('pass', 'violation'),
  tags: S.array(QC_TAG_SHAPE),
  summary: S.nonEmptyString,
  emotion: S.enum('calm', 'anxious', 'angry'),
  confidence: S.numberRange(0, 1),
  needsReview: S.boolean,
  modelVersion: S.nonEmptyString,
  analyzedAt: S.dateTime,
  latestReviewId: S.nullable('string'),
});

const MESSAGE_SHAPE = S.objectOf({
  seq: S.integerRange(0),
  role: S.enum('customer', 'agent', 'system'),
  text: S.string,
  atSec: S.integerRange(0),
  gapSec: S.nullable(S.integerRange(0)),
});

const CONVERSATION_SHAPE = S.objectOf({
  id: S.nonEmptyString,
  channel: S.enum('online', 'ticket', 'phone'),
  product: S.nonEmptyString,
  agent: S.objectOf({ id: S.nonEmptyString, name: S.nonEmptyString }),
  customer: S.objectOf({ id: S.nonEmptyString, name: S.nonEmptyString }),
  startedAt: S.dateTime,
  durationSec: S.integerRange(0),
  messages: S.array(MESSAGE_SHAPE),
  importedAt: S.dateTime,
  batchId: S.nonEmptyString,
});

const REVIEW_SHAPE = S.objectOf({
  id: S.nonEmptyString,
  qcResultId: S.nonEmptyString,
  conversationId: S.nonEmptyString,
  status: S.enum('pending', 'done'),
  assignee: S.nonEmptyString,
  decision: S.nullable(S.enum('confirm', 'overturn', 'amend')),
  finalVerdict: S.nullable(S.enum('pass', 'violation')),
  finalTags: S.array(S.enum(...QC_TAG_CODES)),
  note: S.nullable('string'),
  createdAt: S.dateTime,
  reviewedAt: S.nullable(S.dateTime),
});

const BADCASE_ACTION_SHAPE = S.objectOf({
  at: S.dateTime,
  by: S.nonEmptyString,
  type: S.enum('created', 'assigned', 'progressed', 'verified', 'closed', 'reopened', 'commented'),
  note: S.nullable('string'),
  from: S.nullable('string'),
  to: S.nullable('string'),
});

const BADCASE_SHAPE = S.objectOf({
  id: S.nonEmptyString,
  code: S.nonEmptyString,
  conversationId: S.nonEmptyString,
  qcResultId: S.nonEmptyString,
  title: S.nonEmptyString,
  category: S.enum('knowledge', 'script', 'process', 'system'),
  rootCause: S.string,
  owner: S.nonEmptyString,
  creator: S.nonEmptyString,
  severity: S.enum('low', 'medium', 'high'),
  slaHours: S.integerRange(0),
  dueAt: S.dateTime,
  status: S.enum('open', 'in_progress', 'pending_verify', 'closed'),
  recurrence: S.boolean,
  recurrenceOf: S.nullable('string'),
  evidence: S.array(EVIDENCE_SHAPE),
  closedAt: S.nullable(S.dateTime),
  proof: S.nullable('string'),
  timeline: S.array(BADCASE_ACTION_SHAPE, { minItems: 1 }),
  createdAt: S.dateTime,
  updatedAt: S.dateTime,
});

const CLUE_ACTION_SHAPE = S.objectOf({
  at: S.dateTime,
  by: S.nonEmptyString,
  type: S.enum('created', 'routed', 'accepted', 'rejected', 'closed', 'commented'),
  note: S.nullable('string'),
  from: S.nullable('string'),
  to: S.nullable('string'),
});

const CLUE_SHAPE = S.objectOf({
  id: S.nonEmptyString,
  title: S.nonEmptyString,
  description: S.nonEmptyString,
  sourceType: S.enum('qc', 'sentiment', 'dashboard', 'agent'),
  sourceRef: S.objectOf({ type: S.nonEmptyString, id: S.nonEmptyString, label: S.string }),
  target: S.enum(...CLUE_TARGETS),
  priority: S.enum('high', 'medium', 'low'),
  status: S.enum('draft', 'routed', 'accepted', 'rejected', 'closed'),
  owner: S.nonEmptyString,
  createdBy: S.nonEmptyString,
  evidence: S.array('string'),
  outcome: S.nullable('string'),
  timeline: S.array(CLUE_ACTION_SHAPE, { minItems: 1 }),
  createdAt: S.dateTime,
  updatedAt: S.dateTime,
  closedAt: S.nullable(S.dateTime),
});

const COMMENT_SHAPE = S.objectOf({
  id: S.nonEmptyString,
  source: S.enum(...SENTIMENT_SOURCES),
  brand: S.nonEmptyString,
  author: S.nonEmptyString,
  text: S.string,
  publishedAt: S.dateTime,
  sentiment: S.enum('positive', 'neutral', 'negative'),
  sentimentScore: S.numberRange(-1, 1),
  topics: S.array(S.nonEmptyString, { minItems: 1, maxItems: 3 }),
  primaryTopic: S.nonEmptyString,
  severity: S.enum('p0', 'p1', 'p2', 'none'),
  confidence: S.numberRange(0, 1),
  needsReview: S.boolean,
  alertId: S.nullable('string'),
  engineRules: S.array('string'),
});

const ALERT_ACTION_SHAPE = S.objectOf({
  at: S.dateTime,
  by: S.nonEmptyString,
  type: S.enum('created', 'acknowledged', 'responded', 'escalated', 'resolved', 'commented'),
  note: S.nullable('string'),
  from: S.nullable('string'),
  to: S.nullable('string'),
});

const ALERT_SHAPE = S.objectOf({
  id: S.nonEmptyString,
  level: S.enum('P0', 'P1', 'P2'),
  topic: S.enum(...TOPIC_DICT),
  title: S.nonEmptyString,
  summary: S.nonEmptyString,
  windowStart: S.dateTime,
  windowEnd: S.dateTime,
  triggerRules: S.array(S.objectOf({ ruleId: S.nonEmptyString, description: S.nonEmptyString }), { minItems: 1 }),
  commentIds: S.array(S.nonEmptyString, { minItems: 1 }),
  status: S.enum('new', 'acknowledged', 'responding', 'escalated', 'resolved'),
  owner: S.nonEmptyString,
  slaMinutes: S.integerRange(1),
  slaDueAt: S.dateTime,
  firstResponseAt: S.nullable(S.dateTime),
  resolvedAt: S.nullable(S.dateTime),
  timeline: S.array(ALERT_ACTION_SHAPE, { minItems: 1 }),
  linkedClueIds: S.array('string'),
  createdAt: S.dateTime,
});

const KPI_SHAPE = S.objectOf({
  id: S.nonEmptyString,
  label: S.nonEmptyString,
  value: S.number,
  target: S.number,
  op: S.enum('>=', '<='),
  status: S.enum('ok', 'warn', 'bad'),
  delta: S.number,
  unit: S.enum('percent', 'min', 'count', 'score', 'sec'),
  hint: S.nullable('string'),
});

const ANOMALY_SHAPE = S.objectOf({
  id: S.nonEmptyString,
  metric: S.nonEmptyString,
  metricLabel: S.nonEmptyString,
  current: S.number,
  target: S.number,
  deviation: S.number,
  severity: S.enum('warn', 'bad'),
  drillType: S.enum('qc', 'sentiment', 'badcase', 'clue'),
  drillFilter: S.object,
  owner: S.nonEmptyString,
  suggestion: S.nonEmptyString,
});

const MISMATCH_SHAPE = S.objectOf({
  itemId: S.nonEmptyString,
  expected: S.string,
  predicted: S.string,
  reason: S.nonEmptyString,
});

const EVAL_RUN_SHAPE = S.objectOf({
  id: S.nonEmptyString,
  dataset: S.enum('qc', 'sentiment'),
  datasetId: S.nonEmptyString,
  datasetVersion: S.nonEmptyString,
  runAt: S.dateTime,
  durationMs: S.integerRange(0),
  modelVersion: S.nonEmptyString,
  metrics: S.object,
  confusion: S.object,
  mismatches: S.array(MISMATCH_SHAPE),
  thresholdsMet: S.object,
  summary: S.nonEmptyString,
});

const EVAL_RUN_SUMMARY_SHAPE = S.objectOf({
  id: S.nonEmptyString,
  dataset: S.enum('qc', 'sentiment'),
  datasetId: S.nonEmptyString,
  datasetVersion: S.nonEmptyString,
  runAt: S.dateTime,
  durationMs: S.integerRange(0),
  modelVersion: S.nonEmptyString,
  metrics: S.object,
  thresholdsMet: S.object,
  summary: S.nonEmptyString,
});

const KPI_IDS = [
  'qcCoverage',
  'qcAccuracy',
  'badcaseCloseRate',
  'p0ResponseMin',
  'alertPrecision',
  'clueCloseRate',
  'csat',
];

// ---------------------------------------------------------------------------
// 局部辅助
// ---------------------------------------------------------------------------

let seed = null;

before(async () => {
  await ensureApi();
  seed = await resetDemoData();
});

/** 断言 kpis 数组符合 FR-SYS-001：7 张卡、id 唯一、status 由 value/target/op 计算。 */
function assertKpis(kpis, context) {
  assert.ok(Array.isArray(kpis), `${context}：kpis 应为数组`);
  assert.equal(kpis.length, 7, `${context}：应返回 7 张 KPI 卡，实际 ${kpis.length}`);
  const ids = kpis.map((kpi) => kpi.id);
  assert.equal(new Set(ids).size, ids.length, `${context}：KPI id 应唯一，实际 ${JSON.stringify(ids)}`);
  assertDeepEqual([...ids].sort(), [...KPI_IDS].sort(), `${context}：KPI id 集合`);
  kpis.forEach((kpi, index) => {
    assertShape(kpi, KPI_SHAPE, `${context}.kpis[${index}]`);
    if (kpi.op === '>=') {
      assert.equal(
        kpi.status === 'ok',
        kpi.value >= kpi.target,
        `${context}.kpis[${index}](${kpi.id})：op 为 >= 时 status ok 应等价于 value(${kpi.value}) >= target(${kpi.target})，实际 status=${kpi.status}`,
      );
    } else {
      assert.equal(
        kpi.status === 'ok',
        kpi.value <= kpi.target,
        `${context}.kpis[${index}](${kpi.id})：op 为 <= 时 status ok 应等价于 value(${kpi.value}) <= target(${kpi.target})，实际 status=${kpi.status}`,
      );
    }
  });
  const coverage = kpis.find((kpi) => kpi.id === 'qcCoverage');
  assert.ok(coverage.value >= 0.9, `${context}：质检覆盖率应 ≥ 0.90，实际 ${coverage.value}`);
  return ids;
}

/** 断言 rows 为连续升序日期（YYYY-MM-DD），并返回日期数组。 */
function assertTrendRows(rows, context) {
  assert.ok(Array.isArray(rows), `${context}：rows 应为数组`);
  const dates = rows.map((row, index) => {
    assert.equal(typeof row, 'object', `${context}.rows[${index}]：应为对象`);
    assert.equal(typeof row.date, 'string', `${context}.rows[${index}].date：应为字符串`);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(row.date), `${context}.rows[${index}].date 格式应为 YYYY-MM-DD，实际 ${row.date}`);
    for (const key of [
      'qcCoverage',
      'qcAccuracy',
      'badcaseCloseRate',
      'p0ResponseMin',
      'alertPrecision',
      'clueCloseRate',
      'csat',
    ]) {
      if (row[key] !== undefined) {
        assert.ok(
          row[key] === null || (typeof row[key] === 'number' && Number.isFinite(row[key])),
          `${context}.rows[${index}].${key} 应为 number 或 null（缺失数据点），实际 ${JSON.stringify(row[key])}`,
        );
      }
    }
    return row.date;
  });
  for (let i = 1; i < dates.length; i += 1) {
    const prev = Date.parse(`${dates[i - 1]}T00:00:00Z`);
    const current = Date.parse(`${dates[i]}T00:00:00Z`);
    assert.equal(current - prev, 86_400_000, `${context}：日期应连续升序，${dates[i - 1]} → ${dates[i]} 不连续`);
  }
  return dates;
}

/** 拉取指定数量对话详情，直到满足 predicate（找不到则断言失败）。 */
async function findConversationDetails(predicate, { needed = 1, label = '对话' } = {}) {
  const list = await listAll('/api/qc/conversations', {}, 'GET /api/qc/conversations');
  const found = [];
  for (const item of list) {
    const detail = assertOk(await get(`/api/qc/conversations/${item.id}`), `GET /api/qc/conversations/${item.id}`);
    if (predicate(detail)) {
      found.push(detail);
      if (found.length >= needed) return found;
    }
  }
  assert.fail(`${label}：在 ${list.length} 条对话中未找到满足条件的 ${needed} 条（实际找到 ${found.length} 条）`);
}

/** 断言错误响应的 details 中带指定字段（422）。 */
function assertFieldError(res, { status = 422, field, context }) {
  assertErrorResponse(res, { status, field, context });
}

/** 与 API primaryTagOf 一致：按权重降序、再字典序，取首个标签。 */
function primaryTagCode(qcResult) {
  return (
    [...qcResult.tags].sort((left, right) => {
      const weightDiff = Math.abs(QC_TAG_WEIGHTS[right.code]) - Math.abs(QC_TAG_WEIGHTS[left.code]);
      if (weightDiff !== 0) {
        return weightDiff;
      }
      return left.code < right.code ? -1 : left.code > right.code ? 1 : 0;
    })[0]?.code ?? null
  );
}

// ---------------------------------------------------------------------------
// 1. 元信息
// ---------------------------------------------------------------------------

test('契约 GET /api/health：status/version/uptimeSec', async () => {
  const res = await get('/api/health');
  const body = assertOk(res, 'GET /api/health');
  assertShape(body, { status: S.enum('ok'), version: S.nonEmptyString, uptimeSec: S.numberRange(0) }, 'health');
  assert.equal(body.status, 'ok', 'health.status 应为 ok');
});

test('契约 GET /api/meta：角色/责任人/标签/主题/来源/目标/状态文案/演示信息齐全', async () => {
  const body = assertOk(await get('/api/meta'), 'GET /api/meta');
  assertShape(
    body,
    {
      product: S.nonEmptyString,
      version: S.nonEmptyString,
      generatedAt: S.dateTime,
      modelVersion: S.nonEmptyString,
      roles: S.array(S.objectOf({ id: S.nonEmptyString, label: S.nonEmptyString }), { minItems: 1 }),
      owners: S.array(S.objectOf({ role: S.nonEmptyString, name: S.nonEmptyString }), { minItems: 1 }),
      tagTaxonomy: S.array(
        S.objectOf({
          code: S.nonEmptyString,
          name: S.nonEmptyString,
          description: S.nonEmptyString,
          severity: S.enum('low', 'medium', 'high'),
          weight: S.integer,
        }),
        { minItems: 1 },
      ),
      topics: S.array(S.nonEmptyString, { minItems: 1 }),
      sources: S.array(S.objectOf({ id: S.nonEmptyString, label: S.nonEmptyString }), { minItems: 1 }),
      clueTargets: S.array(S.objectOf({ id: S.nonEmptyString, label: S.nonEmptyString }), { minItems: 1 }),
      statusLabels: S.object,
      demo: S.objectOf({
        datasetVersion: S.nonEmptyString,
        resetAvailable: S.boolean,
        itemCounts: S.objectOf({ qc: S.integerRange(0), sentiment: S.integerRange(0) }),
      }),
    },
    'meta',
  );

  // 角色字典（004 §4.4：6 个角色）
  assertDeepEqual(
    body.roles.map((role) => role.id).sort(),
    [...ROLE_DICT].sort(),
    'meta.roles：角色 id 集合应与 004 §4.4 一致',
  );

  // 标签字典（004 §4.1 / FR-QC-004）：6 个标签、权重绝对值与规范一致
  const tagCodes = body.tagTaxonomy.map((tag) => tag.code).sort();
  assertDeepEqual(tagCodes, [...QC_TAG_CODES].sort(), 'meta.tagTaxonomy：标签 code 集合');
  for (const tag of body.tagTaxonomy) {
    const expectedWeight = Math.abs(QC_TAG_WEIGHTS[tag.code]);
    assert.equal(
      Math.abs(tag.weight),
      expectedWeight,
      `meta.tagTaxonomy[${tag.code}].weight 绝对值应为 ${expectedWeight}（FR-QC-004），实际 ${tag.weight}`,
    );
  }

  // 主题字典（004 §4.3：7 个主题）
  assertDeepEqual([...body.topics].sort(), [...TOPIC_DICT].sort(), 'meta.topics：主题集合应与 004 §4.3 一致');

  // 来源、目标、责任人、状态文案（FR-SYS-007）
  assertDeepEqual(
    body.sources.map((source) => source.id).sort(),
    [...SENTIMENT_SOURCES].sort(),
    'meta.sources：来源集合',
  );
  assertDeepEqual(
    body.clueTargets.map((target) => target.id).sort(),
    [...CLUE_TARGETS].sort(),
    'meta.clueTargets：线索目标集合',
  );
  const ownerNames = body.owners.map((owner) => owner.name);
  for (const name of ['沈言', '顾清', '唐沐', '陆川', '周野', '江岚']) {
    assert.ok(ownerNames.includes(name), `meta.owners 应包含责任人 ${name}（004 §4.5），实际 ${JSON.stringify(ownerNames)}`);
  }
  // 嵌套分组结构（005 §3.11 / 契约 v0.1.1 冻结）：badcase/alert/clue 三组共 14 个状态键
  const expectedStatusGroups = {
    badcase: ['open', 'in_progress', 'pending_verify', 'closed'],
    alert: ['new', 'acknowledged', 'responding', 'escalated', 'resolved'],
    clue: ['draft', 'routed', 'accepted', 'rejected', 'closed'],
  };
  assertDeepEqual(
    Object.keys(body.statusLabels).sort(),
    Object.keys(expectedStatusGroups).sort(),
    'meta.statusLabels 顶层分组应为 badcase/alert/clue（005 §3.11）',
  );
  for (const [group, statuses] of Object.entries(expectedStatusGroups)) {
    assertDeepEqual(
      Object.keys(body.statusLabels[group]).sort(),
      [...statuses].sort(),
      `meta.statusLabels.${group} 的状态键集合应与 005 §3.11 一致`,
    );
    for (const status of statuses) {
      const label = body.statusLabels[group][status];
      assert.ok(
        typeof label === 'string' && label.trim() !== '',
        `meta.statusLabels.${group}.${status} 应为非空中文字符串`,
      );
    }
  }
  assert.equal(body.demo.itemCounts.qc, 60, 'meta.demo.itemCounts.qc 应为 60（004 §7.3）');
  assert.equal(body.demo.itemCounts.sentiment, 120, 'meta.demo.itemCounts.sentiment 应为 120（004 §7.4）');
});

test('契约 POST /api/admin/reset：ResetResult 结构与 seeded 计数', async () => {
  const body = await resetDemoData();
  assert.equal(body.seeded.conversations, 60, 'seeded.conversations 应为 60（004 §7.3）');
  assert.equal(body.seeded.qcResults, 60, 'seeded.qcResults 应为 60（每条对话一个质检结果）');
  assert.equal(body.seeded.comments, 120, 'seeded.comments 应为 120（004 §7.4）');
  assert.equal(body.seeded.metricSnapshots, 14, 'seeded.metricSnapshots 应为 14（004 §3.11）');
  assert.ok(body.seeded.alerts >= 1, `seeded.alerts 应 ≥ 1，实际 ${body.seeded.alerts}`);
  assert.ok(seed.resetAt.length > 0, 'resetAt 应为非空 ISO 时间');
});

// ---------------------------------------------------------------------------
// 2. 质检
// ---------------------------------------------------------------------------

test('契约 GET /api/qc/stats：QcStats 结构、占比口径与分布', async () => {
  const body = assertOk(await get('/api/qc/stats'), 'GET /api/qc/stats');
  assertShape(
    body,
    {
      total: S.integerRange(0),
      analyzed: S.integerRange(0),
      pass: S.integerRange(0),
      violation: S.integerRange(0),
      needsReview: S.integerRange(0),
      reviewed: S.integerRange(0),
      avgScore: S.numberRange(0, 100),
      reviewRatio: S.numberRange(0, 1),
      tagDistribution: S.array(S.objectOf({ code: S.enum(...QC_TAG_CODES), name: S.nonEmptyString, count: S.integerRange(1) })),
      channelDistribution: S.array(
        S.objectOf({ channel: S.enum('online', 'ticket', 'phone'), count: S.integerRange(1) }),
      ),
    },
    'qcStats',
  );
  assert.equal(body.total, 60, 'qcStats.total 应为 60（全量质检）');
  assert.equal(body.analyzed, 60, 'qcStats.analyzed 应为 60（FR-QC-001 全量质检）');
  assert.equal(body.pass + body.violation, body.total, 'qcStats total 应等于 pass + violation（FR-QC-006）');
  assert.equal(
    body.reviewRatio,
    Math.round((body.needsReview / body.analyzed) * 1000) / 1000,
    'qcStats.reviewRatio 应等于 needsReview/analyzed 且保留 3 位小数（FR-QC-006）',
  );
  const channelSum = body.channelDistribution.reduce((sum, item) => sum + item.count, 0);
  assert.equal(channelSum, body.total, 'qcStats.channelDistribution 计数之和应等于 total');
  const tagCodes = body.tagDistribution.map((item) => item.code);
  assert.equal(new Set(tagCodes).size, tagCodes.length, 'qcStats.tagDistribution 标签 code 不应重复');
});

test('契约 GET /api/qc/conversations：分页/筛选/排序与参数边界', async () => {
  const stats = assertOk(await get('/api/qc/stats'), 'GET /api/qc/stats');

  // 默认分页：page=1、pageSize=20、默认排序 time_desc（FR-QC-009）
  const defaultPage = assertOk(await get('/api/qc/conversations'), 'GET /api/qc/conversations（默认参数）');
  assertPaginated(defaultPage, { label: 'qcList', page: 1, pageSize: 20 });
  assert.equal(defaultPage.items.length, 20, 'qcList 默认 pageSize=20 时应返回 20 条（total=60）');
  assert.equal(defaultPage.total, 60, 'qcList.total 应为 60');
  for (const [index, item] of defaultPage.items.entries()) {
    assertShape(
      item,
      S.objectOf({
        id: S.nonEmptyString,
        channel: S.enum('online', 'ticket', 'phone'),
        product: S.nonEmptyString,
        agentName: S.nonEmptyString,
        customerName: S.nonEmptyString,
        startedAt: S.dateTime,
        durationSec: S.integerRange(0),
        messageCount: S.integerRange(0),
        score: S.integerRange(0, 100),
        verdict: S.enum('pass', 'violation'),
        needsReview: S.boolean,
        emotion: S.enum('calm', 'anxious', 'angry'),
        summary: S.nonEmptyString,
        tags: S.array(S.objectOf({ code: S.enum(...QC_TAG_CODES), name: S.nonEmptyString, severity: S.enum('low', 'medium', 'high') })),
      }),
      `qcList.items[${index}]`,
    );
  }
  for (let index = 1; index < defaultPage.items.length; index += 1) {
    const prev = defaultPage.items[index - 1];
    const current = defaultPage.items[index];
    const prevTime = Date.parse(prev.startedAt);
    const currentTime = Date.parse(current.startedAt);
    assert.ok(
      prevTime > currentTime || (prevTime === currentTime && prev.id < current.id),
      `qcList 默认排序应为 time_desc（同时间按 id 升序，FR-QC-009）：${prev.id}(${prev.startedAt}) 应在 ${current.id}(${current.startedAt}) 之前`,
    );
  }

  // 筛选：verdict/tag/review/channel
  const violationList = await listAll('/api/qc/conversations', { verdict: 'violation' }, 'qcList?verdict=violation');
  assert.equal(violationList.length, stats.violation, 'verdict=violation 的 total 应等于 qcStats.violation');
  for (const item of violationList) assert.equal(item.verdict, 'violation', 'verdict=violation 筛选应全部为 violation');

  const passList = await listAll('/api/qc/conversations', { verdict: 'pass' }, 'qcList?verdict=pass');
  assert.equal(passList.length, stats.pass, 'verdict=pass 的 total 应等于 qcStats.pass');
  for (const item of passList) assert.equal(item.verdict, 'pass', 'verdict=pass 筛选应全部为 pass');

  const fullList = await listAll('/api/qc/conversations', {}, 'qcList（全量）');
  assert.equal(fullList.length, 60, 'qcList 全量应为 60 条');
  for (const code of QC_TAG_CODES) {
    const tagged = fullList.filter((item) => item.tags.some((tag) => tag.code === code));
    const filtered = await listAll('/api/qc/conversations', { tag: code }, `qcList?tag=${code}`);
    assert.equal(
      filtered.length,
      tagged.length,
      `tag=${code} 的 total 应等于含该标签的去重对话数（FR-QC-002）：期望 ${tagged.length}，实际 ${filtered.length}`,
    );
    for (const item of filtered) {
      assert.ok(
        item.tags.some((tag) => tag.code === code),
        `tag=${code} 筛选结果 ${item.id} 应包含 ${code} 标签，实际 ${JSON.stringify(item.tags)}`,
      );
    }
  }

  const pendingReview = await listAll('/api/qc/conversations', { review: 'pending' }, 'qcList?review=pending');
  for (const item of pendingReview) {
    assert.equal(item.needsReview, true, `review=pending 筛选结果 ${item.id} 的 needsReview 应为 true（FR-QC-002）`);
  }
  assert.equal(pendingReview.length, stats.needsReview, 'review=pending 的 total 应等于 qcStats.needsReview');

  const onlineOnly = await listAll('/api/qc/conversations', { channel: 'online' }, 'qcList?channel=online');
  for (const item of onlineOnly) assert.equal(item.channel, 'online', 'channel=online 筛选应全部为 online');
  assert.equal(
    onlineOnly.length,
    fullList.filter((item) => item.channel === 'online').length,
    'channel=online 的 total 应等于全量中 online 对话数',
  );

  // 排序：score_asc / score_desc
  const scoreAsc = assertOk(await get('/api/qc/conversations', { sort: 'score_asc', pageSize: 100 }), 'qcList?sort=score_asc');
  assertPaginated(scoreAsc, { label: 'qcList?sort=score_asc', pageSize: 100 });
  for (let index = 1; index < scoreAsc.items.length; index += 1) {
    assert.ok(
      scoreAsc.items[index - 1].score <= scoreAsc.items[index].score,
      `sort=score_asc 时 score 应非递减：${scoreAsc.items[index - 1].id}(${scoreAsc.items[index - 1].score}) → ${scoreAsc.items[index].id}(${scoreAsc.items[index].score})`,
    );
  }
  const scoreDesc = assertOk(await get('/api/qc/conversations', { sort: 'score_desc', pageSize: 100 }), 'qcList?sort=score_desc');
  for (let index = 1; index < scoreDesc.items.length; index += 1) {
    assert.ok(
      scoreDesc.items[index - 1].score >= scoreDesc.items[index].score,
      `sort=score_desc 时 score 应非递增：${scoreDesc.items[index - 1].id} → ${scoreDesc.items[index].id}`,
    );
  }

  // 分页：pageSize=100 上限、翻页不重不漏（FR-QC-009）
  const firstPage = assertOk(await get('/api/qc/conversations', { page: 1, pageSize: 7 }), 'qcList page=1 pageSize=7');
  assertPaginated(firstPage, { label: 'qcList page=1 pageSize=7', page: 1, pageSize: 7 });
  assert.equal(firstPage.items.length, 7, 'pageSize=7 时应返回 7 条');
  const secondPage = assertOk(await get('/api/qc/conversations', { page: 2, pageSize: 7 }), 'qcList page=2 pageSize=7');
  assertPaginated(secondPage, { label: 'qcList page=2 pageSize=7', page: 2, pageSize: 7 });
  const overlap = firstPage.items.filter((item) => secondPage.items.some((other) => other.id === item.id));
  assert.equal(overlap.length, 0, `分页不应重复（page1 ∩ page2 = ${overlap.map((item) => item.id).join(',')}）`);
  const pagedIds = new Set([...firstPage.items, ...secondPage.items].map((item) => item.id));
  assert.equal(pagedIds.size, 14, '前两页 pageSize=7 应覆盖 14 条不重复对话');
  const fullPage = assertOk(await get('/api/qc/conversations', { pageSize: 100 }), 'qcList pageSize=100');
  assertPaginated(fullPage, { label: 'qcList pageSize=100', pageSize: 100 });
  assert.equal(fullPage.items.length, 60, 'pageSize=100 时应一次返回全部 60 条');
  const beyond = assertOk(await get('/api/qc/conversations', { page: 99, pageSize: 20 }), 'qcList page=99');
  assertPaginated(beyond, { label: 'qcList page=99', page: 99, pageSize: 20 });
  assert.equal(beyond.items.length, 0, 'page 越界时应返回空 items（200）');

  // 关键词：对话摘要/坐席/对话 ID（FR-QC-002）
  const target = fullList[0];
  const byId = assertOk(await get('/api/qc/conversations', { q: target.id }), `qcList?q=${target.id}`);
  assert.ok(byId.total >= 1, `q=对话ID 时 total 应 ≥ 1，实际 ${byId.total}`);
  assert.ok(
    byId.items.some((item) => item.id === target.id),
    `q=${target.id} 的结果应包含该对话（FR-QC-002 支持按对话 ID 搜索）`,
  );

  // 非法枚举 → 422 且 details.field 指明字段（002 §10.3）
  assertFieldError(await get('/api/qc/conversations', { verdict: 'bogus' }), { field: 'verdict', context: 'qcList?verdict=bogus' });
  assertFieldError(await get('/api/qc/conversations', { tag: 'bogus' }), { field: 'tag', context: 'qcList?tag=bogus' });
  assertFieldError(await get('/api/qc/conversations', { review: 'bogus' }), { field: 'review', context: 'qcList?review=bogus' });
  assertFieldError(await get('/api/qc/conversations', { channel: 'bogus' }), { field: 'channel', context: 'qcList?channel=bogus' });
  assertFieldError(await get('/api/qc/conversations', { sort: 'bogus' }), { field: 'sort', context: 'qcList?sort=bogus' });
  assertFieldError(await get('/api/qc/conversations', { page: 0 }), { field: 'page', context: 'qcList?page=0' });
  assertFieldError(await get('/api/qc/conversations', { pageSize: 101 }), {
    field: 'pageSize',
    context: 'qcList?pageSize=101（上限 100）',
  });
});

test('契约 GET /api/qc/conversations/{id}：ConversationDetail 结构与 404', async () => {
  const list = await listAll('/api/qc/conversations', {}, 'qcList');
  assert.ok(list.length > 0, '对话列表不应为空');
  const target = list[0];
  const body = assertOk(await get(`/api/qc/conversations/${target.id}`), `GET /api/qc/conversations/${target.id}`);
  assertShape(
    body,
    {
      conversation: CONVERSATION_SHAPE,
      qcResult: QC_RESULT_SHAPE,
      review: S.nullable(REVIEW_SHAPE),
      badcase: S.nullable(BADCASE_SHAPE),
    },
    'conversationDetail',
  );
  assert.equal(body.conversation.id, target.id, '详情 conversation.id 应等于路径参数');
  assert.equal(body.qcResult.conversationId, target.id, 'qcResult.conversationId 应指向该对话（004 §3.2）');
  assert.ok(body.conversation.messages.length >= 4, '对话消息应 ≥ 4 条（004 §3.1）');
  for (let index = 1; index < body.conversation.messages.length; index += 1) {
    assert.ok(
      body.conversation.messages[index - 1].seq < body.conversation.messages[index].seq,
      'messages 应按 seq 升序返回（FR-QC-003）',
    );
  }
  if (body.review !== null) {
    assert.equal(body.review.conversationId, target.id, 'review.conversationId 应指向该对话');
    assert.equal(body.review.qcResultId, body.qcResult.id, 'review.qcResultId 应指向该质检结果');
  }
  if (body.badcase !== null) {
    assert.equal(body.badcase.conversationId, target.id, 'badcase.conversationId 应指向该对话');
    assert.equal(body.badcase.qcResultId, body.qcResult.id, 'badcase.qcResultId 应指向该质检结果');
  }

  // 404 NOT_FOUND 错误体
  const notFound = await get('/api/qc/conversations/conv-does-not-exist');
  assertErrorResponse(notFound, { status: 404, code: ERROR_CODE_BY_STATUS[404], context: 'GET /api/qc/conversations/conv-does-not-exist' });
});

test('契约 POST /api/qc/conversations/{id}/reviews：confirm/amend/overturn 与 422/409', async () => {
  const [needsReviewDetail] = await findConversationDetails(
    (detail) => detail.qcResult.needsReview === true && (detail.review === null || detail.review.status === 'pending'),
    {
    label: '待复核对话',
  });
  const conversationId = needsReviewDetail.conversation.id;
  const confirmRes = assertOk(
    await post(`/api/qc/conversations/${conversationId}/reviews`, {
      decision: 'confirm',
      note: '契约测试：确认 AI 判定',
      reviewer: '沈言',
    }),
    'POST reviews（confirm）',
  );
  assertShape(confirmRes, { review: REVIEW_SHAPE, qcResult: QC_RESULT_SHAPE }, 'reviewResult');
  assert.equal(confirmRes.review.status, 'done', '复核后 review.status 应为 done');
  assert.equal(confirmRes.review.decision, 'confirm', 'review.decision 应为 confirm');
  assertIsoDate(confirmRes.review.reviewedAt, 'review.reviewedAt');
  assert.equal(confirmRes.qcResult.needsReview, false, 'confirm 后 qcResult.needsReview 应为 false（FR-QC-005）');
  assert.equal(confirmRes.qcResult.latestReviewId, confirmRes.review.id, 'cqResult.latestReviewId 应指向本次复核');

  // 重复复核 → 409 CONFLICT（FR-QC-005 / 003 §5.2；005 §1.4 的“可再次发起”为契约歧义，见 tests/report.md）
  const duplicate = await post(`/api/qc/conversations/${conversationId}/reviews`, { decision: 'confirm', reviewer: '沈言' });
  assertErrorResponse(duplicate, { status: 409, code: ERROR_CODE_BY_STATUS[409], context: 'POST reviews（已复核后重复提交）' });

  // amend：finalTags 必填且非空，修正标签后 verdict 仍为 violation
  const [amendCandidate] = await findConversationDetails(
    (detail) => detail.qcResult.verdict === 'violation' && (detail.review === null || detail.review.status === 'pending'),
    { label: '待 amend 对话' },
  );
  const amendRes = assertOk(
    await post(`/api/qc/conversations/${amendCandidate.conversation.id}/reviews`, {
      decision: 'amend',
      finalTags: ['wrong_knowledge'],
      note: '契约测试：修正为知识错误',
      reviewer: '沈言',
    }),
    'POST reviews（amend）',
  );
  assert.equal(amendRes.review.decision, 'amend', 'review.decision 应为 amend');
  assertDeepEqual(amendRes.review.finalTags, ['wrong_knowledge'], 'review.finalTags 应等于请求值');
  assert.ok(
    amendRes.qcResult.tags.some((tag) => tag.code === 'wrong_knowledge'),
    'amend 后 qcResult.tags 应包含 finalTags 中的标签（FR-QC-005）',
  );
  assert.equal(amendRes.qcResult.verdict, 'violation', 'amend 后仍有标签，verdict 应为 violation（BR-02）');
  assert.equal(amendRes.qcResult.needsReview, false, 'amend 后 needsReview 应为 false');

  // overturn：finalTags 必须为空数组，判定改为 pass 且标签清空
  const [overturnCandidate] = await findConversationDetails(
    (detail) => detail.qcResult.verdict === 'violation' && (detail.review === null || detail.review.status === 'pending'),
    { label: '待 overturn 对话' },
  );
  const overturnRes = assertOk(
    await post(`/api/qc/conversations/${overturnCandidate.conversation.id}/reviews`, {
      decision: 'overturn',
      finalTags: [],
      note: '契约测试：误报改判',
      reviewer: '沈言',
    }),
    'POST reviews（overturn）',
  );
  assert.equal(overturnRes.review.decision, 'overturn', 'review.decision 应为 overturn');
  assert.equal(overturnRes.qcResult.verdict, 'pass', 'overturn 违规对话后 verdict 应为 pass（FR-QC-005）');
  assertDeepEqual(overturnRes.qcResult.tags, [], 'overturn 后 qcResult.tags 应清空（FR-QC-005）');

  // 422：amend 缺 finalTags / overturn 传非空 finalTags / 非法 decision / 非法标签枚举
  const [validationCandidate] = await findConversationDetails(
    (detail) => detail.review === null || detail.review.status === 'pending',
    {
    label: '待参数校验对话',
  });
  assertFieldError(
    await post(`/api/qc/conversations/${validationCandidate.conversation.id}/reviews`, { decision: 'amend' }),
    { field: 'finalTags', context: 'POST reviews（amend 缺 finalTags）' },
  );
  assertFieldError(
    await post(`/api/qc/conversations/${validationCandidate.conversation.id}/reviews`, {
      decision: 'overturn',
      finalTags: ['attitude'],
    }),
    { field: 'finalTags', context: 'POST reviews（overturn 传非空 finalTags）' },
  );
  assertFieldError(
    await post(`/api/qc/conversations/${validationCandidate.conversation.id}/reviews`, { decision: 'bogus' }),
    { field: 'decision', context: 'POST reviews（非法 decision）' },
  );
  assertFieldError(
    await post(`/api/qc/conversations/${validationCandidate.conversation.id}/reviews`, {
      decision: 'amend',
      finalTags: ['not_a_tag'],
    }),
    { field: 'finalTags', context: 'POST reviews（非法标签枚举）' },
  );

  // 404：对话不存在
  const notFound = await post('/api/qc/conversations/conv-does-not-exist/reviews', { decision: 'confirm' });
  assertErrorResponse(notFound, { status: 404, code: ERROR_CODE_BY_STATUS[404], context: 'POST reviews（对话不存在）' });
});

test('契约 POST /api/qc/conversations/{id}/badcases：创建/默认路由/重复 409/422', async () => {
  // 排除“同坐席 + 同主标签已有闭单”的会话，避免新建 badcase 因 FR-BC-004 被判为复发。
  const closedBadcases = await listAll('/api/badcases', { status: 'closed' }, 'GET /api/badcases（closed）');
  const closedSignatures = new Set();
  for (const closed of closedBadcases) {
    const source = assertOk(
      await get(`/api/qc/conversations/${closed.conversationId}`),
      `GET /api/qc/conversations/${closed.conversationId}（闭单 badcase 来源）`,
    );
    const tag = primaryTagCode(source.qcResult);
    if (tag !== null) {
      closedSignatures.add(`${source.conversation.agent.id}:${tag}`);
    }
  }

  const [detail] = await findConversationDetails(
    (candidate) =>
      candidate.qcResult.verdict === 'violation' &&
      candidate.badcase === null &&
      !closedSignatures.has(`${candidate.conversation.agent.id}:${primaryTagCode(candidate.qcResult)}`),
    { label: '可转 badcase 的违规定对话' },
  );
  const conversationId = detail.conversation.id;

  badcaseBaselineTotal = assertOk(await get('/api/badcases'), 'GET /api/badcases（创建前基线）').total;
  const created = assertOk(
    await post(`/api/qc/conversations/${conversationId}/badcases`, {
      category: 'process',
      title: '契约测试：话术流程问题',
      rootCause: '契约测试根因：坐席未按流程核实',
    }),
    'POST badcases（category=process，省略 owner/slaHours）',
  );
  assertShape(created, BADCASE_SHAPE, 'badcase');
  assert.match(created.code, /^BC-\d{4}-\d{4}$/, `badcase.code 应形如 BC-2026-0001（FR-BC-001），实际 ${created.code}`);
  assert.equal(created.status, 'open', '新建 badcase.status 应为 open');
  assert.equal(created.conversationId, conversationId, 'badcase.conversationId 应为来源对话');
  assert.equal(created.qcResultId, detail.qcResult.id, 'badcase.qcResultId 应为来源质检结果');
  assert.equal(created.owner, '陆川', 'process 类 badcase 缺省责任人应为陆川（FR-BC-002 / 004 §4.5）');
  assert.equal(created.slaHours, 24, 'process 类 badcase 缺省 SLA 应为 24h（FR-BC-002）');
  assert.equal(
    Date.parse(created.dueAt) - Date.parse(created.createdAt),
    24 * 3_600_000,
    'badcase.dueAt 应等于 createdAt + slaHours（FR-BC-002）',
  );
  assert.equal(created.timeline[0].type, 'created', 'timeline[0].type 应为 created（FR-BC-006）');
  assert.equal(created.timeline[0].to, 'open', 'timeline[0].to 应为 open');
  assert.equal(created.recurrence, false, '新建 badcase.recurrence 应为 false');

  // 重复创建 → 409 且 details.badcaseId 指向已有记录（FR-BC-001）
  const duplicate = await post(`/api/qc/conversations/${conversationId}/badcases`, { category: 'knowledge' });
  const duplicateError = assertErrorResponse(duplicate, {
    status: 409,
    code: ERROR_CODE_BY_STATUS[409],
    context: 'POST badcases（同对话未关闭 badcase 重复创建）',
  });
  assert.ok(
    duplicateError.details && duplicateError.details.badcaseId === created.id,
    `409 的 error.details.badcaseId 应指向已有 badcase ${created.id}，实际 ${JSON.stringify(duplicateError.details)}`,
  );

  // 422：非法 category
  const [anotherDetail] = await findConversationDetails((candidate) => candidate.badcase === null, {
    label: '另一条可转 badcase 的对话',
  });
  assertFieldError(
    await post(`/api/qc/conversations/${anotherDetail.conversation.id}/badcases`, { category: 'bogus' }),
    { field: 'category', context: 'POST badcases（非法 category）' },
  );

  // 404：对话不存在
  assertErrorResponse(await post('/api/qc/conversations/conv-does-not-exist/badcases', { category: 'knowledge' }), {
    status: 404,
    code: ERROR_CODE_BY_STATUS[404],
    context: 'POST badcases（对话不存在）',
  });

  // 供后续 badcase 列表/动作测试复用（通过模块级变量传递）
  createdBadcase = created;
  badcaseSourceDetail = detail;
});

let createdBadcase = null;
let badcaseSourceDetail = null;
let badcaseBaselineTotal = null;

test('契约 GET /api/badcases、/api/badcases/stats、/api/badcases/{id}：结构与统计口径', async () => {
  const list = await listAll('/api/badcases', {}, 'GET /api/badcases');
  const firstPage = assertOk(await get('/api/badcases'), 'GET /api/badcases（默认参数）');
  assertPaginated(firstPage, { label: 'badcaseList', page: 1, pageSize: 20 });
  assert.equal(firstPage.total, list.length, 'badcaseList.total 应与全量一致');
  assert.equal(
    list.length,
    badcaseBaselineTotal + 1,
    'badcase 列表 total 应为创建前基线 + 1（本用例前创建了 1 条，FR-BC-005）',
  );
  for (const [index, item] of list.entries()) {
    assertShape(
      item,
      S.objectOf({
        id: S.nonEmptyString,
        code: S.nonEmptyString,
        title: S.nonEmptyString,
        category: S.enum('knowledge', 'script', 'process', 'system'),
        owner: S.nonEmptyString,
        status: S.enum('open', 'in_progress', 'pending_verify', 'closed'),
        severity: S.enum('low', 'medium', 'high'),
        dueAt: S.dateTime,
        overdue: S.boolean,
        recurrence: S.boolean,
        conversationId: S.nonEmptyString,
        agentName: S.nonEmptyString,
        createdAt: S.dateTime,
        updatedAt: S.dateTime,
      }),
      `badcaseList.items[${index}]`,
    );
  }

  // 统计：total/状态分桶/closeRate/byCategory/byOwner 口径（FR-BC-005）
  const stats = assertOk(await get('/api/badcases/stats'), 'GET /api/badcases/stats');
  assertShape(
    stats,
    S.objectOf({
      total: S.integerRange(0),
      open: S.integerRange(0),
      inProgress: S.integerRange(0),
      pendingVerify: S.integerRange(0),
      closed: S.integerRange(0),
      overdue: S.integerRange(0),
      closeRate: S.numberRange(0, 1),
      recurrenceRate: S.numberRange(0, 1),
      byCategory: S.array(S.objectOf({ category: S.enum('knowledge', 'script', 'process', 'system'), count: S.integerRange(0) })),
      byOwner: S.array(S.objectOf({ owner: S.nonEmptyString, count: S.integerRange(0) })),
    }),
    'badcaseStats',
  );
  assert.equal(stats.total, list.length, 'badcaseStats.total 应等于列表 total');
  assert.equal(stats.open, list.filter((item) => item.status === 'open').length, 'badcaseStats.open 应与列表一致');
  assert.equal(
    stats.inProgress,
    list.filter((item) => item.status === 'in_progress').length,
    'badcaseStats.inProgress 应与列表一致',
  );
  assert.equal(
    stats.pendingVerify,
    list.filter((item) => item.status === 'pending_verify').length,
    'badcaseStats.pendingVerify 应与列表一致',
  );
  assert.equal(stats.closed, list.filter((item) => item.status === 'closed').length, 'badcaseStats.closed 应与列表一致');
  assert.equal(
    stats.overdue,
    list.filter((item) => item.overdue === true).length,
    'badcaseStats.overdue 应等于列表 overdue=true 数量',
  );
  // API 比率统一保留 3 位小数（util/time.ts ratio 默认 digits=3），容差按 1e-3。
  assertApprox(stats.closeRate, stats.closed / stats.total, 0.001, 'badcaseStats.closeRate 应为 closed/total（FR-BC-005）');
  assertApprox(
    stats.recurrenceRate,
    list.filter((item) => item.recurrence).length / stats.total,
    0.001,
    'badcaseStats.recurrenceRate 应为 recurrence/total',
  );
  assert.equal(
    stats.byCategory.reduce((sum, item) => sum + item.count, 0),
    stats.total,
    'badcaseStats.byCategory 计数之和应等于 total',
  );
  assert.equal(
    stats.byOwner.reduce((sum, item) => sum + item.count, 0),
    stats.total,
    'badcaseStats.byOwner 计数之和应等于 total',
  );

  // 筛选：status/category/owner/q
  for (const status of ['open', 'in_progress', 'pending_verify', 'closed']) {
    const filtered = await listAll('/api/badcases', { status }, `badcaseList?status=${status}`);
    for (const item of filtered) assert.equal(item.status, status, `status=${status} 筛选结果应全部匹配`);
  }
  for (const category of ['knowledge', 'script', 'process', 'system']) {
    const filtered = await listAll('/api/badcases', { category }, `badcaseList?category=${category}`);
    for (const item of filtered) assert.equal(item.category, category, `category=${category} 筛选结果应全部匹配`);
  }
  const detail = assertOk(await get(`/api/badcases/${createdBadcase.id}`), 'GET /api/badcases/{id}');
  assertShape(detail, BADCASE_SHAPE, 'badcaseDetail');
  assert.equal(detail.id, createdBadcase.id, '坏案例详情 id 应等于路径参数');

  // 404
  assertErrorResponse(await get('/api/badcases/bc-does-not-exist'), {
    status: 404,
    code: ERROR_CODE_BY_STATUS[404],
    context: 'GET /api/badcases/bc-does-not-exist',
  });
});

test('契约 POST /api/badcases/{id}/actions：状态机 200/409/422', async () => {
  const badcaseId = createdBadcase.id;
  const action = (payload) => post(`/api/badcases/${badcaseId}/actions`, payload);

  // open 状态非法跳跃 → 409（FR-BC-003 gherkin：open 直接 close 应 409）
  assertErrorResponse(await action({ type: 'close', proof: 'https://example.com/proof' }), {
    status: 409,
    code: ERROR_CODE_BY_STATUS[409],
    context: 'POST badcase actions（open 直接 close）',
  });
  assertErrorResponse(await action({ type: 'verify', note: '跳过处理' }), {
    status: 409,
    code: ERROR_CODE_BY_STATUS[409],
    context: 'POST badcase actions（open 直接 verify）',
  });
  assertErrorResponse(await action({ type: 'reopen', note: '未关闭重开' }), {
    status: 409,
    code: ERROR_CODE_BY_STATUS[409],
    context: 'POST badcase actions（open 直接 reopen）',
  });

  // 422：缺少必填 note/owner/proof；非法 action type
  assertFieldError(await action({ type: 'progress' }), { field: 'note', context: 'progress 缺 note' });
  assertFieldError(await action({ type: 'assign' }), { field: 'owner', context: 'assign 缺 owner' });
  assertFieldError(await action({ type: 'bogus' }), { field: 'type', context: '非法 action type' });

  // 合法链路：open→in_progress→pending_verify→closed→in_progress（reopen）
  const assigned = assertOk(await action({ type: 'assign', owner: '顾清', by: '客服主管' }), 'badcase assign');
  assert.equal(assigned.status, 'in_progress', 'assign 后 status 应为 in_progress');
  assert.equal(assigned.owner, '顾清', 'assign 后 owner 应为指定责任人');
  assert.equal(assigned.timeline.at(-1).type, 'assigned', 'timeline 末尾应为 assigned');

  const progressed = assertOk(await action({ type: 'progress', note: '契约测试：处理中', by: '顾清' }), 'badcase progress');
  assert.equal(progressed.status, 'in_progress', 'progress 后 status 应保持 in_progress');

  assertFieldError(await action({ type: 'verify', note: '' }), { field: 'note', context: 'verify 传空 note' });
  const verified = assertOk(await action({ type: 'verify', note: '契约测试：已修复待验证' }), 'badcase verify');
  assert.equal(verified.status, 'pending_verify', 'verify 后 status 应为 pending_verify');
  assert.equal(verified.timeline.at(-1).type, 'verified', 'timeline 末尾应为 verified');

  assertFieldError(await action({ type: 'close' }), { field: 'proof', context: 'close 缺 proof（BR-05）' });
  const closed = assertOk(await action({ type: 'close', proof: 'https://example.com/proof/1' }), 'badcase close');
  assert.equal(closed.status, 'closed', 'close 后 status 应为 closed');
  assert.equal(closed.proof, 'https://example.com/proof/1', 'close 后应记录 proof');
  assertIsoDate(closed.closedAt, 'badcase.closedAt');
  assert.equal(closed.timeline.at(-1).type, 'closed', 'timeline 末尾应为 closed');

  assertFieldError(await action({ type: 'reopen' }), { field: 'note', context: 'reopen 缺 note（BR-05）' });
  const reopened = assertOk(await action({ type: 'reopen', note: '契约测试：复发重开' }), 'badcase reopen');
  assert.equal(reopened.status, 'in_progress', 'reopen 后 status 应为 in_progress');
  assert.equal(reopened.timeline.at(-1).type, 'reopened', 'timeline 末尾应为 reopened');

  // 404：badcase 不存在
  assertErrorResponse(await post('/api/badcases/bc-does-not-exist/actions', { type: 'comment', note: 'x' }), {
    status: 404,
    code: ERROR_CODE_BY_STATUS[404],
    context: 'POST badcase actions（不存在）',
  });
});

// ---------------------------------------------------------------------------
// 3. 舆情
// ---------------------------------------------------------------------------

test('契约 GET /api/sentiment/stats：SentimentStats 结构与分布', async () => {
  const body = assertOk(await get('/api/sentiment/stats'), 'GET /api/sentiment/stats');
  assertShape(
    body,
    S.objectOf({
      comments: S.integerRange(0),
      analyzed: S.integerRange(0),
      negativeRatio: S.numberRange(0, 1),
      needsReview: S.integerRange(0),
      alertsTotal: S.integerRange(0),
      alertsOpen: S.integerRange(0),
      p0: S.integerRange(0),
      p1: S.integerRange(0),
      p2: S.integerRange(0),
      avgFirstResponseMin: S.nullable(S.numberRange(0)),
      p0ResponseMin: S.nullable(S.numberRange(0)),
      p1ResponseMin: S.nullable(S.numberRange(0)),
      topicDistribution: S.array(S.objectOf({ topic: S.enum(...TOPIC_DICT), count: S.integerRange(0) })),
      sourceDistribution: S.array(S.objectOf({ source: S.enum(...SENTIMENT_SOURCES), count: S.integerRange(0) })),
      sentimentDistribution: S.array(
        S.objectOf({ sentiment: S.enum('positive', 'neutral', 'negative'), count: S.integerRange(0) }),
      ),
    }),
    'sentimentStats',
  );
  assert.equal(body.comments, 120, 'sentimentStats.comments 应为 120（004 §7.4）');
  assert.equal(body.analyzed, 120, 'sentimentStats.analyzed 应为 120（FR-SEN-001 全量分析）');

  const sentimentSum = body.sentimentDistribution.reduce((sum, item) => sum + item.count, 0);
  assert.equal(sentimentSum, body.comments, 'sentimentDistribution 计数之和应等于评论数');
  const sourceSum = body.sourceDistribution.reduce((sum, item) => sum + item.count, 0);
  assert.equal(sourceSum, body.comments, 'sourceDistribution 计数之和应等于评论数');
  const negativeCount = body.sentimentDistribution.find((item) => item.sentiment === 'negative')?.count ?? 0;
  assertApprox(body.negativeRatio, negativeCount / body.comments, 0.001, 'negativeRatio 应为负面评论数/评论数（保留 3 位小数）');
  const topicSum = body.topicDistribution.reduce((sum, item) => sum + item.count, 0);
  assert.ok(
    topicSum >= body.comments && topicSum <= body.comments * 3,
    `topicDistribution 计数之和应在 [comments, comments×3]（topics 1-3 个）之间，实际 ${topicSum}`,
  );
});

test('契约 GET /api/sentiment/comments：分页/筛选/关键词与参数边界', async () => {
  const defaultPage = assertOk(await get('/api/sentiment/comments'), 'GET /api/sentiment/comments（默认参数）');
  assertPaginated(defaultPage, { label: 'commentList', page: 1, pageSize: 20 });
  assert.equal(defaultPage.total, 120, 'commentList.total 应为 120');
  for (const [index, item] of defaultPage.items.entries()) {
    assertShape(item, COMMENT_SHAPE, `commentList.items[${index}]`);
    assert.ok(TOPIC_DICT.includes(item.primaryTopic), `评论 primaryTopic 应属于主题字典（FR-SEN-001）：${item.primaryTopic}`);
    assert.ok(item.topics.includes(item.primaryTopic), '评论 primaryTopic 应包含在 topics 中');
    assert.equal(new Set(item.topics).size, item.topics.length, '评论 topics 不应重复');
  }

  for (const source of SENTIMENT_SOURCES) {
    const filtered = await listAll('/api/sentiment/comments', { source }, `commentList?source=${source}`);
    for (const item of filtered) assert.equal(item.source, source, `source=${source} 筛选结果应全部匹配`);
  }
  const negative = await listAll('/api/sentiment/comments', { sentiment: 'negative' }, 'commentList?sentiment=negative');
  for (const item of negative) assert.equal(item.sentiment, 'negative', 'sentiment=negative 筛选应全部为负面');
  for (const severity of ['p0', 'p1', 'p2', 'none']) {
    const filtered = await listAll('/api/sentiment/comments', { severity }, `commentList?severity=${severity}`);
    for (const item of filtered) assert.equal(item.severity, severity, `severity=${severity} 筛选应全部匹配`);
  }
  const byTopic = await listAll('/api/sentiment/comments', { topic: '外挂' }, 'commentList?topic=外挂');
  for (const item of byTopic) assert.ok(item.topics.includes('外挂'), 'topic=外挂 筛选结果 topics 应包含 外挂');

  const full = await listAll('/api/sentiment/comments', {}, 'commentList（全量）');
  const target = full[0];
  const byAuthor = assertOk(await get('/api/sentiment/comments', { q: target.author }), `commentList?q=${target.author}`);
  assert.ok(
    byAuthor.items.some((item) => item.id === target.id),
    `q=${target.author} 的结果应包含作者为 ${target.author} 的评论`,
  );
  for (const item of byAuthor.items) {
    assert.ok(
      item.author.includes(target.author) || item.text.includes(target.author) || item.brand.includes(target.author),
      `q 搜索结果应命中作者/正文/品牌之一：${item.id}`,
    );
  }

  assertFieldError(await get('/api/sentiment/comments', { source: 'weibo' }), { field: 'source', context: 'source=weibo' });
  assertFieldError(await get('/api/sentiment/comments', { sentiment: 'angry' }), {
    field: 'sentiment',
    context: 'sentiment=angry',
  });
  assertFieldError(await get('/api/sentiment/comments', { severity: 'P0' }), { field: 'severity', context: 'severity=P0（应为小写）' });
});

test('契约 GET /api/sentiment/alerts 与 /api/sentiment/alerts/{id}：结构与 404', async () => {
  const defaultPage = assertOk(await get('/api/sentiment/alerts'), 'GET /api/sentiment/alerts（默认参数）');
  assertPaginated(defaultPage, { label: 'alertList', page: 1, pageSize: 20 });
  const allAlerts = await listAll('/api/sentiment/alerts', {}, 'alertList（全量）');
  assert.equal(defaultPage.total, allAlerts.length, 'alertList.total 应与全量一致');
  assert.equal(seed.seeded.alerts, allAlerts.length, 'reset.seeded.alerts 应等于预警列表 total');
  for (const [index, item] of allAlerts.entries()) {
    assertShape(
      item,
      S.objectOf({
        id: S.nonEmptyString,
        level: S.enum('P0', 'P1', 'P2'),
        topic: S.enum(...TOPIC_DICT),
        title: S.nonEmptyString,
        status: S.enum('new', 'acknowledged', 'responding', 'escalated', 'resolved'),
        owner: S.nonEmptyString,
        createdAt: S.dateTime,
        firstResponseAt: S.nullable(S.dateTime),
        slaDueAt: S.dateTime,
        overdue: S.boolean,
        commentCount: S.integerRange(1),
      }),
      `alertList.items[${index}]`,
    );
    assert.equal(
      Date.parse(item.slaDueAt) - Date.parse(item.createdAt),
      ALERT_SLA_MINUTES[item.level] * 60_000,
      `预警 ${item.id} 的 slaDueAt 应等于 createdAt + ${ALERT_SLA_MINUTES[item.level]} 分钟（FR-SEN-003）`,
    );
  }
  for (const level of ['P0', 'P1', 'P2']) {
    const filtered = await listAll('/api/sentiment/alerts', { level }, `alertList?level=${level}`);
    for (const item of filtered) {
      assert.equal(item.level, level, `level=${level} 筛选应全部匹配`);
    }
  }
  for (const status of ['new', 'acknowledged', 'responding', 'escalated', 'resolved']) {
    const filtered = await listAll('/api/sentiment/alerts', { status }, `alertList?status=${status}`);
    for (const item of filtered) assert.equal(item.status, status, `status=${status} 筛选应全部匹配`);
  }

  const target = allAlerts[0];
  const detail = assertOk(await get(`/api/sentiment/alerts/${target.id}`), 'GET /api/sentiment/alerts/{id}');
  assertShape(detail, { alert: ALERT_SHAPE, comments: S.array(COMMENT_SHAPE), linkedClues: S.array(CLUE_SHAPE) }, 'alertDetail');
  assert.equal(detail.alert.id, target.id, '预警详情 alert.id 应等于路径参数');
  assert.equal(
    detail.comments.length,
    detail.alert.commentIds.length,
    '预警详情 comments 数量应等于 commentIds 长度（FR-SEN-003）',
  );
  for (const comment of detail.comments) {
    assert.equal(comment.alertId, target.id, '预警详情内评论 alertId 应指向该预警');
    assert.ok(detail.alert.commentIds.includes(comment.id), '预警详情 comments 应覆盖 commentIds');
  }

  assertErrorResponse(await get('/api/sentiment/alerts/al-does-not-exist'), {
    status: 404,
    code: ERROR_CODE_BY_STATUS[404],
    context: 'GET /api/sentiment/alerts/al-does-not-exist',
  });
});

test('契约 POST /api/sentiment/alerts/{id}/actions：SOP 500 状态机与 422/409', async () => {
  const allAlerts = await listAll('/api/sentiment/alerts', {}, 'alertList（全量）');
  const alert = allAlerts.find((item) => item.status === 'new') ?? allAlerts[0];
  const alertId = alert.id;
  const action = (payload) => post(`/api/sentiment/alerts/${alertId}/actions`, payload);

  // 422：非法动作 / respond 缺 note 语义（respond 是 acknowledged→responding，这里先测未知动作）
  assertFieldError(await action({ type: 'bogus' }), { field: 'type', context: '非法 alert action type' });

  const acknowledged = assertOk(await action({ type: 'acknowledge', by: '江岚', note: '契约测试：已确认' }), 'alert acknowledge');
  assertShape(acknowledged, ALERT_SHAPE, 'alert（acknowledge 后）');
  assert.equal(acknowledged.status, 'acknowledged', 'acknowledge 后 status 应为 acknowledged');
  assertIsoDate(acknowledged.firstResponseAt, 'alert.firstResponseAt（acknowledge 后应写入）');
  assert.equal(acknowledged.timeline.at(-1).type, 'acknowledged', 'timeline 末尾应为 acknowledged');

  // 重复 acknowledge → 409
  assertErrorResponse(await action({ type: 'acknowledge' }), {
    status: 409,
    code: ERROR_CODE_BY_STATUS[409],
    context: 'acknowledge（acknowledged 状态重复确认）',
  });

  const responded = assertOk(await action({ type: 'respond', by: '江岚', note: '契约测试：已联动处理' }), 'alert respond');
  assert.equal(responded.status, 'responding', 'respond 后 status 应为 responding');
  assert.equal(responded.timeline.at(-1).type, 'responded', 'timeline 末尾应为 responded');

  const escalated = assertOk(await action({ type: 'escalate', by: '江岚', note: '契约测试：升级品牌' }), 'alert escalate');
  assert.equal(escalated.status, 'escalated', 'escalate 后 status 应为 escalated');
  assert.equal(escalated.timeline.at(-1).type, 'escalated', 'timeline 末尾应为 escalated');

  assertFieldError(await action({ type: 'resolve' }), { field: 'note', context: 'resolve 缺 note（FR-SEN-004）' });
  const resolved = assertOk(await action({ type: 'resolve', by: '江岚', note: '契约测试：已解决' }), 'alert resolve');
  assert.equal(resolved.status, 'resolved', 'resolve 后 status 应为 resolved');
  assertIsoDate(resolved.resolvedAt, 'alert.resolvedAt（resolve 后应写入）');
  assert.equal(resolved.timeline.at(-1).type, 'resolved', 'timeline 末尾应为 resolved');

  // 非法转移：已 resolved 再 respond → 409；new 直接 respond → 409（用另一条 new 预警）
  assertErrorResponse(await action({ type: 'respond', note: '已解决后响应' }), {
    status: 409,
    code: ERROR_CODE_BY_STATUS[409],
    context: 'resolved 后 respond 非法转移',
  });
  const anotherNew = allAlerts.find((item) => item.status === 'new' && item.id !== alertId);
  assert.ok(anotherNew, '应存在另一条 new 预警用于非法转移测试');
  assertErrorResponse(await post(`/api/sentiment/alerts/${anotherNew.id}/actions`, { type: 'respond', note: '未确认先响应' }), {
    status: 409,
    code: ERROR_CODE_BY_STATUS[409],
    context: 'new 直接 respond 非法转移',
  });

  // 404
  assertErrorResponse(await post('/api/sentiment/alerts/al-does-not-exist/actions', { type: 'acknowledge' }), {
    status: 404,
    code: ERROR_CODE_BY_STATUS[404],
    context: 'POST alert actions（不存在）',
  });
});

// ---------------------------------------------------------------------------
// 4. 线索
// ---------------------------------------------------------------------------

let createdClue = null;

test('契约 GET /api/clues、POST /api/clues、GET /api/clues/{id}：结构与创建校验', async () => {
  const list = await listAll('/api/clues', {}, 'GET /api/clues');
  const firstPage = assertOk(await get('/api/clues'), 'GET /api/clues（默认参数）');
  assertPaginated(firstPage, { label: 'clueList', page: 1, pageSize: 20 });
  assert.equal(firstPage.total, list.length, 'clueList.total 应与全量一致');
  assert.equal(seed.seeded.clues, list.length, 'reset.seeded.clues 应等于线索列表 total');
  for (const [index, item] of list.entries()) {
    assertShape(
      item,
      S.objectOf({
        id: S.nonEmptyString,
        title: S.nonEmptyString,
        description: S.nonEmptyString,
        sourceType: S.enum('qc', 'sentiment', 'dashboard', 'agent'),
        sourceRef: S.objectOf({ type: S.nonEmptyString, id: S.nonEmptyString, label: S.string }),
        target: S.enum(...CLUE_TARGETS),
        priority: S.enum('high', 'medium', 'low'),
        status: S.enum('draft', 'routed', 'accepted', 'rejected', 'closed'),
        owner: S.nonEmptyString,
        createdBy: S.nonEmptyString,
        evidence: S.array('string'),
        outcome: S.nullable('string'),
        timeline: S.array(CLUE_ACTION_SHAPE, { minItems: 1 }),
        createdAt: S.dateTime,
        updatedAt: S.dateTime,
        closedAt: S.nullable(S.dateTime),
      }),
      `clueList.items[${index}]`,
    );
  }
  for (const status of ['draft', 'routed', 'accepted', 'rejected', 'closed']) {
    const filtered = await listAll('/api/clues', { status }, `clueList?status=${status}`);
    for (const item of filtered) assert.equal(item.status, status, `status=${status} 筛选应全部匹配`);
  }
  for (const target of CLUE_TARGETS) {
    const filtered = await listAll('/api/clues', { target }, `clueList?target=${target}`);
    for (const item of filtered) assert.equal(item.target, target, `target=${target} 筛选应全部匹配`);
  }

  // 创建：必填字段齐全 → draft，target=market 时路由程雨
  const createPayload = {
    title: '契约测试：充值外挂线索',
    description: '契约测试创建线索，验证 owner 路由与状态机。',
    sourceType: 'dashboard',
    sourceRef: { type: 'anomaly', id: 'anomaly-contract-1', label: 'badcaseCloseRate 异常' },
    target: 'market',
    priority: 'high',
    evidence: ['badcaseCloseRate 0.62 < 0.70'],
    createdBy: '看板',
  };
  createdClue = assertOk(await post('/api/clues', createPayload), 'POST /api/clues');
  assertShape(createdClue, CLUE_SHAPE, 'clue');
  assert.equal(createdClue.status, 'draft', '新建线索 status 应为 draft（FR-SYS-004）');
  assert.equal(createdClue.target, 'market', '线索 target 应为请求值');
  assert.equal(createdClue.owner, '程雨', 'target=market 时 owner 应路由为程雨（004 §4.5）');
  assertDeepEqual(createdClue.sourceRef, createPayload.sourceRef, 'clue.sourceRef 应保留请求内容');
  assert.equal(createdClue.timeline[0].type, 'created', 'timeline[0].type 应为 created');
  assert.equal(createdClue.outcome, null, '新线索 outcome 应为 null');

  // 422：缺必填字段/非法枚举
  for (const [field, payload] of [
    ['title', { ...createPayload, title: undefined }],
    ['description', { ...createPayload, description: undefined }],
    ['sourceType', { ...createPayload, sourceType: 'bogus' }],
    ['target', { ...createPayload, target: 'bogus' }],
    ['priority', { ...createPayload, priority: 'bogus' }],
    ['sourceRef', { ...createPayload, sourceRef: undefined }],
  ]) {
    assertFieldError(await post('/api/clues', payload), { field, context: `POST /api/clues（${field} 非法/缺失）` });
  }

  const detail = assertOk(await get(`/api/clues/${createdClue.id}`), 'GET /api/clues/{id}');
  assertShape(detail, CLUE_SHAPE, 'clueDetail');
  assert.equal(detail.id, createdClue.id, '线索详情 id 应等于路径参数');
  assertErrorResponse(await get('/api/clues/cl-does-not-exist'), {
    status: 404,
    code: ERROR_CODE_BY_STATUS[404],
    context: 'GET /api/clues/cl-does-not-exist',
  });
});

test('契约 POST /api/clues/{id}/actions：状态机 200/409/422', async () => {
  assert.ok(createdClue, '前置线索创建测试应已成功');
  const clueId = createdClue.id;
  const action = (payload) => post(`/api/clues/${clueId}/actions`, payload);

  // 非法跳跃：draft 直接 accept/close → 409（FR-SYS-004 / BR-09）
  assertErrorResponse(await action({ type: 'accept', owner: '周野' }), {
    status: 409,
    code: ERROR_CODE_BY_STATUS[409],
    context: 'draft 直接 accept',
  });
  assertErrorResponse(await action({ type: 'close', outcome: '跳过流程' }), {
    status: 409,
    code: ERROR_CODE_BY_STATUS[409],
    context: 'draft 直接 close',
  });

  // 422：route 缺 owner；非法 action type
  assertFieldError(await action({ type: 'route' }), { field: 'owner', context: 'route 缺 owner' });
  assertFieldError(await action({ type: 'bogus' }), { field: 'type', context: '非法 clue action type' });

  const routed = assertOk(await action({ type: 'route', owner: '程雨', by: '看板' }), 'clue route');
  assert.equal(routed.status, 'routed', 'route 后 status 应为 routed');
  assert.equal(routed.owner, '程雨', 'route 后 owner 应为指定责任人');
  assert.equal(routed.timeline.at(-1).type, 'routed', 'timeline 末尾应为 routed');

  // routed 再 route → 409
  assertErrorResponse(await action({ type: 'route', owner: '周野' }), {
    status: 409,
    code: ERROR_CODE_BY_STATUS[409],
    context: 'routed 状态重复 route',
  });

  const accepted = assertOk(await action({ type: 'accept', owner: '周野', by: '市场负责人' }), 'clue accept');
  assert.equal(accepted.status, 'accepted', 'accept 后 status 应为 accepted');
  assert.equal(accepted.owner, '周野', 'accept 可覆盖 owner');

  // accepted 直接 reject → 409
  assertErrorResponse(await action({ type: 'reject', note: '已接收后拒绝' }), {
    status: 409,
    code: ERROR_CODE_BY_STATUS[409],
    context: 'accepted 直接 reject',
  });

  assertFieldError(await action({ type: 'close' }), { field: 'outcome', context: 'close 缺 outcome（BR-09）' });
  const closed = assertOk(await action({ type: 'close', outcome: '契约测试：已交付闭环', by: '周野' }), 'clue close');
  assert.equal(closed.status, 'closed', 'close 后 status 应为 closed');
  assert.equal(closed.outcome, '契约测试：已交付闭环', 'close 后应记录 outcome');
  assertIsoDate(closed.closedAt, 'clue.closedAt');
  assert.equal(closed.timeline.at(-1).type, 'closed', 'timeline 末尾应为 closed');

  // 全部动作应写 timeline（at 单调不减）
  for (let index = 1; index < closed.timeline.length; index += 1) {
    assert.ok(
      Date.parse(closed.timeline[index - 1].at) <= Date.parse(closed.timeline[index].at),
      '线索 timeline 的 at 应单调不减（NFR-002）',
    );
  }

  // 404
  assertErrorResponse(await post('/api/clues/cl-does-not-exist/actions', { type: 'comment', note: 'x' }), {
    status: 404,
    code: ERROR_CODE_BY_STATUS[404],
    context: 'POST clue actions（不存在）',
  });
});

// ---------------------------------------------------------------------------
// 5. 看板
// ---------------------------------------------------------------------------

test('契约 GET /api/dashboard/summary：7 KPI/volume/quality/distribution', async () => {
  const body = assertOk(await get('/api/dashboard/summary'), 'GET /api/dashboard/summary（默认 range=7d）');
  assertShape(
    body,
    S.objectOf({
      range: S.string,
      generatedAt: S.dateTime,
      kpis: S.array(KPI_SHAPE),
      volume: S.objectOf({
        conversations: S.integerRange(0),
        reviewPending: S.integerRange(0),
        badcasesOpen: S.integerRange(0),
        alertsOpen: S.integerRange(0),
        cluesOpen: S.integerRange(0),
      }),
      quality: S.objectOf({ avgScore: S.numberRange(0, 100), violationRate: S.numberRange(0, 1) }),
      distribution: S.objectOf({
        tags: S.array(S.objectOf({ code: S.enum(...QC_TAG_CODES), name: S.nonEmptyString, count: S.integerRange(0) })),
        channels: S.array(S.objectOf({ channel: S.enum('online', 'ticket', 'phone'), count: S.integerRange(0) })),
        alertLevels: S.array(S.objectOf({ level: S.enum('P0', 'P1', 'P2'), count: S.integerRange(0) })),
        clueTargets: S.array(S.objectOf({ target: S.enum(...CLUE_TARGETS), count: S.integerRange(0) })),
      }),
    }),
    'dashboardSummary',
  );
  assert.equal(body.range, '7d', 'summary 默认 range 应为 7d');
  assertKpis(body.kpis, 'summary');
  assert.equal(body.volume.conversations, 60, '看板 volume.conversations 应为 60');

  const qcStats = assertOk(await get('/api/qc/stats'), 'GET /api/qc/stats（看板口径比对）');
  assertApprox(body.quality.avgScore, qcStats.avgScore, 0.1, '看板 quality.avgScore 应与质检统计一致');
  assertApprox(
    body.quality.violationRate,
    qcStats.violation / qcStats.total,
    0.001,
    '看板 quality.violationRate 应为 violation/total',
  );

  for (const range of ['14d', '30d']) {
    const ranged = assertOk(await get('/api/dashboard/summary', { range }), `GET dashboard/summary?range=${range}`);
    assertShape(ranged, S.objectOf({ range: S.nonEmptyString, kpis: S.array(KPI_SHAPE) }), `summary?range=${range}`);
    assert.equal(ranged.range, range, `summary.range 应回显 ${range}`);
    assert.equal(ranged.kpis.length, 7, `range=${range} 时仍应返回 7 张 KPI 卡`);
  }
  assertFieldError(await get('/api/dashboard/summary', { range: '90d' }), {
    field: 'range',
    context: 'dashboard/summary?range=90d',
  });
});

test('契约 GET /api/dashboard/trends：7d/14d/30d 行数与日期连续性', async () => {
  const body = assertOk(await get('/api/dashboard/trends'), 'GET /api/dashboard/trends（默认 range=7d）');
  assertShape(body, S.objectOf({ range: S.nonEmptyString, rows: S.array('object') }), 'trends');
  assert.equal(body.range, '7d', 'trends 默认 range 应为 7d');
  const dates7 = assertTrendRows(body.rows, 'trends?range=7d');
  assert.equal(dates7.length, 7, 'range=7d 时 rows.length 应为 7（FR-SYS-002）');

  const fourteen = assertOk(await get('/api/dashboard/trends', { range: '14d' }), 'GET /api/dashboard/trends?range=14d');
  const dates14 = assertTrendRows(fourteen.rows, 'trends?range=14d');
  assert.equal(dates14.length, 14, 'range=14d 时 rows.length 应为 14');

  const thirty = assertOk(await get('/api/dashboard/trends', { range: '30d' }), 'GET /api/dashboard/trends?range=30d');
  const dates30 = assertTrendRows(thirty.rows, 'trends?range=30d');
  assert.equal(dates30.length, 30, 'range=30d 时 rows.length 应为 30');
  // 004 §3.11 仅保留 14 天快照，30d 区间应存在缺失数据点（null 而非 0，FR-SYS-002）
  const nullCells = thirty.rows.reduce(
    (sum, row) =>
      sum +
      ['qcCoverage', 'qcAccuracy', 'badcaseCloseRate', 'p0ResponseMin', 'alertPrecision', 'clueCloseRate', 'csat'].filter(
        (key) => row[key] === null,
      ).length,
    0,
  );
  assert.ok(nullCells > 0, '30d 趋势中缺失数据点应以 null 表示（FR-SYS-002：缺失数据点为 null 而非 0）');

  assertFieldError(await get('/api/dashboard/trends', { range: '1y' }), {
    field: 'range',
    context: 'dashboard/trends?range=1y',
  });
});

test('契约 GET /api/dashboard/anomalies：异常卡结构与下钻筛选', async () => {
  const body = assertOk(await get('/api/dashboard/anomalies'), 'GET /api/dashboard/anomalies');
  assertShape(body, S.objectOf({ items: S.array(ANOMALY_SHAPE) }), 'anomalies');
  const ids = body.items.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length, '异常卡 id 应唯一');

  // FR-SYS-003：badcase 闭环率 < 0.70 时必须出现 metric=badcaseCloseRate、drillType=badcase、drillFilter.status=open
  const summary = assertOk(await get('/api/dashboard/summary'), 'GET /api/dashboard/summary（异常口径比对）');
  const closeRateKpi = summary.kpis.find((kpi) => kpi.id === 'badcaseCloseRate');
  if (closeRateKpi && closeRateKpi.value < 0.7) {
    const anomaly = body.items.find((item) => item.metric === 'badcaseCloseRate');
    assert.ok(anomaly, 'badcaseCloseRate < 0.70 时 anomalies 应包含 metric=badcaseCloseRate 的异常卡（FR-SYS-003）');
    assert.equal(anomaly.drillType, 'badcase', 'badcaseCloseRate 异常的 drillType 应为 badcase');
    assert.equal(
      anomaly.drillFilter.status,
      'open',
      `badcaseCloseRate 异常的 drillFilter.status 应为 open，实际 ${JSON.stringify(anomaly.drillFilter)}`,
    );
  }
  // 下钻类型 → 筛选键合法性
  const allowedFilterKeys = {
    qc: ['verdict', 'tag', 'review', 'channel'],
    sentiment: ['level', 'status', 'source', 'topic', 'severity'],
    badcase: ['status', 'category', 'owner'],
    clue: ['status', 'target', 'sourceType'],
  };
  for (const anomaly of body.items) {
    assert.ok(
      allowedFilterKeys[anomaly.drillType],
      `异常卡 drillType 应为 qc/sentiment/badcase/clue，实际 ${anomaly.drillType}`,
    );
    assert.ok(
      Object.keys(anomaly.drillFilter).length > 0,
      `异常卡 ${anomaly.id} 的 drillFilter 不应为空对象`,
    );
  }
});

// ---------------------------------------------------------------------------
// 6. 评测
// ---------------------------------------------------------------------------

test('契约 GET /api/eval/datasets：qc 与 sentiment 两个评测集', async () => {
  const body = assertOk(await get('/api/eval/datasets'), 'GET /api/eval/datasets');
  assertShape(body, S.objectOf({ items: S.array('object') }), 'evalDatasets');
  assert.equal(body.items.length, 2, '应返回 qc 与 sentiment 两个评测集（FR-EVAL-001）');
  const datasets = body.items.map((item, index) => {
    assertShape(
      item,
      S.objectOf({
        dataset: S.enum('qc', 'sentiment'),
        datasetId: S.nonEmptyString,
        version: S.nonEmptyString,
        itemCount: S.integerRange(0),
        description: S.nonEmptyString,
        lastRunAt: S.nullable(S.dateTime),
      }),
      `evalDatasets.items[${index}]`,
    );
    return item;
  });
  assertDeepEqual(
    datasets.map((item) => item.dataset).sort(),
    ['qc', 'sentiment'],
    '评测集 dataset 应包含 qc 与 sentiment',
  );
  const qc = datasets.find((item) => item.dataset === 'qc');
  const sentiment = datasets.find((item) => item.dataset === 'sentiment');
  assert.equal(qc.itemCount, 60, 'qc 评测集 itemCount 应为 60（FR-EVAL-001）');
  assert.equal(sentiment.itemCount, 120, 'sentiment 评测集 itemCount 应为 120（FR-EVAL-001）');
});

test('契约 GET /api/eval/runs：历史列表按 runAt 倒序', async () => {
  const body = assertOk(await get('/api/eval/runs'), 'GET /api/eval/runs');
  assertShape(body, S.objectOf({ items: S.array('object') }), 'evalRuns');
  assert.ok(body.items.length >= 2, `初始评测历史应 ≥ 2 条（种子含 qc 与 sentiment 首次评测），实际 ${body.items.length}`);
  for (const [index, item] of body.items.entries()) {
    assertShape(item, EVAL_RUN_SUMMARY_SHAPE, `evalRuns.items[${index}]`);
  }
  for (let index = 1; index < body.items.length; index += 1) {
    assert.ok(
      Date.parse(body.items[index - 1].runAt) >= Date.parse(body.items[index].runAt),
      '评测历史应按 runAt 倒序（FR-EVAL-003）',
    );
  }
  for (const dataset of ['qc', 'sentiment']) {
    const filtered = assertOk(await get('/api/eval/runs', { dataset }), `GET /api/eval/runs?dataset=${dataset}`);
    assertShape(filtered, S.objectOf({ items: S.array('object') }), `evalRuns?dataset=${dataset}`);
    for (const [index, item] of filtered.items.entries()) {
      assertShape(item, EVAL_RUN_SUMMARY_SHAPE, `evalRuns?dataset=${dataset}.items[${index}]`);
      assert.equal(item.dataset, dataset, `dataset=${dataset} 筛选应全部匹配`);
    }
  }
  assertFieldError(await get('/api/eval/runs', { dataset: 'bogus' }), { field: 'dataset', context: 'eval/runs?dataset=bogus' });
});

test('契约 POST /api/eval/runs 与 GET /api/eval/runs/{id}：评测运行与详情', async () => {
  const qcRun = assertOk(await post('/api/eval/runs', { dataset: 'qc' }), 'POST /api/eval/runs（qc）');
  assertShape(qcRun, EVAL_RUN_SHAPE, 'evalRun(qc)');
  assert.equal(qcRun.dataset, 'qc', 'qc 评测 run.dataset 应为 qc');
  for (const key of [
    'coverage',
    'accuracy',
    'verdictAccuracy',
    'falsePositiveRate',
    'falseNegativeRate',
    'reviewRatio',
    'avgLatencyMs',
  ]) {
    assert.equal(typeof qcRun.metrics[key], 'number', `qc metrics.${key} 应为 number（005 §3.9）`);
  }
  assert.equal(typeof qcRun.metrics.tagPrecision, 'object', 'qc metrics.tagPrecision 应为对象（005 §3.9）');
  for (const [tag, value] of Object.entries(qcRun.metrics.tagPrecision)) {
    assert.ok(QC_TAG_CODES.includes(tag), `tagPrecision 键应为标签 code，实际 ${tag}`);
    assert.equal(typeof value, 'number', `tagPrecision.${tag} 应为 number`);
  }
  assert.ok(qcRun.metrics.accuracy >= 0.8, `qc accuracy 应 ≥ 0.80（MET-QC-ACC），实际 ${qcRun.metrics.accuracy}`);
  for (const key of ['tp', 'fp', 'tn', 'fn']) {
    assert.ok(Number.isInteger(qcRun.confusion[key]), `qc confusion.${key} 应为整数`);
  }
  assert.equal(
    qcRun.confusion.tp + qcRun.confusion.fp + qcRun.confusion.tn + qcRun.confusion.fn,
    60,
    'qc 混淆矩阵总数应等于 60 条金标',
  );
  assert.ok(qcRun.mismatches.length <= 20, `mismatches 最多 20 条（005 §3.9），实际 ${qcRun.mismatches.length}`);
  assert.ok(Object.keys(qcRun.thresholdsMet).length > 0, 'thresholdsMet 应为非空对象');
  for (const [gate, met] of Object.entries(qcRun.thresholdsMet)) {
    assert.equal(typeof met, 'boolean', `thresholdsMet.${gate} 应为 boolean`);
  }

  const sentimentRun = assertOk(await post('/api/eval/runs', { dataset: 'sentiment' }), 'POST /api/eval/runs（sentiment）');
  assertShape(sentimentRun, EVAL_RUN_SHAPE, 'evalRun(sentiment)');
  assert.equal(sentimentRun.dataset, 'sentiment', 'sentiment 评测 run.dataset 应为 sentiment');
  for (const key of ['sentimentAccuracy', 'topicAccuracy', 'alertPrecision', 'alertRecall', 'p0Recall', 'reviewRatio']) {
    assert.equal(typeof sentimentRun.metrics[key], 'number', `sentiment metrics.${key} 应为 number（005 §3.9）`);
  }
  assert.ok(
    sentimentRun.metrics.sentimentAccuracy >= 0.8,
    `sentimentAccuracy 应 ≥ 0.80（MET-SEN-SA），实际 ${sentimentRun.metrics.sentimentAccuracy}`,
  );
  assert.ok(
    sentimentRun.metrics.topicAccuracy >= 0.75,
    `topicAccuracy 应 ≥ 0.75（MET-SEN-TA），实际 ${sentimentRun.metrics.topicAccuracy}`,
  );
  assert.ok(
    sentimentRun.metrics.alertPrecision >= 0.8,
    `alertPrecision 应 ≥ 0.80（MET-SEN-AP），实际 ${sentimentRun.metrics.alertPrecision}`,
  );
  assert.equal(
    sentimentRun.confusion.tp + sentimentRun.confusion.fp + sentimentRun.confusion.tn + sentimentRun.confusion.fn,
    120,
    'sentiment 混淆矩阵总数应等于 120 条金标',
  );

  const detail = assertOk(await get(`/api/eval/runs/${qcRun.id}`), 'GET /api/eval/runs/{id}');
  assertShape(detail, EVAL_RUN_SHAPE, 'evalRunDetail');
  assert.equal(detail.id, qcRun.id, '评测详情 id 应等于路径参数');
  assertDeepEqual(detail.metrics, qcRun.metrics, '评测详情 metrics 应与运行响应一致');
  assertDeepEqual(detail.confusion, qcRun.confusion, '评测详情 confusion 应与运行响应一致');

  assertErrorResponse(await get('/api/eval/runs/run-does-not-exist'), {
    status: 404,
    code: ERROR_CODE_BY_STATUS[404],
    context: 'GET /api/eval/runs/run-does-not-exist',
  });
  assertFieldError(await post('/api/eval/runs', { dataset: 'bogus' }), { field: 'dataset', context: 'POST eval/runs（非法 dataset）' });
  assertFieldError(await post('/api/eval/runs', {}), { field: 'dataset', context: 'POST eval/runs（缺 dataset）' });
});
