/**
 * QCC Workbench · 端到端验收测试（acceptance.test.mjs）
 * =============================================================================
 * 串行执行（package.json 中 --test-concurrency=1），所有用例共享同一进程与同一
 * API 演示态；`before` 中先探测 API 并 POST /api/admin/reset 归零，`after` 中再次
 * reset 收尾，保证可重复、不依赖执行顺序。
 *
 * 覆盖 specs/traceability.md 的验收型 TEST-ID：
 *  QC：TEST-QC-COV-01、TEST-QC-RULE-01..06、TEST-QC-EVID-01、TEST-QC-STAT-01、
 *      TEST-QC-LIST-01..03、TEST-QC-REV-01..03、TEST-MASK-01
 *  badcase：TEST-BC-CREATE-01/02、TEST-BC-ROUTE-01、TEST-BC-SM-01..04、
 *      TEST-BC-RECUR-01、TEST-TRACE-01、TEST-BC-LIST-01、TEST-BC-STAT-01、TEST-BC-DETAIL-01
 *  舆情：TEST-SEN-STAT-01、TEST-SEN-COMMENT-01、TEST-SEN-ANA-01、TEST-SEN-TOPIC-01、
 *      TEST-SEN-ALERT-01..03、TEST-SEN-SOP-01..03、TEST-SEN-CLUE-01
 *  线索：TEST-CLUE-CREATE-01/02、TEST-CLUE-SM-01..03、TEST-CLUE-LIST-01、TEST-CLUE-DETAIL-01
 *  看板：TEST-DASH-01/02、TEST-DRILL-01/02
 *  评测：TEST-EVAL-QC-01..03、TEST-EVAL-DS-01、TEST-EVAL-HIST-01/02、TEST-EVAL-RUN-01、
 *      TEST-EVAL-DET-01、TEST-COST-01
 *  其他：TEST-RESET-01、TEST-PERF-01
 *
 * 断言口径：按 002 功能规格 + 005 契约（v0.1.1，Lead m00224 裁决）+ 004 数据模型 +
 * 007 评测规范冻结值断言，不得为通过而放宽状态码/枚举/SLA/阈值。
 */
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import {
  ALERT_SLA_MINUTES,
  BADCASE_SLA_BY_CATEGORY,
  ERROR_CODE_BY_STATUS,
  OWNER_ROUTING,
  QC_TAG_CODES,
  QC_TAG_WEIGHTS,
  SEVERITY_RANK,
  assertApprox,
  assertDeepEqual,
  assertErrorResponse,
  assertIsoDate,
  assertOk,
  ensureApi,
  get,
  listAll,
  post,
  resetDemoData,
} from './helpers.mjs';

const DEMO_NOW = Date.parse('2026-11-03T10:00:00+08:00');
const SEEDED_CONVERSATIONS = 60;
const SEEDED_COMMENTS = 120;
const REVIEWER = '沈言';

const QC_VERDICTS = ['pass', 'violation'];
const QC_EMOTIONS = ['calm', 'anxious', 'angry'];
const SEVERITIES = ['low', 'medium', 'high'];
const BADCASE_CATEGORIES = ['knowledge', 'script', 'process', 'system'];
const BADCASE_STATUSES = ['open', 'in_progress', 'pending_verify', 'closed'];
const ALERT_LEVELS = ['P0', 'P1', 'P2'];
const ALERT_STATUSES = ['new', 'acknowledged', 'responding', 'escalated', 'resolved'];
const CLUE_SOURCES = ['qc', 'sentiment', 'dashboard', 'agent'];
const CLUE_TARGETS = ['product', 'brand', 'market', 'cs'];
const CLUE_PRIORITIES = ['high', 'medium', 'low'];
const CLUE_STATUSES = ['draft', 'routed', 'accepted', 'rejected', 'closed'];
const KPI_IDS = [
  'qcCoverage',
  'qcAccuracy',
  'badcaseCloseRate',
  'p0ResponseMin',
  'alertPrecision',
  'clueCloseRate',
  'csat',
];
const KPI_UNITS = ['percent', 'min', 'count', 'score', 'sec'];
const DRILL_TYPES = ['qc', 'sentiment', 'badcase', 'clue'];
const DRILL_LIST_PATH = {
  qc: '/api/qc/conversations',
  sentiment: '/api/sentiment/alerts',
  badcase: '/api/badcases',
  clue: '/api/clues',
};
const QC_METRIC_KEYS = [
  'coverage',
  'accuracy',
  'verdictAccuracy',
  'falsePositiveRate',
  'falseNegativeRate',
  'reviewRatio',
  'avgLatencyMs',
  'tagPrecision',
];
const SENTIMENT_METRIC_KEYS = [
  'sentimentAccuracy',
  'topicAccuracy',
  'alertPrecision',
  'alertRecall',
  'p0Recall',
  'reviewRatio',
];
// 脱敏（TEST-MASK-01）：不含未打码 11 位手机号/邮箱
const RAW_MOBILE_PATTERN = /(?<!\d)1[3-9]\d{9}(?!\d)/;
const RAW_EMAIL_PATTERN = /(?<![*\w.+-])[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/;

const round3 = (value) => Math.round(value * 1000) / 1000;
const sum = (values) => values.reduce((total, value) => total + value, 0);
const mean = (values) => (values.length === 0 ? null : sum(values) / values.length);
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNonNegativeInteger = (value) => Number.isInteger(value) && value >= 0;
const tagCodes = (qcResult) => qcResult.tags.map((tag) => tag.code);
const minutesBetween = (laterIso, earlierIso) => (Date.parse(laterIso) - Date.parse(earlierIso)) / 60_000;
const percentile = (values, ratio) => {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(ratio * sorted.length) - 1);
  return sorted[Math.max(0, index)];
};

// ---------------------------------------------------------------------------
// 演示态快照（before 中在 reset 之后加载；用例只读，不回写）
// ---------------------------------------------------------------------------
const ctx = {
  resetResult: null,
  conversations: [],
  qcDetails: [],
  qcStats: null,
  comments: [],
  alerts: [],
  alertDetails: [],
  badcases: [],
  clues: [],
  reviewedBaseline: 0,
  reviewedConversationIds: new Set(),
  createdBadcases: [],
  createdClues: [],
  sopAlertId: null,
};

const findQcDetail = (predicate, label) => {
  const found = ctx.qcDetails.find(predicate);
  assert.ok(found, `未找到${label}（请检查种子数据是否满足验收前置条件）`);
  return found;
};

const isReviewPending = (detail) => detail.review === null || detail.review.status === 'pending';

before(async () => {
  await ensureApi();
  ctx.resetResult = await resetDemoData('验收前置 reset');

  ctx.conversations = await listAll('/api/qc/conversations', {}, '验证据前置 qcConversations');
  ctx.qcDetails = await Promise.all(
    ctx.conversations.map(async (item) =>
      assertOk(await get(`/api/qc/conversations/${item.id}`), `GET /api/qc/conversations/${item.id}（验收快照）`),
    ),
  );
  ctx.qcStats = assertOk(await get('/api/qc/stats'), 'GET /api/qc/stats（验收快照）');
  ctx.comments = await listAll('/api/sentiment/comments', {}, '验证据前置 sentimentComments');
  ctx.alerts = await listAll('/api/sentiment/alerts', {}, '验证据前置 sentimentAlerts');
  ctx.alertDetails = await Promise.all(
    ctx.alerts.map(async (item) =>
      assertOk(await get(`/api/sentiment/alerts/${item.id}`), `GET /api/sentiment/alerts/${item.id}（验收快照）`),
    ),
  );
  ctx.badcases = await listAll('/api/badcases', {}, '验证据前置 badcases');
  ctx.clues = await listAll('/api/clues', {}, '验证据前置 clues');
  ctx.reviewedBaseline = ctx.qcDetails.filter((detail) => detail.review?.status === 'done').length;
});

after(async () => {
  // 收尾：保证演示态归零，不影响其它测试文件/手动演示（NFR-006）
  await resetDemoData('验收收尾 reset');
});

// ===========================================================================
// 1. 全量质检与规则引擎一致性
// ===========================================================================
test('验收 QC 全量质检与规则一致性（TEST-QC-COV-01 / TEST-QC-RULE-01..06 / TEST-QC-EVID-01）', () => {
  assert.equal(
    ctx.qcDetails.length,
    SEEDED_CONVERSATIONS,
    `全部 ${SEEDED_CONVERSATIONS} 条对话都应可查询详情（FR-QC-001）`,
  );

  const tagCodesSeen = new Set();
  for (const detail of ctx.qcDetails) {
    const { conversation, qcResult } = detail;
    const where = `对话 ${conversation.id}`;
    assert.ok(isPlainObject(qcResult), `${where} 应有 QcResult（FR-QC-001 全量质检）`);
    assert.equal(qcResult.conversationId, conversation.id, `${where}：qcResult.conversationId 应指向该对话`);
    assert.equal(qcResult.verdict === 'pass' || qcResult.verdict === 'violation', true, `${where}：verdict 枚举非法`);
    assert.ok(isNonNegativeInteger(qcResult.score) && qcResult.score <= 100, `${where}：score 应为 0–100 整数`);
    assert.ok(isPlainObject(qcResult.tags) === false && Array.isArray(qcResult.tags), `${where}：tags 应为数组`);

    // FR-QC-004 / BR-01：score = clamp(100 + Σ标签扣分, 0, 100)
    const weightedScore = 100 + sum(qcResult.tags.map((tag) => QC_TAG_WEIGHTS[tag.code]));
    const expectedScore = Math.max(0, Math.min(100, weightedScore));
    assert.equal(qcResult.score, expectedScore, `${where}：score 应按标签权重扣分计算（FR-QC-004），实际 ${qcResult.score}`);

    // BR-02：有标签即 violation，无标签即 pass
    assert.equal(
      qcResult.verdict,
      qcResult.tags.length > 0 ? 'violation' : 'pass',
      `${where}：verdict 应与 tags 是否为空一致（BR-02）`,
    );

    // FR-QC-004：tags 按 severity 降序，再按 confidence 降序
    for (let index = 1; index < qcResult.tags.length; index += 1) {
      const previous = qcResult.tags[index - 1];
      const current = qcResult.tags[index];
      assert.ok(SEVERITIES.includes(previous.severity), `${where}：tag.severity 枚举非法：${previous.severity}`);
      assert.ok(SEVERITIES.includes(current.severity), `${where}：tag.severity 枚举非法：${current.severity}`);
      const severityDelta = SEVERITY_RANK[previous.severity] - SEVERITY_RANK[current.severity];
      assert.ok(
        severityDelta > 0 || (severityDelta === 0 && previous.confidence >= current.confidence),
        `${where}：tags 应按 severity 降序、confidence 降序排列（FR-QC-004）`,
      );
    }

    // FR-QC-005 / BR-03：confidence < 0.75 必须进入人工复核
    if (qcResult.confidence < 0.75) {
      assert.equal(qcResult.needsReview, true, `${where}：confidence<0.75 时 needsReview 必须为 true（FR-QC-005）`);
    }

    // 质检结果其余字段
    assert.ok(typeof qcResult.summary === 'string' && qcResult.summary.trim() !== '', `${where}：summary 应为非空字符串`);
    assert.ok(QC_EMOTIONS.includes(qcResult.emotion), `${where}：emotion 应为 calm|anxious|angry`);
    assert.ok(
      typeof qcResult.confidence === 'number' && qcResult.confidence >= 0 && qcResult.confidence <= 1,
      `${where}：confidence 应落在 [0,1]`,
    );
    assert.ok(typeof qcResult.needsReview === 'boolean', `${where}：needsReview 应为布尔值`);
    assert.ok(typeof qcResult.modelVersion === 'string' && qcResult.modelVersion.trim() !== '', `${where}：modelVersion 应非空`);
    assertIsoDate(qcResult.analyzedAt, `${where}.qcResult.analyzedAt`);
    assert.ok(
      qcResult.latestReviewId === null || typeof qcResult.latestReviewId === 'string',
      `${where}：latestReviewId 应为 null 或字符串`,
    );

    // FR-QC-003 / TEST-QC-EVID-01：证据 seq 必须命中原文消息，quote 必须是原文子串
    const messageTextBySeq = new Map(conversation.messages.map((message) => [message.seq, message.text]));
    for (const message of conversation.messages) {
      assert.ok(isPlainObject(message), `${where}：message 应为对象`);
      assert.equal(typeof message.text, 'string', `${where}：message.text 应为字符串`);
      assert.equal(typeof message.atSec, 'number', `${where}：message.atSec 应为数字`);
    }
    for (let index = 1; index < conversation.messages.length; index += 1) {
      assert.ok(
        conversation.messages[index - 1].seq < conversation.messages[index].seq,
        `${where}：messages 应按 seq 升序返回（FR-QC-003）`,
      );
    }
    for (const tag of qcResult.tags) {
      assert.ok(QC_TAG_CODES.includes(tag.code), `${where}：tag.code 非法：${tag.code}`);
      tagCodesSeen.add(tag.code);
      assert.ok(typeof tag.name === 'string' && tag.name.trim() !== '', `${where}：tag.name 应非空（${tag.code}）`);
      assert.ok(SEVERITIES.includes(tag.severity), `${where}：tag.severity 非法（${tag.code}）`);
      assert.equal(typeof tag.ruleId, 'string', `${where}：tag.ruleId 应为字符串（${tag.code}）`);
      assert.ok(tag.ruleId.length > 0, `${where}：tag.ruleId 应非空（${tag.code}）`);
      assert.ok(Array.isArray(tag.evidence), `${where}：tag.evidence 应为数组（${tag.code}）`);
      assert.ok(tag.evidence.length >= 1, `${where}：每个标签应至少 1 条证据（FR-QC-003）`);
      for (const evidence of tag.evidence) {
        assert.ok(isPlainObject(evidence), `${where}：evidence 应为对象`);
        assert.ok(
          messageTextBySeq.has(evidence.seq),
          `${where}：标签 ${tag.code} 的证据 seq=${evidence.seq} 应指向存在的消息（FR-QC-003）`,
        );
        assert.ok(
          typeof evidence.quote === 'string' && evidence.quote.length > 0,
          `${where}：标签 ${tag.code} 的证据 quote 应非空`,
        );
        assert.ok(
          messageTextBySeq.get(evidence.seq).includes(evidence.quote),
          `${where}：标签 ${tag.code} 的证据 quote 必须是 seq=${evidence.seq} 消息原文的子串（FR-QC-003）`,
        );
      }
    }
  }

  assertDeepEqual(
    [...tagCodesSeen].sort(),
    [...QC_TAG_CODES].sort(),
    '全量质检结果应覆盖 6 类标签规则（TEST-QC-RULE-01..06）',
  );
});

// ===========================================================================
// 2. QC 统计口径与列表筛选
// ===========================================================================
test('验收 QC 统计口径与列表筛选排序（TEST-QC-STAT-01 / TEST-QC-LIST-01..03）', async () => {
  const details = ctx.qcDetails;
  const stats = assertOk(await get('/api/qc/stats'), 'GET /api/qc/stats');
  assert.equal(stats.total, SEEDED_CONVERSATIONS, 'stats.total 应为 60');
  assert.equal(stats.analyzed, SEEDED_CONVERSATIONS, 'stats.analyzed 应为 60（全部对话完成质检）');
  assert.equal(stats.pass, details.filter((detail) => detail.qcResult.verdict === 'pass').length, 'stats.pass 口径');
  assert.equal(stats.violation, details.filter((detail) => detail.qcResult.verdict === 'violation').length, 'stats.violation 口径');
  assert.equal(stats.total, stats.pass + stats.violation, 'total 应等于 pass + violation（FR-QC-006）');
  assert.equal(
    stats.needsReview,
    details.filter((detail) => detail.qcResult.needsReview === true).length,
    'stats.needsReview 应为 needsReview=true 的质检结果数',
  );
  assert.equal(
    stats.reviewed,
    details.filter((detail) => detail.review?.status === 'done').length,
    'stats.reviewed 应为已完成复核数',
  );
  const averageScore = mean(details.map((detail) => detail.qcResult.score));
  assertApprox(stats.avgScore, averageScore, 0.06, 'avgScore 应为全量质检平均分（FR-QC-006）');
  assert.equal(
    stats.reviewRatio,
    round3(stats.needsReview / stats.analyzed),
    'reviewRatio 应等于 needsReview/analyzed 并保留 3 位小数（FR-QC-006）',
  );

  // tagDistribution：多标签重复计数（FR-QC-006）
  const expectedTagCounts = Object.fromEntries(QC_TAG_CODES.map((code) => [code, 0]));
  for (const detail of details) {
    for (const code of tagCodes(detail.qcResult)) expectedTagCounts[code] += 1;
  }
  const tagDistribution = Object.fromEntries(stats.tagDistribution.map((item) => [item.code, item.count]));
  assertDeepEqual(tagDistribution, expectedTagCounts, 'tagDistribution 应按标签实例重复计数（FR-QC-006）');
  assert.equal(
    sum(stats.tagDistribution.map((item) => item.count)),
    sum(Object.values(expectedTagCounts)),
    'tagDistribution 计数之和应等于标签实例总数',
  );

  // channelDistribution：按渠道计数且和为 60
  const expectedChannelCounts = {};
  for (const detail of details) {
    const channel = detail.conversation.channel;
    expectedChannelCounts[channel] = (expectedChannelCounts[channel] ?? 0) + 1;
  }
  const channelDistribution = Object.fromEntries(stats.channelDistribution.map((item) => [item.channel, item.count]));
  assertDeepEqual(channelDistribution, expectedChannelCounts, 'channelDistribution 应按渠道精确计数');
  assert.equal(sum(stats.channelDistribution.map((item) => item.count)), SEEDED_CONVERSATIONS);

  // 列表筛选：verdict（TEST-QC-LIST-01）
  const violations = await listAll('/api/qc/conversations', { verdict: 'violation' }, 'qcList?verdict=violation');
  assert.equal(violations.length, stats.violation, 'verdict=violation 的 total 应等于 stats.violation');
  for (const item of violations) assert.equal(item.verdict, 'violation', `列表项 ${item.id} verdict 应为 violation`);
  const passes = await listAll('/api/qc/conversations', { verdict: 'pass' }, 'qcList?verdict=pass');
  assert.equal(passes.length, stats.pass, 'verdict=pass 的 total 应等于 stats.pass');

  // tag 筛选：total 为去重对话数（FR-QC-002）
  for (const code of ['attitude', 'forbidden']) {
    const filtered = await listAll('/api/qc/conversations', { tag: code }, `qcList?tag=${code}`);
    const expectedCount = details.filter((detail) => tagCodes(detail.qcResult).includes(code)).length;
    assert.equal(filtered.length, expectedCount, `tag=${code} 的 total 应为含该标签的对话数（FR-QC-002）`);
    for (const item of filtered) {
      assert.ok(
        item.tags.some((tag) => tag.code === code),
        `tag=${code} 返回项 ${item.id} 应包含该标签（FR-QC-002）`,
      );
    }
  }

  // review=pending：真实待复核（needsReview=true 且未 done 的语义）（FR-QC-002）
  const pending = await listAll('/api/qc/conversations', { review: 'pending' }, 'qcList?review=pending');
  assert.ok(pending.length > 0, 'review=pending 应有待复核项（种子 13 条 needsReview）');
  for (const item of pending) {
    assert.equal(item.needsReview, true, `review=pending 返回项 ${item.id} 应 needsReview=true（FR-QC-002）`);
  }
  assert.ok(pending.length <= stats.needsReview, 'review=pending 数不应超过 needsReview 总数');
  const reviewed = await listAll('/api/qc/conversations', { review: 'done' }, 'qcList?review=done');
  assert.equal(reviewed.length, stats.reviewed, 'review=done 的 total 应等于 stats.reviewed');

  // 排序（TEST-QC-LIST-02 / FR-QC-009）
  const byScoreAsc = await listAll('/api/qc/conversations', { sort: 'score_asc' }, 'qcList?sort=score_asc');
  assert.equal(byScoreAsc.length, SEEDED_CONVERSATIONS);
  for (let index = 1; index < byScoreAsc.length; index += 1) {
    assert.ok(byScoreAsc[index - 1].score <= byScoreAsc[index].score, 'score_asc 应按分数升序');
  }
  const byScoreDesc = await listAll('/api/qc/conversations', { sort: 'score_desc' }, 'qcList?sort=score_desc');
  for (let index = 1; index < byScoreDesc.length; index += 1) {
    assert.ok(byScoreDesc[index - 1].score >= byScoreDesc[index].score, 'score_desc 应按分数降序');
  }
  const byTimeAsc = await listAll('/api/qc/conversations', { sort: 'time_asc' }, 'qcList?sort=time_asc');
  for (let index = 1; index < byTimeAsc.length; index += 1) {
    assert.ok(
      Date.parse(byTimeAsc[index - 1].startedAt) <= Date.parse(byTimeAsc[index].startedAt),
      'time_asc 应按开始时间升序',
    );
  }
  const defaultList = await listAll('/api/qc/conversations', {}, 'qcList?默认排序');
  for (let index = 1; index < defaultList.length; index += 1) {
    assert.ok(
      Date.parse(defaultList[index - 1].startedAt) >= Date.parse(defaultList[index].startedAt),
      '默认排序应为 time_desc（FR-QC-009）',
    );
  }

  // 分页无重无漏（TEST-QC-LIST-03）
  const pageOne = assertOk(await get('/api/qc/conversations', { page: 1, pageSize: 7, sort: 'score_desc' }), 'qcList page=1');
  const pageTwo = assertOk(await get('/api/qc/conversations', { page: 2, pageSize: 7, sort: 'score_desc' }), 'qcList page=2');
  assert.equal(pageOne.pageSize, 7);
  assert.equal(pageOne.items.length, 7);
  assert.equal(pageTwo.items.length, 7);
  const pageOneIds = new Set(pageOne.items.map((item) => item.id));
  for (const item of pageTwo.items) {
    assert.ok(!pageOneIds.has(item.id), `分页第 1/2 页不应重复（重复项 ${item.id}）`);
  }

  // 关键词检索（FR-QC-002）：按坐席名检索，命中项摘要/坐席/ID 至少一处包含关键词（TEST-QC-LIST-01）
  const sampleAgentName = details[0].conversation.agent.name;
  const searched = await listAll('/api/qc/conversations', { q: sampleAgentName }, 'qcList?q=坐席名');
  assert.ok(searched.length > 0, `q=${sampleAgentName} 应能命中对话（FR-QC-002）`);
  for (const item of searched) {
    assert.ok(
      item.agentName.includes(sampleAgentName) ||
        item.summary.includes(sampleAgentName) ||
        item.id.includes(sampleAgentName),
      `q 命中项 ${item.id} 应在摘要/坐席/ID 中包含关键词（FR-QC-002）`,
    );
  }
});

// ===========================================================================
// 3. 人工复核闭环
// ===========================================================================
test('验收 QC 人工复核闭环（TEST-QC-REV-01..03 / FR-QC-005）', async () => {
  const confirmCandidate = findQcDetail(
    (detail) => detail.qcResult.needsReview === true && isReviewPending(detail),
    '待确认（confirm）的 needsReview 对话',
  );
  const amendCandidate = findQcDetail(
    (detail) =>
      detail.qcResult.verdict === 'violation' &&
      isReviewPending(detail) &&
      detail.conversation.id !== confirmCandidate.conversation.id,
    '待修正（amend）的违规对话',
  );
  const overturnCandidate = findQcDetail(
    (detail) =>
      detail.qcResult.verdict === 'violation' &&
      isReviewPending(detail) &&
      ![confirmCandidate.conversation.id, amendCandidate.conversation.id].includes(detail.conversation.id),
    '待改判（overturn）的违规对话',
  );
  const validationCandidate = findQcDetail(
    (detail) =>
      isReviewPending(detail) &&
      ![confirmCandidate, amendCandidate, overturnCandidate].some(
        (used) => used.conversation.id === detail.conversation.id,
      ),
    '参数校验用的待复核对话',
  );

  // ---- 1) confirm：认可 AI 判定（TEST-QC-REV-01）----
  const confirmBefore = confirmCandidate.qcResult;
  const confirmResponse = assertOk(
    await post(`/api/qc/conversations/${confirmCandidate.conversation.id}/reviews`, {
      decision: 'confirm',
      note: '验收：认可 AI 判定',
      reviewer: REVIEWER,
    }),
    'POST reviews（confirm）',
  );
  assert.equal(confirmResponse.review.status, 'done', 'confirm 后 review.status 应为 done');
  assert.equal(confirmResponse.review.decision, 'confirm', 'confirm 后 review.decision 应为 confirm');
  assert.equal(confirmResponse.review.conversationId, confirmCandidate.conversation.id);
  assert.equal(confirmResponse.review.qcResultId, confirmBefore.id);
  assertIsoDate(confirmResponse.review.reviewedAt, 'confirm.review.reviewedAt');
  assert.equal(
    confirmResponse.review.finalVerdict,
    confirmBefore.verdict,
    'confirm 的 finalVerdict 应与 AI 判定一致（FR-QC-005）',
  );
  assert.equal(confirmResponse.qcResult.needsReview, false, 'confirm 后 qcResult.needsReview 应为 false（FR-QC-005）');
  assert.equal(
    confirmResponse.qcResult.latestReviewId,
    confirmResponse.review.id,
    'confirm 后 latestReviewId 应指向本次复核',
  );
  assertDeepEqual(tagCodes(confirmResponse.qcResult), tagCodes(confirmBefore), 'confirm 不应改变标签');
  assert.equal(confirmResponse.qcResult.score, confirmBefore.score, 'confirm 不应改变评分');

  // 重复复核 → 409（契约 v0.1.1：done 为终态，003 §5.2）
  assertErrorResponse(
    await post(`/api/qc/conversations/${confirmCandidate.conversation.id}/reviews`, {
      decision: 'confirm',
      reviewer: REVIEWER,
    }),
    { status: 409, code: ERROR_CODE_BY_STATUS[409], context: 'POST reviews（done 后重复提交）' },
  );

  // ---- 2) amend：修正标签（TEST-QC-REV-02）----
  const amendResponse = assertOk(
    await post(`/api/qc/conversations/${amendCandidate.conversation.id}/reviews`, {
      decision: 'amend',
      finalTags: ['wrong_knowledge'],
      note: '验收：修正为知识错误',
      reviewer: REVIEWER,
    }),
    'POST reviews（amend）',
  );
  assert.equal(amendResponse.review.decision, 'amend');
  assert.equal(amendResponse.review.status, 'done');
  assertDeepEqual(amendResponse.review.finalTags, ['wrong_knowledge'], 'amend 的 finalTags 应等于请求值');
  assert.equal(amendResponse.review.finalVerdict, 'violation', 'amend 后判定应为 violation');
  assertDeepEqual(tagCodes(amendResponse.qcResult), ['wrong_knowledge'], 'amend 后 qcResult.tags 应替换为 finalTags');
  assert.equal(amendResponse.qcResult.verdict, 'violation', '有标签时判定必须为 violation（BR-02）');
  assert.equal(amendResponse.qcResult.needsReview, false, 'amend 后 needsReview 应为 false');
  assert.equal(amendResponse.qcResult.latestReviewId, amendResponse.review.id, 'amend 后 latestReviewId 应指向本次复核');

  // ---- 3) overturn：改判为正常（TEST-QC-REV-03）----
  const overturnResponse = assertOk(
    await post(`/api/qc/conversations/${overturnCandidate.conversation.id}/reviews`, {
      decision: 'overturn',
      finalTags: [],
      note: '验收：误报改判',
      reviewer: REVIEWER,
    }),
    'POST reviews（overturn）',
  );
  assert.equal(overturnResponse.review.decision, 'overturn');
  assert.equal(overturnResponse.review.status, 'done');
  assert.equal(overturnResponse.qcResult.verdict, 'pass', 'overturn 后判定应为 pass（FR-QC-005）');
  assertDeepEqual(overturnResponse.qcResult.tags, [], 'overturn 后标签应清空（FR-QC-005）');
  assert.equal(overturnResponse.qcResult.needsReview, false, 'overturn 后 needsReview 应为 false');
  assert.equal(overturnResponse.qcResult.latestReviewId, overturnResponse.review.id);

  // 复核结果持久化：详情返回 done 复核与最新质检结果
  for (const [candidate, expectedDecision] of [
    [confirmCandidate, 'confirm'],
    [amendCandidate, 'amend'],
    [overturnCandidate, 'overturn'],
  ]) {
    const detail = assertOk(
      await get(`/api/qc/conversations/${candidate.conversation.id}`),
      `GET /api/qc/conversations/${candidate.conversation.id}（复核后详情）`,
    );
    assert.equal(detail.review.status, 'done', `复核后详情 review.status 应为 done（${candidate.conversation.id}）`);
    assert.equal(detail.review.decision, expectedDecision, `详情 review.decision 应为 ${expectedDecision}`);
    assert.equal(detail.qcResult.needsReview, false, '复核后详情 qcResult.needsReview 应为 false');
    ctx.reviewedConversationIds.add(candidate.conversation.id);
  }

  // ---- 4) 参数校验 422（TEST-QC-REV-02 边界）----
  const validationConversationId = validationCandidate.conversation.id;
  assertErrorResponse(
    await post(`/api/qc/conversations/${validationConversationId}/reviews`, { decision: 'amend' }),
    {
      status: 422,
      code: ERROR_CODE_BY_STATUS[422],
      field: 'finalTags',
      context: 'POST reviews（amend 缺 finalTags）',
    },
  );
  assertErrorResponse(
    await post(`/api/qc/conversations/${validationConversationId}/reviews`, {
      decision: 'overturn',
      finalTags: ['attitude'],
    }),
    {
      status: 422,
      code: ERROR_CODE_BY_STATUS[422],
      field: 'finalTags',
      context: 'POST reviews（overturn 传非空 finalTags）',
    },
  );
  assertErrorResponse(
    await post(`/api/qc/conversations/${validationConversationId}/reviews`, { decision: 'bogus' }),
    { status: 422, code: ERROR_CODE_BY_STATUS[422], field: 'decision', context: 'POST reviews（非法 decision）' },
  );
  assertErrorResponse(
    await post('/api/qc/conversations/conv-does-not-exist/reviews', { decision: 'confirm' }),
    { status: 404, code: ERROR_CODE_BY_STATUS[404], context: 'POST reviews（对话不存在）' },
  );

  // ---- 5) 复核与统计/列表联动（TEST-QC-REV-03）----
  const stats = assertOk(await get('/api/qc/stats'), 'GET /api/qc/stats（复核后）');
  assert.equal(stats.reviewed, ctx.reviewedBaseline + 3, '复核后 reviewed 应增加 3');
  const needsReviewItems = await listAll('/api/qc/conversations', { review: 'pending' }, 'qcList?review=pending（复核后）');
  for (const reviewedId of ctx.reviewedConversationIds) {
    assert.ok(
      !needsReviewItems.some((item) => item.id === reviewedId),
      `已完成复核的对话 ${reviewedId} 不应再出现在 review=pending 列表（FR-QC-002）`,
    );
  }
  const liveDetails = await Promise.all(
    [...ctx.reviewedConversationIds].map(async (id) =>
      assertOk(await get(`/api/qc/conversations/${id}`), `GET /api/qc/conversations/${id}（统计联动）`),
    ),
  );
  const expectedNeedsReview = ctx.qcDetails.filter(
    (detail) => detail.qcResult.needsReview === true && !ctx.reviewedConversationIds.has(detail.conversation.id),
  ).length;
  assert.equal(
    stats.needsReview,
    expectedNeedsReview,
    '复核后 needsReview 应为基线 needsReview - 本次复核中原 needsReview 数',
  );
  const expectedAnalyzed = stats.analyzed;
  assert.equal(stats.reviewRatio, round3(stats.needsReview / expectedAnalyzed), '复核后 reviewRatio 应按新 needsReview 重算');
  for (const detail of liveDetails) {
    assert.equal(detail.qcResult.needsReview, false, '已复核对话 needsReview 应为 false');
    assert.ok(detail.review.reviewedAt !== null, '已复核对话 review.reviewedAt 应非空');
  }
});

// ===========================================================================
// 4. 脱敏（NFR-003 / TEST-MASK-01）
// ===========================================================================
test('验收 脱敏：对话/评论响应不含完整手机号与邮箱（TEST-MASK-01 / FR-QC-010）', () => {
  for (const detail of ctx.qcDetails) {
    const where = `对话 ${detail.conversation.id}`;
    for (const message of detail.conversation.messages) {
      assert.ok(
        !RAW_MOBILE_PATTERN.test(message.text),
        `${where} 的 message seq=${message.seq} 含完整手机号：${JSON.stringify(message.text)}（FR-QC-010）`,
      );
      assert.ok(
        !RAW_EMAIL_PATTERN.test(message.text),
        `${where} 的 message seq=${message.seq} 含完整邮箱：${JSON.stringify(message.text)}（FR-QC-010）`,
      );
    }
    assert.ok(
      !RAW_MOBILE_PATTERN.test(detail.conversation.customer.name),
      `${where} 的 customer.name 含完整手机号（FR-QC-010）`,
    );
  }
  for (const comment of ctx.comments) {
    assert.ok(
      !RAW_MOBILE_PATTERN.test(comment.text),
      `评论 ${comment.id} 含完整手机号：${JSON.stringify(comment.text)}（FR-QC-010）`,
    );
    assert.ok(
      !RAW_EMAIL_PATTERN.test(comment.text),
      `评论 ${comment.id} 含完整邮箱：${JSON.stringify(comment.text)}（FR-QC-010）`,
    );
  }
});

// ===========================================================================
// 5. badcase 创建 / 路由 / SLA / 状态机 / 列表统计
// ===========================================================================
test('验收 badcase 创建、路由与 SLA（TEST-BC-CREATE-01/02 / TEST-BC-ROUTE-01 / FR-BC-001/002）', async () => {
  const usedConversationIds = new Set();
  for (const category of BADCASE_CATEGORIES) {
    const source = findQcDetail(
      (detail) =>
        detail.qcResult.verdict === 'violation' &&
        detail.badcase === null &&
        !ctx.reviewedConversationIds.has(detail.conversation.id) &&
        !usedConversationIds.has(detail.conversation.id),
      `可转 badcase 的违规对话（category=${category}）`,
    );
    usedConversationIds.add(source.conversation.id);
    const created = assertOk(
      await post(`/api/qc/conversations/${source.conversation.id}/badcases`, { category }),
      `POST badcases（category=${category}，省略 owner/slaHours/title）`,
    );

    assert.match(created.code, /^BC-\d{4}-\d{4}$/, `badcase.code 应形如 BC-2026-0001（FR-BC-001），实际 ${created.code}`);
    assert.equal(created.category, category, 'badcase.category 应为请求值');
    assert.equal(created.status, 'open', '新建 badcase.status 应为 open（FR-BC-001）');
    assert.equal(created.conversationId, source.conversation.id, 'badcase.conversationId 应为来源对话');
    assert.equal(created.qcResultId, source.qcResult.id, 'badcase.qcResultId 应为来源质检结果');
    assert.equal(
      created.owner,
      OWNER_ROUTING.badcase[category],
      `category=${category} 缺省责任人应为 ${OWNER_ROUTING.badcase[category]}（FR-BC-002）`,
    );
    assert.equal(
      created.slaHours,
      BADCASE_SLA_BY_CATEGORY[category],
      `category=${category} 缺省 SLA 应为 ${BADCASE_SLA_BY_CATEGORY[category]}h（FR-BC-002 / 契约 v0.1.1）`,
    );
    assert.equal(
      Date.parse(created.dueAt) - Date.parse(created.createdAt),
      BADCASE_SLA_BY_CATEGORY[category] * 3_600_000,
      'badcase.dueAt 应等于 createdAt + slaHours（FR-BC-002）',
    );
    assert.ok(SEVERITIES.includes(created.severity), 'badcase.severity 枚举应合法');
    assert.ok(typeof created.creator === 'string' && created.creator.trim() !== '', 'badcase.creator 应非空');
    assert.ok(Array.isArray(created.evidence), 'badcase.evidence 应为数组');
    assert.equal(created.recurrence, false, '新建 badcase.recurrence 应为 false');
    assert.ok(Array.isArray(created.timeline) && created.timeline.length >= 1, 'badcase.timeline 应至少含创建记录');
    assert.equal(created.timeline[0].type, 'created', 'badcase.timeline[0].type 应为 created（FR-BC-006）');
    assert.equal(created.timeline[0].to, 'open', 'badcase.timeline[0].to 应为 open');
    assert.ok(typeof created.timeline[0].by === 'string' && created.timeline[0].by.trim() !== '', 'timeline.by 应非空');
    assertIsoDate(created.timeline[0].at, 'badcase.timeline[0].at');
    assert.ok(
      typeof created.title === 'string' && created.title.trim() !== '',
      'badcase.title 省略时应自动生成非空标题（005 §3.4 v0.1.1）',
    );
    assert.ok(
      created.title.includes(source.conversation.id),
      `自动生成的 title 应包含对话 id（005 §3.4 v0.1.1），实际 ${created.title}`,
    );

    ctx.createdBadcases.push({ category, created, source });
  }

  // 同对话已有未关闭 badcase → 409 且 details.badcaseId 指向已有（FR-BC-001 / TEST-BC-CREATE-02）
  const first = ctx.createdBadcases[0];
  const duplicate = await post(`/api/qc/conversations/${first.source.conversation.id}/badcases`, {
    category: 'knowledge',
  });
  const duplicateError = assertErrorResponse(duplicate, {
    status: 409,
    code: ERROR_CODE_BY_STATUS[409],
    context: 'POST badcases（同对话未关闭重复创建）',
  });
  assert.ok(
    isPlainObject(duplicateError.details) && duplicateError.details.badcaseId === first.created.id,
    `409 的 error.details.badcaseId 应指向已有 badcase ${first.created.id}，实际 ${JSON.stringify(duplicateError.details)}`,
  );

  // 404 / 422
  assertErrorResponse(await post('/api/qc/conversations/conv-does-not-exist/badcases', { category: 'knowledge' }), {
    status: 404,
    code: ERROR_CODE_BY_STATUS[404],
    context: 'POST badcases（对话不存在）',
  });
  assertErrorResponse(
    await post(`/api/qc/conversations/${first.source.conversation.id}/badcases`, { category: 'bogus' }),
    { status: 422, code: ERROR_CODE_BY_STATUS[422], context: 'POST badcases（非法 category）' },
  );
});

test('验收 badcase 状态机与时间线（TEST-BC-SM-01..04 / TEST-TRACE-01 / FR-BC-003/006）', async () => {
  const workflow = ctx.createdBadcases.find((item) => item.category === 'knowledge');
  assert.ok(workflow, '前置用例应已创建 knowledge 类 badcase');
  const badcaseId = workflow.created.id;
  const action = async (body, context) =>
    assertOk(await post(`/api/badcases/${badcaseId}/actions`, body), context);

  // open 直接 close → 409（必须经过处理与验证，FR-BC-003 / TEST-BC-SM-01）
  assertErrorResponse(
    await post(`/api/badcases/${badcaseId}/actions`, { type: 'close', proof: '跳过处理直接关闭' }),
    { status: 409, code: ERROR_CODE_BY_STATUS[409], context: 'POST badcase actions（open→close 非法）' },
  );
  // 未 assign 直接 verify → 409
  assertErrorResponse(
    await post(`/api/badcases/${badcaseId}/actions`, { type: 'verify', note: '未处理先验证' }),
    { status: 409, code: ERROR_CODE_BY_STATUS[409], context: 'POST badcase actions（open→pending_verify 非法）' },
  );

  // assign：必填 owner（422 → 200）
  assertErrorResponse(
    await post(`/api/badcases/${badcaseId}/actions`, { type: 'assign' }),
    { status: 422, code: ERROR_CODE_BY_STATUS[422], field: 'owner', context: 'POST badcase actions（assign 缺 owner）' },
  );
  const assigned = await action({ type: 'assign', owner: '顾清', by: '顾清' }, 'POST badcase actions（assign）');
  assert.equal(assigned.status, 'in_progress', 'assign 后 status 应为 in_progress（FR-BC-003）');
  assert.equal(assigned.owner, '顾清', 'assign 后 owner 应为指派对象');
  assert.equal(assigned.timeline.at(-1).type, 'assigned');
  assert.equal(assigned.timeline.at(-1).from, 'open');
  assert.equal(assigned.timeline.at(-1).to, 'in_progress');

  // progress：必填 note（422 → 200）
  assertErrorResponse(
    await post(`/api/badcases/${badcaseId}/actions`, { type: 'progress' }),
    { status: 422, code: ERROR_CODE_BY_STATUS[422], field: 'note', context: 'POST badcase actions（progress 缺 note）' },
  );
  const progressed = await action({ type: 'progress', note: '已联系用户核实并修复知识库条目', by: '顾清' }, 'POST badcase actions（progress）');
  assert.equal(progressed.status, 'in_progress');
  assert.equal(progressed.timeline.at(-1).type, 'progressed');
  assert.equal(progressed.timeline.at(-1).from, 'in_progress');
  assert.equal(progressed.timeline.at(-1).to, 'in_progress');

  // verify：必填 note（422 → 200）
  assertErrorResponse(
    await post(`/api/badcases/${badcaseId}/actions`, { type: 'verify' }),
    { status: 422, code: ERROR_CODE_BY_STATUS[422], field: 'note', context: 'POST badcase actions（verify 缺 note）' },
  );
  const verified = await action({ type: 'verify', note: '抽检 5 条复现通过', by: '陆川' }, 'POST badcase actions（verify）');
  assert.equal(verified.status, 'pending_verify', 'verify 后 status 应为 pending_verify（FR-BC-003）');
  assert.equal(verified.timeline.at(-1).type, 'verified');
  assert.equal(verified.timeline.at(-1).from, 'in_progress');
  assert.equal(verified.timeline.at(-1).to, 'pending_verify');

  // close：必填 proof（422 → 200），写 closedAt（TEST-BC-SM-02）
  assertErrorResponse(
    await post(`/api/badcases/${badcaseId}/actions`, { type: 'close' }),
    { status: 422, code: ERROR_CODE_BY_STATUS[422], field: 'proof', context: 'POST badcase actions（close 缺 proof）' },
  );
  const closed = await action({ type: 'close', proof: '知识库条目 v2 已发布并通过抽检', by: '顾清' }, 'POST badcase actions（close）');
  assert.equal(closed.status, 'closed', 'close 后 status 应为 closed（FR-BC-003）');
  assert.equal(closed.proof, '知识库条目 v2 已发布并通过抽检', 'closed.proof 应为提交的证明');
  assertIsoDate(closed.closedAt, 'badcase.closedAt');
  assert.equal(closed.timeline.at(-1).type, 'closed');
  assert.equal(closed.timeline.at(-1).from, 'pending_verify');
  assert.equal(closed.timeline.at(-1).to, 'closed');

  // close 后非法动作 → 409；reopen 必填 note（422 → 200）（TEST-BC-SM-03）
  assertErrorResponse(
    await post(`/api/badcases/${badcaseId}/actions`, { type: 'assign', owner: '顾清' }),
    { status: 409, code: ERROR_CODE_BY_STATUS[409], context: 'POST badcase actions（closed→assign 非法）' },
  );
  assertErrorResponse(
    await post(`/api/badcases/${badcaseId}/actions`, { type: 'close', proof: '重复关闭' }),
    { status: 409, code: ERROR_CODE_BY_STATUS[409], context: 'POST badcase actions（closed→close 非法）' },
  );
  assertErrorResponse(
    await post(`/api/badcases/${badcaseId}/actions`, { type: 'reopen' }),
    { status: 422, code: ERROR_CODE_BY_STATUS[422], field: 'note', context: 'POST badcase actions（reopen 缺 note）' },
  );
  const reopened = await action({ type: 'reopen', note: '7 天内同根因复发，重开跟进', by: '顾清' }, 'POST badcase actions（reopen）');
  assert.equal(reopened.status, 'in_progress', 'reopen 后 status 应为 in_progress（FR-BC-003 / TEST-BC-SM-03）');
  assert.equal(reopened.timeline.at(-1).type, 'reopened');
  assert.equal(reopened.timeline.at(-1).from, 'closed');
  assert.equal(reopened.timeline.at(-1).to, 'in_progress');

  // 终态详情：时间线完整、at 单调不减、from/to 链一致（TEST-TRACE-01 / FR-BC-006）
  const detail = assertOk(await get(`/api/badcases/${badcaseId}`), 'GET /api/badcases/{id}（状态机终态）');
  assert.equal(detail.id, badcaseId);
  assert.equal(detail.status, 'in_progress');
  assert.equal(detail.timeline[0].type, 'created');
  const expectedChain = [
    ['created', null, 'open'],
    ['assigned', 'open', 'in_progress'],
    ['progressed', 'in_progress', 'in_progress'],
    ['verified', 'in_progress', 'pending_verify'],
    ['closed', 'pending_verify', 'closed'],
    ['reopened', 'closed', 'in_progress'],
  ];
  assert.equal(
    detail.timeline.length,
    expectedChain.length,
    `时间线应有 ${expectedChain.length} 条记录（FR-BC-006），实际 ${detail.timeline.length}`,
  );
  for (const [index, [type, from, to]] of expectedChain.entries()) {
    const entry = detail.timeline[index];
    assert.equal(entry.type, type, `timeline[${index}].type 应为 ${type}`);
    assert.equal(entry.from ?? null, from, `timeline[${index}].from 应为 ${from}`);
    assert.equal(entry.to ?? null, to, `timeline[${index}].to 应为 ${to}`);
    assert.ok(typeof entry.by === 'string' && entry.by.trim() !== '', `timeline[${index}].by 应非空`);
    assertIsoDate(entry.at, `timeline[${index}].at`);
    if (index > 0) {
      assert.ok(
        Date.parse(detail.timeline[index - 1].at) <= Date.parse(entry.at),
        'timeline.at 应单调不减（FR-BC-006）',
      );
    }
  }
});

test('验收 badcase 列表/统计/详情口径（TEST-BC-LIST-01 / TEST-BC-STAT-01 / TEST-BC-DETAIL-01 / TEST-BC-RECUR-01）', async () => {
  const baselineTotal = ctx.badcases.length;
  const createdCount = ctx.createdBadcases.length;
  const stats = assertOk(await get('/api/badcases/stats'), 'GET /api/badcases/stats');
  const list = await listAll('/api/badcases', {}, 'badcases（全量）');
  assert.equal(list.length, baselineTotal + createdCount, 'badcase total 应为种子数 + 本次验收新建数');
  assert.equal(stats.total, list.length, 'badcaseStats.total 应等于列表 total');
  assert.equal(stats.total, stats.open + stats.inProgress + stats.pendingVerify + stats.closed, 'badcaseStats 状态数之和应等于 total');
  assertApprox(stats.closeRate, stats.total === 0 ? 0 : stats.closed / stats.total, 0.001, 'closeRate=closed/total（FR-BC-005）');
  assertApprox(
    stats.recurrenceRate,
    stats.total === 0 ? 0 : list.filter((item) => item.recurrence === true).length / stats.total,
    0.001,
    'recurrenceRate=recurrence/total（FR-BC-005）',
  );
  assert.equal(sum(stats.byCategory.map((item) => item.count)), stats.total, 'byCategory 计数之和应等于 total');
  assert.equal(sum(stats.byOwner.map((item) => item.count)), stats.total, 'byOwner 计数之和应等于 total');

  // 列表筛选与列表项结构（TEST-BC-LIST-01）
  for (const status of BADCASE_STATUSES) {
    const filtered = await listAll('/api/badcases', { status }, `badcases?status=${status}`);
    const expected = list.filter((item) => item.status === status).length;
    assert.equal(filtered.length, expected, `status=${status} 的 total 应与全量分布一致`);
    for (const item of filtered) assert.equal(item.status, status, `status=${status} 筛选应全部匹配`);
  }
  for (const category of BADCASE_CATEGORIES) {
    const filtered = await listAll('/api/badcases', { category }, `badcases?category=${category}`);
    for (const item of filtered) assert.equal(item.category, category, `category=${category} 筛选应全部匹配`);
  }
  for (const item of list) {
    assert.match(item.code, /^BC-\d{4}-\d{4}$/, `badcase ${item.id} 的 code 格式应合法`);
    assert.ok(BADCASE_CATEGORIES.includes(item.category), `badcase ${item.id} category 枚举非法`);
    assert.ok(BADCASE_STATUSES.includes(item.status), `badcase ${item.id} status 枚举非法`);
    assert.ok(SEVERITIES.includes(item.severity), `badcase ${item.id} severity 枚举非法`);
    assert.equal(typeof item.overdue, 'boolean', `badcase ${item.id} overdue 应为布尔值`);
    assert.ok(typeof item.agentName === 'string' && item.agentName.trim() !== '', `badcase ${item.id} agentName 应非空`);
    assertIsoDate(item.dueAt, `badcaseList ${item.id}.dueAt`);
    assertIsoDate(item.createdAt, `badcaseList ${item.id}.createdAt`);
    assertIsoDate(item.updatedAt, `badcaseList ${item.id}.updatedAt`);
  }

  // 详情与时间线（TEST-BC-DETAIL-01）
  const target = ctx.createdBadcases.find((item) => item.category === 'knowledge').created;
  const detail = assertOk(await get(`/api/badcases/${target.id}`), 'GET /api/badcases/{id}');
  assert.equal(detail.id, target.id);
  assert.equal(detail.conversationId, target.conversationId);
  assert.equal(detail.timeline[0].type, 'created');
  assert.ok(detail.timeline.length >= 1);
  assertErrorResponse(await get('/api/badcases/BC-does-not-exist'), {
    status: 404,
    code: ERROR_CODE_BY_STATUS[404],
    context: 'GET /api/badcases/{id}（不存在）',
  });
});

// ===========================================================================
// 6. 舆情统计与评论列表
// ===========================================================================
test('验收 舆情统计口径与评论筛选（TEST-SEN-STAT-01 / TEST-SEN-COMMENT-01 / FR-SEN-001/005/006）', async () => {
  const stats = assertOk(await get('/api/sentiment/stats'), 'GET /api/sentiment/stats');
  const comments = ctx.comments;
  assert.equal(stats.comments, SEEDED_COMMENTS, `stats.comments 应为 ${SEEDED_COMMENTS}`);
  assert.equal(stats.analyzed, SEEDED_COMMENTS, 'stats.analyzed 应为全部评论数');
  const negativeCount = comments.filter((item) => item.sentiment === 'negative').length;
  assertApprox(stats.negativeRatio, negativeCount / SEEDED_COMMENTS, 0.001, 'negativeRatio 应为负面评论占比（保留 3 位小数）');
  assert.equal(
    stats.needsReview,
    comments.filter((item) => item.needsReview === true).length,
    'stats.needsReview 应为 needsReview=true 的评论数',
  );

  // 分布：情绪/来源/主题计数与评论数据一致
  const expectedSentiment = { positive: 0, neutral: 0, negative: 0 };
  const expectedSource = {};
  const expectedTopic = {};
  for (const comment of comments) {
    expectedSentiment[comment.sentiment] += 1;
    expectedSource[comment.source] = (expectedSource[comment.source] ?? 0) + 1;
    expectedTopic[comment.primaryTopic] = (expectedTopic[comment.primaryTopic] ?? 0) + 1;
  }
  assertDeepEqual(
    Object.fromEntries(stats.sentimentDistribution.map((item) => [item.sentiment, item.count])),
    expectedSentiment,
    'sentimentDistribution 应与评论情绪分布一致',
  );
  assertDeepEqual(
    Object.fromEntries(stats.sourceDistribution.map((item) => [item.source, item.count])),
    expectedSource,
    'sourceDistribution 应与评论来源分布一致',
  );
  assert.equal(sum(stats.topicDistribution.map((item) => item.count)), SEEDED_COMMENTS, 'topicDistribution 计数之和应等于评论数');
  for (const item of stats.topicDistribution) {
    assert.equal(item.count, expectedTopic[item.topic] ?? 0, `topicDistribution[${item.topic}] 计数应为评论 primaryTopic 数`);
  }

  // 预警计数与响应时长（FR-SEN-006：无样本返回 null 而非 0）
  const alerts = ctx.alertDetails.map((detail) => detail.alert);
  assert.equal(stats.alertsTotal, alerts.length, 'alertsTotal 应等于预警总数');
  assert.equal(stats.p0, alerts.filter((alert) => alert.level === 'P0').length, 'stats.p0 应为 P0 预警数');
  assert.equal(stats.p1, alerts.filter((alert) => alert.level === 'P1').length, 'stats.p1 应为 P1 预警数');
  assert.equal(stats.p2, alerts.filter((alert) => alert.level === 'P2').length, 'stats.p2 应为 P2 预警数');
  assert.equal(
    stats.alertsOpen,
    alerts.filter((alert) => alert.status !== 'resolved').length,
    'alertsOpen 应为未解决预警数',
  );
  const responseMinutes = (level) => {
    const responded = alerts.filter((alert) => alert.level === level && alert.firstResponseAt !== null);
    return responded.length === 0
      ? null
      : mean(responded.map((alert) => minutesBetween(alert.firstResponseAt, alert.createdAt)));
  };
  for (const [statsKey, level] of [
    ['p0ResponseMin', 'P0'],
    ['p1ResponseMin', 'P1'],
  ]) {
    const expected = responseMinutes(level);
    if (expected === null) {
      assert.equal(stats[statsKey], null, `${statsKey} 无已首响样本时应为 null 而非 0（FR-SEN-006）`);
    } else {
      assertApprox(stats[statsKey], expected, 0.01, `${statsKey} 应为 ${level} 已首响记录的平均首响分钟数（FR-SEN-006）`);
    }
  }
  const allResponded = alerts.filter((alert) => alert.firstResponseAt !== null);
  if (allResponded.length === 0) {
    assert.equal(stats.avgFirstResponseMin, null, 'avgFirstResponseMin 无样本时应为 null');
  } else {
    assertApprox(
      stats.avgFirstResponseMin,
      mean(allResponded.map((alert) => minutesBetween(alert.firstResponseAt, alert.createdAt))),
      0.01,
      'avgFirstResponseMin 应为全部已首响预警的平均首响分钟数',
    );
  }

  // 评论列表筛选（TEST-SEN-COMMENT-01 / FR-SEN-005）
  for (const source of ['steam', 'taptap', 'googleplay', 'community', 'ticket']) {
    const filtered = await listAll('/api/sentiment/comments', { source }, `comments?source=${source}`);
    assert.equal(filtered.length, expectedSource[source] ?? 0, `source=${source} 的 total 应与数据集一致（FR-SEN-005）`);
    for (const item of filtered) assert.equal(item.source, source, `source=${source} 筛选应全部匹配`);
  }
  for (const sentiment of ['positive', 'neutral', 'negative']) {
    const filtered = await listAll('/api/sentiment/comments', { sentiment }, `comments?sentiment=${sentiment}`);
    assert.equal(filtered.length, expectedSentiment[sentiment], `sentiment=${sentiment} 的 total 应与分布一致`);
    for (const item of filtered) assert.equal(item.sentiment, sentiment, `sentiment=${sentiment} 筛选应全部匹配`);
  }
  const severityCounts = {};
  for (const comment of comments) severityCounts[comment.severity] = (severityCounts[comment.severity] ?? 0) + 1;
  for (const severity of ['p0', 'p1', 'p2', 'none']) {
    const filtered = await listAll('/api/sentiment/comments', { severity }, `comments?severity=${severity}`);
    assert.equal(filtered.length, severityCounts[severity] ?? 0, `severity=${severity} 的 total 应与分布一致`);
    for (const item of filtered) assert.equal(item.severity, severity, `severity=${severity} 筛选应全部匹配`);
  }
  const topicFiltered = await listAll('/api/sentiment/comments', { topic: '版本' }, 'comments?topic=版本');
  assert.ok(topicFiltered.length > 0, 'topic=版本 应能筛出评论');
  for (const item of topicFiltered) {
    assert.ok(item.topics.includes('版本'), `topic=版本 返回项 ${item.id} 的 topics 应包含该主题`);
  }

  // 评论与预警互链一致（FR-SEN-001/002）
  const commentById = new Map(comments.map((comment) => [comment.id, comment]));
  for (const detail of ctx.alertDetails) {
    const { alert, comments: alertComments } = detail;
    assert.equal(alertComments.length, alert.commentIds.length, `预警 ${alert.id} 详情评论数应等于 commentIds 长度`);
    assert.deepEqual(
      alertComments.map((comment) => comment.id).sort(),
      [...alert.commentIds].sort(),
      `预警 ${alert.id} 详情评论应与 commentIds 一致`,
    );
    for (const commentId of alert.commentIds) {
      const comment = commentById.get(commentId);
      assert.ok(comment, `预警 ${alert.id} 引用的评论 ${commentId} 应存在`);
      if (comment.alertId !== null) {
        assert.equal(comment.alertId, alert.id, `评论 ${commentId}.alertId 应指回预警 ${alert.id}`);
      }
    }
  }
});

// ===========================================================================
// 7. 舆情预警：级别/主题/聚合升级/P0 筛选
// ===========================================================================
test('验收 舆情预警级别、主题与聚合升级（TEST-SEN-ALERT-01..03 / TEST-SEN-ANA-01 / TEST-SEN-TOPIC-01 / FR-SEN-002/003）', async () => {
  const alerts = ctx.alertDetails.map((detail) => detail.alert);
  assert.ok(alerts.length >= 1, '演示态应至少生成 1 条舆情预警');
  const clusterKeys = new Set();
  let aggregateRuleAlert = null;

  for (const alert of alerts) {
    assert.ok(ALERT_LEVELS.includes(alert.level), `预警 ${alert.id} level 枚举非法`);
    assert.ok(ALERT_STATUSES.includes(alert.status), `预警 ${alert.id} status 枚举非法`);
    assert.ok(typeof alert.topic === 'string' && alert.topic.trim() !== '', `预警 ${alert.id} topic 应非空`);
    assert.ok(alert.commentIds.length >= 1, `预警 ${alert.id} commentIds 应非空`);
    assert.equal(
      alert.slaMinutes,
      ALERT_SLA_MINUTES[alert.level],
      `预警 ${alert.id} level=${alert.level} 的 slaMinutes 应为 ${ALERT_SLA_MINUTES[alert.level]}（FR-SEN-003）`,
    );
    assert.equal(
      Date.parse(alert.slaDueAt) - Date.parse(alert.createdAt),
      ALERT_SLA_MINUTES[alert.level] * 60_000,
      `预警 ${alert.id} slaDueAt 应等于 createdAt + ${ALERT_SLA_MINUTES[alert.level]} 分钟（FR-SEN-003）`,
    );
    if (alert.level === 'P0') {
      assert.equal(alert.owner, '江岚', 'P0 预警 owner 应为品牌责任人江岚（007 §6.3 契约 v0.1.1）');
    } else {
      assert.equal(
        alert.owner,
        OWNER_ROUTING.sentiment[alert.topic],
        `${alert.level} 预警 owner 应按主题路由（004 §4.5），topic=${alert.topic}`,
      );
    }
    assert.ok(Array.isArray(alert.triggerRules) && alert.triggerRules.length >= 1, `预警 ${alert.id} triggerRules 应非空`);
    for (const rule of alert.triggerRules) {
      assert.ok(typeof rule.ruleId === 'string' && rule.ruleId.trim() !== '', `预警 ${alert.id} triggerRules.ruleId 应非空`);
      assert.ok(
        typeof rule.description === 'string' && rule.description.trim() !== '',
        `预警 ${alert.id} triggerRules.description 应非空`,
      );
    }
    assertIsoDate(alert.windowStart, `预警 ${alert.id}.windowStart`);
    assertIsoDate(alert.windowEnd, `预警 ${alert.id}.windowEnd`);
    assert.ok(Date.parse(alert.windowStart) <= Date.parse(alert.windowEnd), `预警 ${alert.id} windowStart 应不晚于 windowEnd`);
    assert.equal(alert.timeline[0].type, 'created', `预警 ${alert.id} timeline[0].type 应为 created`);

    // 同一 (topic, 日期) 只生成 1 条预警（FR-SEN-002 聚合键）
    const firstComment = ctx.comments.find((comment) => comment.id === alert.commentIds[0]);
    assert.ok(firstComment, `预警 ${alert.id} 的首条评论应存在`);
    const key = `${alert.topic}|${firstComment.publishedAt.slice(0, 10)}`;
    assert.ok(!clusterKeys.has(key), `同一 (topic, 日期) 只应有 1 条预警（FR-SEN-002），重复键 ${key}`);
    clusterKeys.add(key);

    // 聚合升级触发规则：至少 1 条 P0 预警由聚合产生且负面条数 ≥8（FR-SEN-002 / TEST-SEN-ANA-01）
    const ruleIds = alert.triggerRules.map((rule) => rule.ruleId);
    if (ruleIds.includes('aggregate_escalation_p0')) {
      aggregateRuleAlert = alert;
      const negativeComments = alert.commentIds
        .map((id) => ctx.comments.find((comment) => comment.id === id))
        .filter((comment) => comment && comment.sentiment === 'negative').length;
      assert.ok(
        negativeComments >= 8,
        `聚合升级为 P0 的预警 ${alert.id} 簇内负面应 ≥8，实际 ${negativeComments}`,
      );
    }
  }
  assert.ok(aggregateRuleAlert, '应存在由聚合升级触发的 P0 预警且 triggerRules 含 aggregate_escalation_p0（FR-SEN-002）');

  // P0 筛选与详情（TEST-SEN-ALERT-01）
  const p0Alerts = await listAll('/api/sentiment/alerts', { level: 'P0' }, 'alerts?level=P0');
  assert.ok(p0Alerts.length >= 1, '应能按 level=P0 筛选预警');
  for (const item of p0Alerts) assert.equal(item.level, 'P0', 'level=P0 筛选应全部匹配');
  const target = p0Alerts[0];
  const detail = assertOk(await get(`/api/sentiment/alerts/${target.id}`), 'GET /api/sentiment/alerts/{id}（P0）');
  assert.equal(detail.alert.id, target.id);
  assert.equal(detail.alert.level, 'P0');
  assert.ok(detail.comments.length >= 1, 'P0 预警详情应返回关联评论（TEST-SEN-ALERT-02）');
  for (const comment of detail.comments) {
    assert.ok(comment.topics.includes(detail.alert.topic), `预警 ${target.id} 关联评论 ${comment.id} 主题应含 ${detail.alert.topic}`);
    assert.ok(ALERT_LEVELS.includes(detail.alert.level));
  }
  assertErrorResponse(await get('/api/sentiment/alerts/AL-does-not-exist'), {
    status: 404,
    code: ERROR_CODE_BY_STATUS[404],
    context: 'GET /api/sentiment/alerts/{id}（不存在）',
  });

  // 主题字典与单条级别一致性（TEST-SEN-TOPIC-01 / FR-SEN-001）
  for (const comment of ctx.comments) {
    assert.ok(comment.topics.length >= 1, `评论 ${comment.id} 应至少 1 个主题`);
    assert.ok(comment.topics.includes(comment.primaryTopic), `评论 ${comment.id} primaryTopic 应属于 topics`);
    assert.ok(['p0', 'p1', 'p2', 'none'].includes(comment.severity), `评论 ${comment.id} severity 枚举非法`);
    assert.ok(typeof comment.confidence === 'number' && comment.confidence >= 0 && comment.confidence <= 1);
    if (comment.needsReview === true) {
      assert.ok(comment.confidence < 0.75, `评论 ${comment.id} needsReview=true 时 confidence 应 <0.75`);
    }
  }
});

// ===========================================================================
// 8. 舆情预警 SOP（确认→响应→升级→解决）
// ===========================================================================
test('验收 舆情预警 SOP 状态机（TEST-SEN-SOP-01..03 / FR-SEN-004）', async () => {
  const candidates = ctx.alerts.filter((alert) => alert.status === 'new');
  assert.ok(candidates.length >= 2, `重置后应至少有 2 条 new 状态预警（TEST-SEN-SOP 前置），实际 ${candidates.length}`);
  const target = candidates[0];
  const secondary = candidates[1];
  ctx.sopAlertId = target.id;
  const action = async (alertId, body, context) =>
    assertOk(await post(`/api/sentiment/alerts/${alertId}/actions`, body), context);

  // acknowledge：new → acknowledged，写 firstResponseAt（TEST-SEN-SOP-01）
  const acknowledged = await action(target.id, { type: 'acknowledge', note: '已确认，正在跟进', by: '江岚' }, 'POST alert actions（acknowledge）');
  assert.equal(acknowledged.status, 'acknowledged', 'acknowledge 后 status 应为 acknowledged（FR-SEN-004）');
  assertIsoDate(acknowledged.firstResponseAt, 'alert.firstResponseAt');
  assert.equal(acknowledged.timeline.at(-1).type, 'acknowledged');
  assert.equal(acknowledged.timeline.at(-1).from, 'new');
  assert.equal(acknowledged.timeline.at(-1).to, 'acknowledged');
  const firstResponseAt = acknowledged.firstResponseAt;

  // 重复 acknowledge → 409
  assertErrorResponse(
    await post(`/api/sentiment/alerts/${target.id}/actions`, { type: 'acknowledge', note: '重复确认' }),
    { status: 409, code: ERROR_CODE_BY_STATUS[409], context: 'POST alert actions（acknowledged→acknowledge 非法）' },
  );

  // respond：acknowledged → responding（TEST-SEN-SOP-02）
  const responding = await action(target.id, { type: 'respond', note: '已联系品牌方核实', by: '江岚' }, 'POST alert actions（respond）');
  assert.equal(responding.status, 'responding', 'respond 后 status 应为 responding（FR-SEN-004）');
  assert.equal(responding.firstResponseAt, firstResponseAt, '已记录的首响时间不应被后续动作覆盖');
  assert.equal(responding.timeline.at(-1).type, 'responded');
  assert.equal(responding.timeline.at(-1).from, 'acknowledged');
  assert.equal(responding.timeline.at(-1).to, 'responding');

  // resolve 前必须升级/响应：未传 note → 422
  const resolveWithoutNote = await post(`/api/sentiment/alerts/${target.id}/actions`, { type: 'resolve' });
  const resolveError = assertErrorResponse(resolveWithoutNote, {
    status: 422,
    code: ERROR_CODE_BY_STATUS[422],
    context: 'POST alert actions（resolve 缺 note）',
  });
  assert.equal(resolveError.details?.field ?? 'note', 'note', 'resolve 缺 note 的 422 应指向字段 note');

  // escalate：responding → escalated（TEST-SEN-SOP-02）
  const escalated = await action(target.id, { type: 'escalate', note: '舆情扩散风险，升级处置', by: '江岚' }, 'POST alert actions（escalate）');
  assert.equal(escalated.status, 'escalated', 'escalate 后 status 应为 escalated（FR-SEN-004）');
  assert.equal(escalated.timeline.at(-1).type, 'escalated');
  assert.equal(escalated.timeline.at(-1).from, 'responding');
  assert.equal(escalated.timeline.at(-1).to, 'escalated');

  // resolve：escalated → resolved，写 resolvedAt（TEST-SEN-SOP-03）
  const resolved = await action(target.id, { type: 'resolve', note: '已补偿用户并发布修复公告', by: '江岚' }, 'POST alert actions（resolve）');
  assert.equal(resolved.status, 'resolved', 'resolve 后 status 应为 resolved（FR-SEN-004）');
  assertIsoDate(resolved.resolvedAt, 'alert.resolvedAt');
  assert.equal(resolved.firstResponseAt, firstResponseAt, 'resolve 后 firstResponseAt 应保持不变');
  assert.equal(resolved.timeline.at(-1).type, 'resolved');
  assert.equal(resolved.timeline.at(-1).from, 'escalated');
  assert.equal(resolved.timeline.at(-1).to, 'resolved');

  // 终态后非法动作 → 409；comment 任意状态可用
  assertErrorResponse(
    await post(`/api/sentiment/alerts/${target.id}/actions`, { type: 'respond', note: '终态后再响应' }),
    { status: 409, code: ERROR_CODE_BY_STATUS[409], context: 'POST alert actions（resolved→respond 非法）' },
  );
  assertErrorResponse(
    await post(`/api/sentiment/alerts/${target.id}/actions`, { type: 'resolve', note: '重复解决' }),
    { status: 409, code: ERROR_CODE_BY_STATUS[409], context: 'POST alert actions（resolved→resolve 非法）' },
  );
  const commented = await action(target.id, { type: 'comment', note: '复盘记录已归档', by: '江岚' }, 'POST alert actions（comment）');
  assert.equal(commented.status, 'resolved', 'comment 不应改变预警状态');
  assert.equal(commented.timeline.at(-1).type, 'commented');

  // new → escalated 旁路（004 §5.2；new 直接升级）
  const escalatedFromNew = await action(secondary.id, { type: 'escalate', note: '高危舆情直达升级', by: '陆川' }, 'POST alert actions（new→escalate）');
  assert.equal(escalatedFromNew.status, 'escalated', 'new 预警可直接升级为 escalated（004 §5.2）');
  assert.equal(escalatedFromNew.timeline.at(-1).from, 'new');
  assert.equal(escalatedFromNew.timeline.at(-1).to, 'escalated');
});

// ===========================================================================
// 9. 线索：预警转线索 / 创建 / 状态机 / 列表详情
// ===========================================================================
test('验收 线索创建与预警转线索（TEST-CLUE-CREATE-01/02 / TEST-SEN-CLUE-01 / FR-SEN-007 / FR-SYS-004）', async () => {
  const sourceAlert = ctx.alerts.find((alert) => alert.level === 'P0' && alert.id !== ctx.sopAlertId);
  assert.ok(sourceAlert, '应存在可用于转线索的 P0 预警');
  const createPayload = {
    title: 'P0 舆情：外挂/充值集中负面',
    description: `由预警 ${sourceAlert.id} 一键生成线索，建议产研与品牌联合处置。`,
    sourceType: 'sentiment',
    sourceRef: { type: 'alert', id: sourceAlert.id, label: sourceAlert.title },
    target: 'market',
    priority: 'high',
    evidence: ['聚合升级 P0，负面集中'],
    createdBy: '江岚',
  };
  const created = assertOk(await post('/api/clues', createPayload), 'POST /api/clues（预警转线索）');
  assert.equal(created.status, 'draft', '新建线索 status 应为 draft（FR-SYS-004）');
  assert.equal(created.sourceType, 'sentiment', '线索 sourceType 应为 sentiment（FR-SEN-007）');
  assertDeepEqual(created.sourceRef, createPayload.sourceRef, '线索 sourceRef 应指向来源预警');
  assert.equal(created.target, 'market', '线索 target 应为请求值');
  assert.equal(created.priority, 'high', '线索 priority 应为请求值');
  assert.equal(created.owner, '程雨', 'target=market 时 owner 应路由为程雨（004 §4.5）');
  assert.equal(created.createdBy, '江岚', '线索 createdBy 应为请求值');
  assert.equal(created.timeline[0].type, 'created', '线索 timeline[0].type 应为 created');
  assert.ok(created.outcome === null || created.outcome === undefined, '新线索 outcome 应为空');
  ctx.createdClues.push(created);

  // 预警 linkedClueIds 追加（FR-SEN-007）
  const alertDetail = assertOk(await get(`/api/sentiment/alerts/${sourceAlert.id}`), 'GET 预警详情（转线索后）');
  assert.ok(alertDetail.alert.linkedClueIds.includes(created.id), '预警 linkedClueIds 应包含新线索 id（FR-SEN-007）');
  assert.ok(
    alertDetail.linkedClues.some((clue) => clue.id === created.id),
    '预警详情 linkedClues 应包含新线索（FR-SEN-007）',
  );

  // 重复生成同一目标 → 409（FR-SEN-007）
  assertErrorResponse(await post('/api/clues', createPayload), {
    status: 409,
    code: ERROR_CODE_BY_STATUS[409],
    context: 'POST /api/clues（同一预警同一目标重复生成）',
  });

  // 创建参数校验（TEST-CLUE-CREATE-02）
  assertErrorResponse(
    await post('/api/clues', { ...createPayload, title: undefined }),
    { status: 422, code: ERROR_CODE_BY_STATUS[422], field: 'title', context: 'POST /api/clues（缺 title）' },
  );
  assertErrorResponse(
    await post('/api/clues', { ...createPayload, target: 'bogus', sourceRef: { type: 'alert', id: 'AL-x' } }),
    { status: 422, code: ERROR_CODE_BY_STATUS[422], field: 'target', context: 'POST /api/clues（非法 target）' },
  );

  // 手工创建线索：sourceType=qc 来源 badcase，target=cs → 陆川（FR-SYS-004）
  const manualBadcase = ctx.createdBadcases.find((item) => item.category === 'system') ?? ctx.createdBadcases[1];
  const manual = assertOk(
    await post('/api/clues', {
      title: '质检复核发现的流程问题',
      description: `由 badcase ${manualBadcase.created.code} 沉淀线索，建议客服流程整改。`,
      sourceType: 'qc',
      sourceRef: { type: 'badcase', id: manualBadcase.created.id, label: manualBadcase.created.code },
      target: 'cs',
      priority: 'medium',
      createdBy: '沈言',
    }),
    'POST /api/clues（qc 来源手工线索）',
  );
  assert.equal(manual.status, 'draft');
  assert.equal(manual.owner, '陆川', 'target=cs 时 owner 应路由为陆川（004 §4.5）');
  ctx.createdClues.push(manual);
});

test('验收 线索状态机与列表详情（TEST-CLUE-SM-01..03 / TEST-CLUE-LIST-01 / TEST-CLUE-DETAIL-01 / FR-SYS-004 / BR-09）', async () => {
  const workflow = ctx.createdClues[0];
  assert.ok(workflow, '前置用例应已创建线索');
  const clueId = workflow.id;
  const action = async (body, context) => assertOk(await post(`/api/clues/${clueId}/actions`, body), context);

  // draft 直接 accept / close → 409（非法跳跃，BR-09）
  assertErrorResponse(
    await post(`/api/clues/${clueId}/actions`, { type: 'accept', owner: '程雨' }),
    { status: 409, code: ERROR_CODE_BY_STATUS[409], context: 'POST clue actions（draft→accept 非法）' },
  );
  assertErrorResponse(
    await post(`/api/clues/${clueId}/actions`, { type: 'close', outcome: '跳过受理直接关闭' }),
    { status: 409, code: ERROR_CODE_BY_STATUS[409], context: 'POST clue actions（draft→close 非法）' },
  );

  // route：必填 owner（422 → 200），draft → routed（TEST-CLUE-SM-01）
  assertErrorResponse(
    await post(`/api/clues/${clueId}/actions`, { type: 'route' }),
    { status: 422, code: ERROR_CODE_BY_STATUS[422], field: 'owner', context: 'POST clue actions（route 缺 owner）' },
  );
  const routed = await action({ type: 'route', owner: '程雨', note: '分派市场同学跟进', by: '江岚' }, 'POST clue actions（route）');
  assert.equal(routed.status, 'routed', 'route 后 status 应为 routed（FR-SYS-004）');
  assert.equal(routed.owner, '程雨', 'route 后 owner 应为指派对象');
  assert.equal(routed.timeline.at(-1).type, 'routed');
  assert.equal(routed.timeline.at(-1).from, 'draft');
  assert.equal(routed.timeline.at(-1).to, 'routed');

  // accept：routed → accepted（TEST-CLUE-SM-02）
  const accepted = await action({ type: 'accept', owner: '程雨', note: '市场已受理', by: '程雨' }, 'POST clue actions（accept）');
  assert.equal(accepted.status, 'accepted', 'accept 后 status 应为 accepted（FR-SYS-004）');
  assert.equal(accepted.timeline.at(-1).type, 'accepted');
  assert.equal(accepted.timeline.at(-1).from, 'routed');
  assert.equal(accepted.timeline.at(-1).to, 'accepted');

  // close：必填 outcome（422 → 200），accepted → closed（TEST-CLUE-SM-03）
  assertErrorResponse(
    await post(`/api/clues/${clueId}/actions`, { type: 'close' }),
    { status: 422, code: ERROR_CODE_BY_STATUS[422], field: 'outcome', context: 'POST clue actions（close 缺 outcome）' },
  );
  const closed = await action({ type: 'close', outcome: '市场口径已更新，相关负评回落', by: '程雨' }, 'POST clue actions（close）');
  assert.equal(closed.status, 'closed', 'close 后 status 应为 closed（FR-SYS-004）');
  assert.equal(closed.outcome, '市场口径已更新，相关负评回落', 'closed.outcome 应为提交结果');
  assertIsoDate(closed.closedAt, 'clue.closedAt');
  assert.equal(closed.timeline.at(-1).type, 'closed');
  assert.equal(closed.timeline.at(-1).from, 'accepted');
  assert.equal(closed.timeline.at(-1).to, 'closed');

  // closed 为终态：再次 route/close → 409
  assertErrorResponse(
    await post(`/api/clues/${clueId}/actions`, { type: 'route', owner: '程雨' }),
    { status: 409, code: ERROR_CODE_BY_STATUS[409], context: 'POST clue actions（closed→route 非法）' },
  );
  assertErrorResponse(
    await post(`/api/clues/${clueId}/actions`, { type: 'close', outcome: '重复关闭' }),
    { status: 409, code: ERROR_CODE_BY_STATUS[409], context: 'POST clue actions（closed→close 非法）' },
  );

  // reject 路径：routed → rejected → closed（归档），必须带 note（005 §3.8 / 004 §5.3）
  const rejectedFlow = ctx.createdClues[1];
  assert.ok(rejectedFlow, '前置用例应已创建第二条线索');
  const routedSecond = assertOk(
    await post(`/api/clues/${rejectedFlow.id}/actions`, { type: 'route', owner: '陆川', by: '沈言' }),
    'POST clue actions（第二条 route）',
  );
  assert.equal(routedSecond.status, 'routed');
  assertErrorResponse(
    await post(`/api/clues/${rejectedFlow.id}/actions`, { type: 'reject' }),
    { status: 422, code: ERROR_CODE_BY_STATUS[422], field: 'note', context: 'POST clue actions（reject 缺 note）' },
  );
  const rejected = assertOk(
    await post(`/api/clues/${rejectedFlow.id}/actions`, { type: 'reject', note: '证据不足，退回', by: '陆川' }),
    'POST clue actions（reject）',
  );
  assert.ok(
    rejected.status === 'rejected' || rejected.status === 'closed',
    `reject 后状态应为 rejected（并将归档 closed），实际 ${rejected.status}`,
  );
  if (rejected.status === 'closed') {
    assertIsoDate(rejected.closedAt, 'reject 归档后的 clue.closedAt');
  }
  const rejectedDetail = assertOk(await get(`/api/clues/${rejectedFlow.id}`), 'GET /api/clues/{id}（reject 后）');
  assert.ok(
    rejectedDetail.status === 'rejected' || rejectedDetail.status === 'closed',
    'reject 后详情状态应为 rejected 或归档 closed',
  );
  assert.ok(
    rejectedDetail.timeline.some((entry) => entry.type === 'rejected'),
    'reject 后时间线应包含 rejected 记录',
  );

  // 列表与筛选（TEST-CLUE-LIST-01）
  const list = await listAll('/api/clues', {}, 'clues（全量）');
  assert.ok(list.length >= ctx.clues.length + ctx.createdClues.length, '线索列表应包含种子与新建线索');
  for (const item of list) {
    assert.ok(CLUE_SOURCES.includes(item.sourceType), `线索 ${item.id} sourceType 枚举非法`);
    assert.ok(CLUE_TARGETS.includes(item.target), `线索 ${item.id} target 枚举非法`);
    assert.ok(CLUE_PRIORITIES.includes(item.priority), `线索 ${item.id} priority 枚举非法`);
    assert.ok(CLUE_STATUSES.includes(item.status), `线索 ${item.id} status 枚举非法`);
    assert.ok(typeof item.title === 'string' && item.title.trim() !== '', `线索 ${item.id} title 应非空`);
    assert.ok(typeof item.owner === 'string' && item.owner.trim() !== '', `线索 ${item.id} owner 应非空`);
    assertIsoDate(item.createdAt, `线索 ${item.id}.createdAt`);
    assertIsoDate(item.updatedAt, `线索 ${item.id}.updatedAt`);
  }
  for (const status of CLUE_STATUSES) {
    const filtered = await listAll('/api/clues', { status }, `clues?status=${status}`);
    for (const item of filtered) assert.equal(item.status, status, `status=${status} 筛选应全部匹配`);
  }
  for (const target of CLUE_TARGETS) {
    const filtered = await listAll('/api/clues', { target }, `clues?target=${target}`);
    for (const item of filtered) assert.equal(item.target, target, `target=${target} 筛选应全部匹配`);
  }
  const sentimentClues = await listAll('/api/clues', { sourceType: 'sentiment' }, 'clues?sourceType=sentiment');
  assert.ok(
    sentimentClues.some((item) => item.id === clueId),
    'sourceType=sentiment 筛选应包含预警转线索记录',
  );

  // 详情（TEST-CLUE-DETAIL-01）
  const detail = assertOk(await get(`/api/clues/${clueId}`), 'GET /api/clues/{id}');
  assert.equal(detail.id, clueId);
  assert.equal(detail.status, 'closed');
  assert.equal(detail.timeline[0].type, 'created');
  assert.equal(detail.timeline.at(-1).type, 'closed');
  for (let index = 1; index < detail.timeline.length; index += 1) {
    assert.ok(
      Date.parse(detail.timeline[index - 1].at) <= Date.parse(detail.timeline[index].at),
      '线索 timeline.at 应单调不减',
    );
  }
  assertErrorResponse(await get('/api/clues/CL-does-not-exist'), {
    status: 404,
    code: ERROR_CODE_BY_STATUS[404],
    context: 'GET /api/clues/{id}（不存在）',
  });
});

// ===========================================================================
// 10. 看板 KPI / 趋势 / 异常钻取
// ===========================================================================
test('验收 看板 KPI、趋势与异常钻取（TEST-DASH-01/02 / TEST-DRILL-01/02 / FR-SYS-001..003）', async () => {
  const summary = assertOk(await get('/api/dashboard/summary'), 'GET /api/dashboard/summary');
  assert.equal(summary.kpis.length, 7, '看板应有 7 个 KPI 卡（FR-SYS-001）');
  assertDeepEqual(
    summary.kpis.map((kpi) => kpi.id).sort(),
    [...KPI_IDS].sort(),
    'KPI id 集合应为 qcCoverage/qcAccuracy/badcaseCloseRate/p0ResponseMin/alertPrecision/clueCloseRate/csat',
  );
  for (const kpi of summary.kpis) {
    assert.ok(typeof kpi.label === 'string' && kpi.label.trim() !== '', `KPI ${kpi.id} label 应非空`);
    assert.equal(typeof kpi.value, 'number', `KPI ${kpi.id} value 应为数字`);
    assert.equal(typeof kpi.target, 'number', `KPI ${kpi.id} target 应为数字`);
    assert.ok(kpi.op === '>=' || kpi.op === '<=', `KPI ${kpi.id} op 应为 >= 或 <=`);
    assert.ok(KPI_UNITS.includes(kpi.unit), `KPI ${kpi.id} unit 枚举非法：${kpi.unit}`);
    assert.ok(['ok', 'warn', 'bad'].includes(kpi.status), `KPI ${kpi.id} status 枚举非法`);
    assert.equal(typeof kpi.delta, 'number', `KPI ${kpi.id} delta 应为数字`);
    // status 由 value/target/op 计算（FR-SYS-001）：达标必须为 ok
    const met = kpi.op === '>=' ? kpi.value >= kpi.target : kpi.value <= kpi.target;
    if (met) assert.equal(kpi.status, 'ok', `KPI ${kpi.id} 达标时 status 应为 ok（FR-SYS-001）`);
    else assert.ok(kpi.status === 'warn' || kpi.status === 'bad', `KPI ${kpi.id} 未达标时 status 应为 warn/bad`);
  }
  const kpiById = Object.fromEntries(summary.kpis.map((kpi) => [kpi.id, kpi]));
  assert.ok(kpiById.qcCoverage.value >= 0.9, `质检覆盖率 KPI 应 ≥0.90（FR-SYS-001），实际 ${kpiById.qcCoverage.value}`);
  assert.ok(kpiById.qcCoverage.value <= 1, '质检覆盖率应 ≤1');
  assert.equal(kpiById.p0ResponseMin.unit, 'min', 'P0 首响 KPI unit 应为 min');
  assert.equal(kpiById.qcCoverage.unit, 'percent', '质检覆盖率 KPI unit 应为 percent');

  // 看板口径与明细统计一致（TEST-DASH-01）
  const qcStats = assertOk(await get('/api/qc/stats'), 'GET /api/qc/stats（看板一致性）');
  const badcaseStats = assertOk(await get('/api/badcases/stats'), 'GET /api/badcases/stats（看板一致性）');
  const sentimentStats = assertOk(await get('/api/sentiment/stats'), 'GET /api/sentiment/stats（看板一致性）');
  const clues = await listAll('/api/clues', {}, 'clues（看板一致性）');
  assert.equal(summary.volume.conversations, qcStats.total, 'volume.conversations 应等于质检对话总数');
  assert.equal(summary.volume.reviewPending, qcStats.needsReview, 'volume.reviewPending 应等于待复核数');
  assertApprox(kpiById.badcaseCloseRate.value, badcaseStats.closeRate, 0.001, 'badcaseCloseRate 应与 badcaseStats.closeRate 一致');
  assertApprox(kpiById.qcAccuracy.value, qcStats.avgScore / 100, 0.06, 'qcAccuracy 应与质检平均分口径一致');
  assert.equal(
    summary.volume.badcasesOpen,
    badcaseStats.open + badcaseStats.inProgress + badcaseStats.pendingVerify,
    'volume.badcasesOpen 应为未关闭 badcase 数',
  );
  assert.equal(summary.volume.alertsOpen, sentimentStats.alertsOpen, 'volume.alertsOpen 应等于未解决预警数');
  assert.equal(
    summary.volume.cluesOpen,
    clues.filter((clue) => clue.status !== 'closed').length,
    'volume.cluesOpen 应为未关关闭线索数',
  );
  assert.equal(sum(summary.distribution.channels.map((item) => item.count)), qcStats.total, '渠道分布计数之和应等于对话总数');
  assert.equal(sum(summary.distribution.alertLevels.map((item) => item.count)), sentimentStats.alertsTotal, '预警级别分布计数之和应等于预警总数');
  assert.equal(sum(summary.distribution.clueTargets.map((item) => item.count)), clues.length, '线索目标分布计数之和应等于线索总数');
  assertApprox(summary.quality.avgScore, qcStats.avgScore, 0.06, 'quality.avgScore 应与质检统计一致');

  // 趋势（TEST-DASH-02 / FR-SYS-002）
  for (const [range, expectedRows] of [
    ['7d', 7],
    ['14d', 14],
    ['30d', 30],
  ]) {
    const trends = assertOk(await get('/api/dashboard/trends', { range }), `GET /api/dashboard/trends?range=${range}`);
    assert.equal(trends.range, range, `trends.range 应回显 ${range}`);
    assert.equal(trends.rows.length, expectedRows, `range=${range} 应返回 ${expectedRows} 行（FR-SYS-002）`);
    for (let index = 1; index < trends.rows.length; index += 1) {
      const previous = Date.parse(`${trends.rows[index - 1].date}T00:00:00Z`);
      const current = Date.parse(`${trends.rows[index].date}T00:00:00Z`);
      assert.equal(current - previous, 86_400_000, '趋势日期应连续升序（FR-SYS-002）');
    }
    for (const row of trends.rows) {
      assert.match(row.date, /^\d{4}-\d{2}-\d{2}$/, '趋势 date 应为 YYYY-MM-DD');
      for (const key of KPI_IDS) {
        const value = row[key];
        assert.ok(value === null || typeof value === 'number', `趋势 ${row.date}.${key} 应为 number 或 null`);
      }
    }
  }
  const longRange = assertOk(await get('/api/dashboard/trends', { range: '30d' }), 'GET /api/dashboard/trends?range=30d');
  assert.ok(
    longRange.rows.some((row) => KPI_IDS.some((key) => row[key] === null)),
    '30d 趋势中应存在缺失指标为 null（FR-SYS-002 缺失为 null 非 0）',
  );

  // 异常卡与钻取（TEST-DRILL-01/02 / FR-SYS-003）
  const anomalies = assertOk(await get('/api/dashboard/anomalies'), 'GET /api/dashboard/anomalies');
  assert.ok(Array.isArray(anomalies.items), 'anomalies.items 应为数组');
  for (const item of anomalies.items) {
    assert.ok(typeof item.id === 'string' && item.id.trim() !== '', '异常卡 id 应非空');
    assert.ok(typeof item.metric === 'string' && item.metric.trim() !== '', '异常卡 metric 应非空');
    assert.ok(typeof item.metricLabel === 'string' && item.metricLabel.trim() !== '', '异常卡 metricLabel 应非空');
    assert.equal(typeof item.current, 'number', '异常卡 current 应为数字');
    assert.equal(typeof item.target, 'number', '异常卡 target 应为数字');
    assert.equal(typeof item.deviation, 'number', '异常卡 deviation 应为数字');
    assert.ok(item.severity === 'warn' || item.severity === 'bad', '异常卡 severity 枚举非法');
    assert.ok(DRILL_TYPES.includes(item.drillType), '异常卡 drillType 枚举非法');
    assert.ok(isPlainObject(item.drillFilter) && Object.keys(item.drillFilter).length >= 1, '异常卡 drillFilter 应为非空对象');
    assert.ok(typeof item.owner === 'string' && item.owner.trim() !== '', '异常卡 owner 应非空');
    assert.ok(typeof item.suggestion === 'string' && item.suggestion.trim() !== '', '异常卡 suggestion 应非空');
  }
  if (badcaseStats.closeRate < 0.7) {
    const closeRateAnomaly = anomalies.items.find((item) => item.metric === 'badcaseCloseRate');
    assert.ok(closeRateAnomaly, 'badcaseCloseRate<0.70 时应产生闭环率异常卡（FR-SYS-003）');
    assert.equal(closeRateAnomaly.drillType, 'badcase', '闭环率异常卡 drillType 应为 badcase（FR-SYS-003）');
    assert.equal(closeRateAnomaly.drillFilter.status, 'open', '闭环率异常卡 drillFilter.status 应为 open（FR-SYS-003）');
  }
  for (const anomaly of anomalies.items) {
    const listPath = DRILL_LIST_PATH[anomaly.drillType];
    const drilled = assertOk(
      await get(listPath, { ...anomaly.drillFilter, pageSize: 20 }),
      `异常钻取 GET ${listPath}（drillType=${anomaly.drillType}）`,
    );
    assert.equal(typeof drilled.total, 'number', '异常钻取列表应返回 total');
    assert.ok(drilled.total >= 1, `异常卡 ${anomaly.metric} 的钻取目标不应为空（TEST-DRILL-02）`);
  }
});

// ===========================================================================
// 11. 评测：数据集 / 运行 / 确定性 / 历史
// ===========================================================================
test('验收 评测数据集、运行与门禁指标（TEST-EVAL-DS-01 / TEST-EVAL-RUN-01 / TEST-EVAL-QC-01..03 / TEST-COST-01）', async () => {
  // 数据集（TEST-EVAL-DS-01 / FR-EVAL-001）
  const datasetsResponse = assertOk(await get('/api/eval/datasets'), 'GET /api/eval/datasets');
  assert.equal(datasetsResponse.items.length, 2, '应返回 qc 与 sentiment 两个评测集（FR-EVAL-001）');
  const datasets = Object.fromEntries(datasetsResponse.items.map((dataset) => [dataset.dataset, dataset]));
  assert.ok(datasets.qc, '缺少 qc 评测集');
  assert.ok(datasets.sentiment, '缺少 sentiment 评测集');
  assert.equal(datasets.qc.itemCount, SEEDED_CONVERSATIONS, 'qc 评测集 itemCount 应为 60');
  assert.equal(datasets.sentiment.itemCount, SEEDED_COMMENTS, 'sentiment 评测集 itemCount 应为 120');
  for (const dataset of datasetsResponse.items) {
    assert.ok(typeof dataset.datasetId === 'string' && dataset.datasetId.trim() !== '', `评测集 ${dataset.dataset} datasetId 应非空`);
    assert.ok(typeof dataset.version === 'string' && dataset.version.trim() !== '', `评测集 ${dataset.dataset} version 应非空`);
    assert.ok(typeof dataset.description === 'string' && dataset.description.trim() !== '', `评测集 ${dataset.dataset} description 应非空`);
    assert.ok(dataset.lastRunAt === null || typeof dataset.lastRunAt === 'string', 'lastRunAt 应为 null 或时间字符串');
  }

  // 运行 QC 评测（TEST-EVAL-QC-01..03）
  const qcRun = assertOk(await post('/api/eval/runs', { dataset: 'qc' }), 'POST /api/eval/runs（qc）');
  assert.equal(qcRun.dataset, 'qc', '评测结果 dataset 应为 qc');
  assert.ok(typeof qcRun.id === 'string' && qcRun.id.trim() !== '', '评测 run.id 应非空');
  assertIsoDate(qcRun.runAt, 'evalRun.runAt');
  assert.ok(Number.isInteger(qcRun.durationMs) && qcRun.durationMs >= 0, 'evalRun.durationMs 应为非负整数');
  assert.ok(typeof qcRun.modelVersion === 'string' && qcRun.modelVersion.trim() !== '', 'evalRun.modelVersion 应非空');
  assert.ok(typeof qcRun.summary === 'string' && qcRun.summary.trim() !== '', 'evalRun.summary 应非空');
  for (const key of QC_METRIC_KEYS) {
    assert.ok(key in qcRun.metrics, `qc 评测 metrics 缺少指标 ${key}（007 §4）`);
  }
  assert.equal(qcRun.metrics.coverage, 1, 'QC 评测 coverage 应为 1（全量 60 条已质检）');
  assert.ok(qcRun.metrics.accuracy >= 0.8, `QC 评测 accuracy 应 ≥0.80（MET-QC-ACC），实际 ${qcRun.metrics.accuracy}`);
  assert.ok(qcRun.metrics.falsePositiveRate <= 0.15, `FPR 应 ≤0.15（MET-QC-FPR），实际 ${qcRun.metrics.falsePositiveRate}`);
  assert.ok(qcRun.metrics.falseNegativeRate <= 0.2, `FNR 应 ≤0.20（MET-QC-FNR），实际 ${qcRun.metrics.falseNegativeRate}`);
  assert.ok(qcRun.metrics.reviewRatio <= 0.3, `复核占比应 ≤0.30（MET-QC-REV），实际 ${qcRun.metrics.reviewRatio}`);
  assert.ok(qcRun.metrics.avgLatencyMs < 50, `单条平均耗时应 <50ms（MET-QC-LAT / TEST-COST-01），实际 ${qcRun.metrics.avgLatencyMs}`);
  assert.ok(isPlainObject(qcRun.metrics.tagPrecision), 'qc.metrics.tagPrecision 应为对象');
  for (const code of QC_TAG_CODES) {
    assert.equal(typeof qcRun.metrics.tagPrecision[code], 'number', `tagPrecision.${code} 应为数字`);
    assert.ok(qcRun.metrics.tagPrecision[code] >= 0 && qcRun.metrics.tagPrecision[code] <= 1, `tagPrecision.${code} 应落在 [0,1]`);
  }
  assertDeepEqual(
    Object.keys(qcRun.confusion).sort(),
    ['fn', 'fp', 'tn', 'tp'],
    'qc 评测 confusion 应包含 tp/fp/tn/fn（007 §4）',
  );
  for (const [key, value] of Object.entries(qcRun.confusion)) {
    assert.ok(isNonNegativeInteger(value), `confusion.${key} 应为非负整数`);
  }
  assert.ok(Array.isArray(qcRun.mismatches) && qcRun.mismatches.length <= 20, 'mismatches 应 ≤20 条（007 §5）');
  for (const mismatch of qcRun.mismatches) {
    assert.ok(typeof mismatch.itemId === 'string' && mismatch.itemId.trim() !== '', 'mismatch.itemId 应非空');
    assert.ok(typeof mismatch.expected === 'string' && mismatch.expected.trim() !== '', 'mismatch.expected 应非空');
    assert.ok(typeof mismatch.predicted === 'string' && mismatch.predicted.trim() !== '', 'mismatch.predicted 应非空');
    assert.ok(typeof mismatch.reason === 'string' && mismatch.reason.trim() !== '', 'mismatch.reason 应非空');
  }
  assert.ok(isPlainObject(qcRun.thresholdsMet) && Object.keys(qcRun.thresholdsMet).length >= 1, 'thresholdsMet 应为非空对象');
  for (const value of Object.values(qcRun.thresholdsMet)) {
    assert.equal(typeof value, 'boolean', 'thresholdsMet 的值应为布尔');
  }

  // 运行 sentiment 评测（TEST-EVAL-SEN-01 归入 QC-02/03 门禁）
  const sentimentRun = assertOk(await post('/api/eval/runs', { dataset: 'sentiment' }), 'POST /api/eval/runs（sentiment）');
  assert.equal(sentimentRun.dataset, 'sentiment');
  for (const key of SENTIMENT_METRIC_KEYS) {
    assert.ok(key in sentimentRun.metrics, `sentiment 评测 metrics 缺少指标 ${key}（007 §4）`);
  }
  assert.ok(
    sentimentRun.metrics.sentimentAccuracy >= 0.8,
    `情感准确率应 ≥0.80（MET-SEN-SA），实际 ${sentimentRun.metrics.sentimentAccuracy}`,
  );
  assert.ok(
    sentimentRun.metrics.topicAccuracy >= 0.75,
    `主题准确率应 ≥0.75（MET-SEN-TA），实际 ${sentimentRun.metrics.topicAccuracy}`,
  );
  assert.ok(
    sentimentRun.metrics.alertPrecision >= 0.8,
    `预警准确率应 ≥0.80（MET-SEN-AP），实际 ${sentimentRun.metrics.alertPrecision}`,
  );
  assert.ok(
    sentimentRun.metrics.reviewRatio <= 0.3,
    `舆情复核占比应 ≤0.30（MET-SEN-REV），实际 ${sentimentRun.metrics.reviewRatio}`,
  );
  assert.ok(
    sentimentRun.mismatches.length <= 20,
    `sentiment mismatches 应 ≤20 条，实际 ${sentimentRun.mismatches.length}`,
  );

  // 确定性：同数据集重复运行，metrics/confusion/thresholdsMet 完全一致（TEST-EVAL-DET-01 / FR-EVAL-003）
  const qcRunAgain = assertOk(await post('/api/eval/runs', { dataset: 'qc' }), 'POST /api/eval/runs（qc 重复运行）');
  assert.notEqual(qcRunAgain.id, qcRun.id, '重复运行应生成新的 run id（POST 非幂等）');
  assertDeepEqual(qcRunAgain.metrics, qcRun.metrics, '重复 qc 运行的 metrics 应完全一致（确定性）');
  assertDeepEqual(qcRunAgain.confusion, qcRun.confusion, '重复 qc 运行的 confusion 应完全一致');
  assertDeepEqual(qcRunAgain.thresholdsMet, qcRun.thresholdsMet, '重复 qc 运行的 thresholdsMet 应完全一致');

  // 历史（TEST-EVAL-HIST-01/02）
  const history = assertOk(await get('/api/eval/runs', { pageSize: 100 }), 'GET /api/eval/runs');
  assert.ok(Array.isArray(history.items), 'runs.items 应为数组');
  assert.ok(history.total >= 3, '评测历史应至少包含本次 3 次运行');
  for (let index = 1; index < history.items.length; index += 1) {
    assert.ok(
      Date.parse(history.items[index - 1].runAt) >= Date.parse(history.items[index].runAt),
      '评测历史应按 runAt 倒序（FR-EVAL-003）',
    );
  }
  const qcHistory = assertOk(await get('/api/eval/runs', { dataset: 'qc', pageSize: 100 }), 'GET /api/eval/runs?dataset=qc');
  for (const item of qcHistory.items) assert.equal(item.dataset, 'qc', 'dataset=qc 筛选应全部匹配');
  const runDetail = assertOk(await get(`/api/eval/runs/${qcRun.id}`), 'GET /api/eval/runs/{id}');
  assert.equal(runDetail.id, qcRun.id);
  assertDeepEqual(runDetail.metrics, qcRun.metrics, 'run 详情 metrics 应与运行结果一致');
  assertErrorResponse(await get('/api/eval/runs/RUN-does-not-exist'), {
    status: 404,
    code: ERROR_CODE_BY_STATUS[404],
    context: 'GET /api/eval/runs/{id}（不存在）',
  });
  assertErrorResponse(await post('/api/eval/runs', { dataset: 'bogus' }), {
    status: 422,
    code: ERROR_CODE_BY_STATUS[422],
    field: 'dataset',
    context: 'POST /api/eval/runs（非法 dataset）',
  });
});

// ===========================================================================
// 12. 列表接口性能（NFR-005 / TEST-PERF-01：列表 P95 < 300ms）
// ===========================================================================
test('验收 列表接口性能（TEST-PERF-01 / NFR-005：P95 < 300ms）', async () => {
  const samples = [];
  for (let index = 0; index < 20; index += 1) {
    const startedAt = performance.now();
    assertOk(await get('/api/qc/conversations', { page: 1, pageSize: 20 }), `性能采样 GET /api/qc/conversations（第 ${index + 1} 次）`);
    samples.push(performance.now() - startedAt);
  }
  const p95 = percentile(samples, 0.95);
  assert.ok(p95 < 300, `QC 对话列表 P95 应 <300ms（NFR-005 / TEST-PERF-01），实际 ${p95.toFixed(1)}ms`);
  const worst = Math.max(...samples);
  assert.ok(worst < 1_000, `单次列表请求应 <1000ms，实际最慢 ${worst.toFixed(1)}ms`);
});

// ===========================================================================
// 13. reset 确定性（TEST-RESET-01 / NFR-006 / FR-SYS-006）
// ===========================================================================
test('验收 reset 确定性：两次 reset 后统计与看板完全一致（TEST-RESET-01 / NFR-006）', async () => {
  const snapshot = async (label) => {
    const qcStats = assertOk(await get('/api/qc/stats'), `GET /api/qc/stats（${label}）`);
    const sentimentStats = assertOk(await get('/api/sentiment/stats'), `GET /api/sentiment/stats（${label}）`);
    const badcaseStats = assertOk(await get('/api/badcases/stats'), `GET /api/badcases/stats（${label}）`);
    const clues = await listAll('/api/clues', {}, `clues（${label}）`);
    const alerts = await listAll('/api/sentiment/alerts', {}, `alerts（${label}）`);
    const summary = assertOk(await get('/api/dashboard/summary'), `GET /api/dashboard/summary（${label}）`);
    return {
      qcStats,
      sentimentStats,
      badcaseStats,
      clueIds: clues.map((clue) => clue.id).sort(),
      clueStatuses: Object.fromEntries(clues.map((clue) => [clue.id, clue.status])),
      alertStatuses: Object.fromEntries(alerts.map((alert) => [alert.id, alert.status])),
      kpis: summary.kpis.map((kpi) => ({ id: kpi.id, value: kpi.value, target: kpi.target, status: kpi.status })),
    };
  };

  const firstReset = await resetDemoData('验收 reset（第一次）');
  const first = await snapshot('第一次 reset 后');
  const secondReset = await resetDemoData('验收 reset（第二次）');
  const second = await snapshot('第二次 reset 后');

  assert.equal(firstReset.seeded.conversations, SEEDED_CONVERSATIONS, '第一次 reset seeded.conversations 应为 60');
  assert.equal(secondReset.seeded.conversations, SEEDED_CONVERSATIONS, '第二次 reset seeded.conversations 应为 60');
  assert.equal(firstReset.seeded.comments, SEEDED_COMMENTS, 'reset seeded.comments 应为 120');
  assert.equal(firstReset.seeded.qcResults, SEEDED_CONVERSATIONS, 'reset seeded.qcResults 应为 60');
  assertDeepEqual(first.qcStats, second.qcStats, '两次 reset 后 /api/qc/stats 应完全一致（NFR-006）');
  assertDeepEqual(first.sentimentStats, second.sentimentStats, '两次 reset 后 /api/sentiment/stats 应完全一致（NFR-006）');
  assertDeepEqual(first.badcaseStats, second.badcaseStats, '两次 reset 后 /api/badcases/stats 应完全一致');
  assertDeepEqual(first.clueIds, second.clueIds, '两次 reset 后线索 id 集合应一致');
  assertDeepEqual(first.clueStatuses, second.clueStatuses, '两次 reset 后线索状态应一致');
  assertDeepEqual(first.alertStatuses, second.alertStatuses, '两次 reset 后预警状态应一致');
  assertDeepEqual(first.kpis, second.kpis, '两次 reset 后看板 KPI 应完全一致（NFR-006）');
  assert.ok(typeof secondReset.resetAt === 'string' && secondReset.resetAt.length > 0, 'resetAt 应为非空时间字符串');
});
