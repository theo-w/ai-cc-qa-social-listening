/**
 * 种子化：把 data/ 金标数据集全量跑一遍规则引擎，生成初始运营数据。
 *
 * 确定性约束：
 * - 所有 id 按固定顺序生成（conv-1001 起、qcr-1001、rvw-1001、bc-0001、cmt-0001、alt-0001、clue-0001、eval-0001）；
 * - 所有种子时间戳由数据内 startedAt/publishedAt 或固定 DEMO_NOW 派生，不使用真实时钟；
 * - 因此同一份数据集 reset 任意次得到的运行态完全一致（FR-SYS-006 / G-EVAL-4）。
 */
import type { LoadedDatasets } from './data.js';
import { evaluateDataset } from './eval/run.js';
import { analyzeQc } from './engine/qc.js';
import { analyzeSentiment, buildAlertSummary, buildSentimentClusters } from './engine/sentiment.js';
import {
  alertSlaMinutes,
  badcaseOwner,
  badcaseSlaHours,
  categoryForTag,
  clueOwner,
  maxSeverity,
  OWNER_NAMES,
  sentimentOwner,
  TAG_MAP,
} from './engine/taxonomy.js';
import { DEMO_NOW_ISO, MODEL_VERSION, STORE_SCHEMA_VERSION } from './config.js';
import { buildKnowledgeEntries } from './knowledge.js';
import type {
  AlertAction,
  AlertLevel,
  AlertStatus,
  Badcase,
  BadcaseAction,
  BadcaseStatus,
  Clue,
  ClueActionType,
  ClueStatus,
  ClueTarget,
  Conversation,
  EvalRun,
  KnowledgeEntry,
  MetricSnapshot,
  QcDatasetItem,
  QcResult,
  ReviewTask,
  SentimentAlert,
  SentimentComment,
  SentimentDatasetItem,
  StoreData,
  TagCode,
} from './types.js';
import { addDays, addHours, addMinutes, dateKey, demoNow, diffMinutes, ratio, round } from './util/time.js';

const IMPORT_BATCH_ID = 'batch-20261103-01';

function seqId(prefix: string, index: number, pad = 4): string {
  return `${prefix}-${String(index).padStart(pad, '0')}`;
}

function minIso(left: string, right: string): string {
  return new Date(left).getTime() <= new Date(right).getTime() ? left : right;
}

function primaryTagCode(result: QcResult): string {
  return result.tags[0]?.code ?? 'attitude';
}

function monthDay(iso: string): string {
  return dateKey(iso).slice(5);
}

/* ------------------------------ 会话与质检 ------------------------------ */

function buildConversation(item: QcDatasetItem, index: number): Conversation {
  const messages = item.messages.map((message, messageIndex) => {
    const previous = item.messages[messageIndex - 1];
    return {
      seq: message.seq,
      role: message.role,
      text: message.text,
      atSec: message.atSec,
      gapSec: previous ? Math.max(0, message.atSec - previous.atSec) : null,
    };
  });
  return {
    id: `conv-${1001 + index}`,
    channel: item.channel,
    product: item.product,
    agent: { id: item.agent.id, name: item.agent.name },
    customer: { id: item.customer.id, name: item.customer.name },
    startedAt: item.startedAt,
    durationSec: item.durationSec,
    messages,
    importedAt: DEMO_NOW_ISO,
    batchId: IMPORT_BATCH_ID,
  };
}

function buildQcResult(
  conversation: Conversation,
  index: number,
  analyzedAt: string,
  knowledgeEntries: readonly KnowledgeEntry[],
): QcResult {
  const analysis = analyzeQc(
    conversation.messages.map((message) => ({
      seq: message.seq,
      role: message.role,
      text: message.text,
      atSec: message.atSec,
    })),
    knowledgeEntries,
  );
  return {
    id: `qcr-${1001 + index}`,
    conversationId: conversation.id,
    score: analysis.score,
    verdict: analysis.verdict,
    tags: analysis.tags,
    summary: analysis.summary,
    emotion: analysis.emotion,
    confidence: analysis.confidence,
    needsReview: analysis.needsReview,
    modelVersion: MODEL_VERSION,
    analyzedAt,
    latestReviewId: null,
  };
}

function buildReviewTasks(qcResults: readonly QcResult[], createdAt: string): ReviewTask[] {
  const tasks: ReviewTask[] = [];
  for (const result of qcResults) {
    if (!result.needsReview) {
      continue;
    }
    tasks.push({
      id: seqId('rvw', tasks.length + 1),
      qcResultId: result.id,
      conversationId: result.conversationId,
      status: 'pending',
      assignee: OWNER_NAMES.qc,
      decision: null,
      finalVerdict: null,
      finalTags: [],
      note: '引擎置信度低于 0.75，自动生成人工复核任务。',
      createdAt,
      reviewedAt: null,
    });
  }
  return tasks;
}

/* ------------------------------ badcase 种子 ------------------------------ */

interface ViolationEntry {
  conversation: Conversation;
  result: QcResult;
}

/** 12 条基础 badcase 的状态计划：覆盖 open/in_progress/pending_verify/closed，另有 2 条复发。 */
const BADCASE_BASE_PLAN: readonly BadcaseStatus[] = [
  'open',
  'open',
  'open',
  'open',
  'in_progress',
  'in_progress',
  'in_progress',
  'pending_verify',
  'pending_verify',
  'pending_verify',
  'closed',
  'closed',
];

function collectViolations(
  conversations: readonly Conversation[],
  qcResults: readonly QcResult[],
): ViolationEntry[] {
  const conversationById = new Map(conversations.map((conversation) => [conversation.id, conversation]));
  const entries: ViolationEntry[] = [];
  for (const result of qcResults) {
    if (result.verdict !== 'violation') {
      continue;
    }
    const conversation = conversationById.get(result.conversationId);
    if (conversation) {
      entries.push({ conversation, result });
    }
  }
  return entries.sort((left, right) => {
    const timeDiff = new Date(left.conversation.startedAt).getTime() - new Date(right.conversation.startedAt).getTime();
    if (timeDiff !== 0) {
      return timeDiff;
    }
    return left.result.id < right.result.id ? -1 : 1;
  });
}

function buildBadcaseTimeline(
  status: BadcaseStatus,
  createdAt: string,
  closedAt: string | null,
  owner: string,
  tagName: string,
): BadcaseAction[] {
  const actions: BadcaseAction[] = [
    {
      at: createdAt,
      by: OWNER_NAMES.qc,
      type: 'created',
      note: `质检命中「${tagName}」，自动创建 badcase 并路由给 ${owner}。`,
      from: null,
      to: 'open',
    },
  ];
  if (status === 'open') {
    return actions;
  }
  const assignedAt = addMinutes(createdAt, 30);
  actions.push({
    at: assignedAt,
    by: OWNER_NAMES.qc,
    type: 'assigned',
    note: `指派给 ${owner} 跟进。`,
    from: 'open',
    to: 'in_progress',
  });
  actions.push({
    at: addMinutes(createdAt, 90),
    by: owner,
    type: 'progressed',
    note: '已定位根因，正在补充知识/话术。',
    from: 'in_progress',
    to: 'in_progress',
  });
  if (status === 'in_progress') {
    return actions;
  }
  actions.push({
    at: addMinutes(createdAt, 150),
    by: owner,
    type: 'verified',
    note: '整改完成，提交主管验证。',
    from: 'in_progress',
    to: 'pending_verify',
  });
  if (status === 'pending_verify') {
    return actions;
  }
  const closeTime = closedAt ?? addMinutes(createdAt, 240);
  actions.push({
    at: closeTime,
    by: OWNER_NAMES.lead,
    type: 'closed',
    note: `验证通过，关闭 badcase（${tagName}）。`,
    from: 'pending_verify',
    to: 'closed',
  });
  return actions;
}

function makeBadcase(
  entry: ViolationEntry,
  sequence: number,
  status: BadcaseStatus,
  recurrenceOf: string | null,
): Badcase {
  const { conversation, result } = entry;
  const tagCode = primaryTagCode(result) as TagCode;
  const tag = TAG_MAP[tagCode];
  const category = categoryForTag(tagCode);
  const severity = maxSeverity(result.tags.map((item) => item.severity));
  const slaHours = badcaseSlaHours(category);
  const owner = badcaseOwner(category);
  const createdAt = minIso(addHours(conversation.startedAt, 2), DEMO_NOW_ISO);
  const dueAt = addHours(createdAt, slaHours);
  const closed = status === 'closed';
  const closedAt = closed ? minIso(addMinutes(createdAt, 240), DEMO_NOW_ISO) : null;
  const timeline = buildBadcaseTimeline(status, createdAt, closedAt, owner, tag.name);
  const evidence = result.tags.flatMap((item) =>
    item.evidence.map((itemEvidence) => ({
      seq: itemEvidence.seq,
      quote: itemEvidence.quote,
      note: item.name,
    })),
  );
  return {
    id: seqId('bc', sequence),
    code: `BC-2026-${String(sequence).padStart(4, '0')}`,
    conversationId: conversation.id,
    qcResultId: result.id,
    title: `${tag.name}问题 · ${conversation.agent.name} · ${monthDay(conversation.startedAt)}`,
    category,
    rootCause: `${tag.description}。会话摘要：${result.summary}`,
    owner,
    creator: OWNER_NAMES.qc,
    severity,
    slaHours,
    dueAt,
    status,
    recurrence: recurrenceOf !== null,
    recurrenceOf,
    evidence,
    closedAt,
    proof: closed ? '已完成知识库更新与话术培训，抽检 5 通会话未再出现同类问题。' : null,
    timeline,
    createdAt,
    updatedAt: timeline[timeline.length - 1]?.at ?? createdAt,
  };
}

function buildBadcases(conversations: readonly Conversation[], qcResults: readonly QcResult[]): Badcase[] {
  const violations = collectViolations(conversations, qcResults);
  const baseEntries = violations.slice(0, BADCASE_BASE_PLAN.length);
  const badcases: Badcase[] = baseEntries.map((entry, index) =>
    makeBadcase(entry, index + 1, BADCASE_BASE_PLAN[index] ?? 'open', null),
  );

  // 复发：同坐席、同主标签、先关闭一条，后续 14 天内再次出现 → recurrence=true。
  const usedConversations = new Set(badcases.map((badcase) => badcase.conversationId));
  const usedResults = new Set(badcases.map((badcase) => badcase.qcResultId));
  const closedBases = badcases.filter((badcase) => badcase.status === 'closed');
  const recurrenceEntries: { entry: ViolationEntry; prior: Badcase }[] = [];

  for (const prior of closedBases) {
    if (recurrenceEntries.length >= 2) {
      break;
    }
    const priorConversation = conversations.find((conversation) => conversation.id === prior.conversationId);
    const priorResult = qcResults.find((result) => result.id === prior.qcResultId);
    if (!priorConversation || !priorResult) {
      continue;
    }
    const priorTag = primaryTagCode(priorResult);
    const priorStartedMs = new Date(priorConversation.startedAt).getTime();
    const candidate = violations.find((entry) => {
      if (usedConversations.has(entry.conversation.id) || usedResults.has(entry.result.id)) {
        return false;
      }
      if (primaryTagCode(entry.result) !== priorTag) {
        return false;
      }
      const startedMs = new Date(entry.conversation.startedAt).getTime();
      if (startedMs <= priorStartedMs) {
        return false;
      }
      const withinWindow = startedMs - priorStartedMs <= 14 * 24 * 60 * 60 * 1000;
      const sameAgent = entry.conversation.agent.id === priorConversation.agent.id;
      return sameAgent && withinWindow;
    });
    if (candidate) {
      usedConversations.add(candidate.conversation.id);
      usedResults.add(candidate.result.id);
      recurrenceEntries.push({ entry: candidate, prior });
    }
  }

  // 兜底：数据内同坐席同标签对不足时放宽条件，仍保证 2 条复发样本（报告注明）。
  if (recurrenceEntries.length < 2) {
    for (const prior of closedBases) {
      if (recurrenceEntries.length >= 2) {
        break;
      }
      const priorResult = qcResults.find((result) => result.id === prior.qcResultId);
      if (!priorResult) {
        continue;
      }
      const priorTag = primaryTagCode(priorResult);
      const candidate = violations.find(
        (entry) =>
          !usedConversations.has(entry.conversation.id) &&
          !usedResults.has(entry.result.id) &&
          primaryTagCode(entry.result) === priorTag &&
          new Date(entry.conversation.startedAt).getTime() > new Date(prior.createdAt).getTime(),
      );
      if (candidate) {
        usedConversations.add(candidate.conversation.id);
        usedResults.add(candidate.result.id);
        recurrenceEntries.push({ entry: candidate, prior });
      }
    }
  }

  for (let index = 0; index < recurrenceEntries.length; index += 1) {
    const recurrence = recurrenceEntries[index];
    if (!recurrence) {
      continue;
    }
    badcases.push(makeBadcase(recurrence.entry, badcases.length + 1, index === 0 ? 'open' : 'in_progress', recurrence.prior.id));
  }
  return badcases;
}

/**
 * 知识完善闭环种子：把知识类 badcase 关联到其质检命中引用的知识条目。
 * 关联后，知识库详情可以直接展示「哪些 badcase 由该条目闭环」。
 */
function linkKnowledgeBadcases(
  entries: readonly KnowledgeEntry[],
  badcases: readonly Badcase[],
  qcResults: readonly QcResult[],
): void {
  for (const badcase of badcases) {
    if (badcase.category !== 'knowledge') {
      continue;
    }
    const result = qcResults.find((candidate) => candidate.conversationId === badcase.conversationId);
    const ref = result?.tags.find((tag) => tag.code === 'wrong_knowledge')?.knowledge;
    if (!ref) {
      continue;
    }
    const entry = entries.find((candidate) => candidate.id === ref.entryId);
    if (entry && !entry.linkedBadcaseIds.includes(badcase.id)) {
      entry.linkedBadcaseIds.push(badcase.id);
    }
  }
}

/* ------------------------------ 舆情评论与预警 ------------------------------ */

function buildComments(items: readonly SentimentDatasetItem[]): SentimentComment[] {
  return items.map((item, index) => {
    const analysis = analyzeSentiment({ text: item.text });
    return {
      id: seqId('cmt', index + 1),
      source: item.source,
      brand: item.brand,
      author: item.author,
      text: item.text,
      publishedAt: item.publishedAt,
      sentiment: analysis.sentiment,
      sentimentScore: analysis.sentimentScore,
      topics: analysis.topics,
      primaryTopic: analysis.primaryTopic,
      severity: analysis.severity,
      confidence: analysis.confidence,
      needsReview: analysis.needsReview,
      alertId: null,
      engineRules: analysis.engineRules,
    };
  });
}

/** 预警状态计划（按簇日期顺序轮转，保证状态覆盖且部分新预警超期）。 */
const ALERT_STATUS_PLAN: readonly AlertStatus[] = [
  'resolved',
  'resolved',
  'acknowledged',
  'escalated',
  'responding',
  'new',
  'resolved',
  'acknowledged',
  'new',
  'responding',
  'resolved',
  'escalated',
  'new',
  'resolved',
  'acknowledged',
  'new',
];

function buildAlertTimeline(
  status: AlertStatus,
  createdAt: string,
  firstResponseAt: string | null,
  resolvedAt: string | null,
): AlertAction[] {
  const actions: AlertAction[] = [
    {
      at: createdAt,
      by: '系统',
      type: 'created',
      note: '聚合规则触发，自动生成舆情预警。',
      from: null,
      to: 'new',
    },
  ];
  if (firstResponseAt === null) {
    return actions;
  }
  actions.push({
    at: firstResponseAt,
    by: OWNER_NAMES.brand,
    type: 'acknowledged',
    note: '已确认预警，开始评估影响。',
    from: 'new',
    to: 'acknowledged',
  });
  if (status === 'acknowledged') {
    return actions;
  }
  if (status === 'escalated') {
    actions.push({
      at: addMinutes(firstResponseAt, 10),
      by: OWNER_NAMES.lead,
      type: 'escalated',
      note: '升级至客服主管与品牌负责人协同处理。',
      from: 'acknowledged',
      to: 'escalated',
    });
    return actions;
  }
  actions.push({
    at: addMinutes(firstResponseAt, 5),
    by: OWNER_NAMES.lead,
    type: 'responded',
    note: '已进入响应流程，准备公告与补偿方案。',
    from: 'acknowledged',
    to: 'responding',
  });
  if (resolvedAt !== null) {
    actions.push({
      at: resolvedAt,
      by: OWNER_NAMES.lead,
      type: 'resolved',
      note: '问题已修复，负面评论回落，预警关闭。',
      from: 'responding',
      to: 'resolved',
    });
  }
  return actions;
}

function buildAlertsAndBind(comments: SentimentComment[]): SentimentAlert[] {
  const clusters = buildSentimentClusters(
    comments.map((comment) => ({
      id: comment.id,
      text: comment.text,
      source: comment.source,
      publishedAt: comment.publishedAt,
      analysis: {
        sentiment: comment.sentiment,
        sentimentScore: comment.sentimentScore,
        topics: comment.topics,
        primaryTopic: comment.primaryTopic,
        severity: comment.severity,
        confidence: comment.confidence,
        needsReview: comment.needsReview,
        engineRules: comment.engineRules,
      },
    })),
  );

  const commentById = new Map(comments.map((comment) => [comment.id, comment]));
  const alerts: SentimentAlert[] = [];

  for (const draft of clusters) {
    const index = alerts.length;
    const level: AlertLevel = draft.level;
    const status = ALERT_STATUS_PLAN[index % ALERT_STATUS_PLAN.length] ?? 'new';
    const clusterComments = draft.commentIds
      .map((id) => commentById.get(id))
      .filter((comment): comment is SentimentComment => comment !== undefined);
    const createdAt = addMinutes(`${draft.date}T23:59:00+08:00`, 1);
    const slaMinutes = alertSlaMinutes(level);
    const slaDueAt = addMinutes(createdAt, slaMinutes);
    const hasResponse = status !== 'new';
    const firstResponseAt = hasResponse
      ? minIso(addMinutes(createdAt, Math.max(5, Math.round(slaMinutes * 0.3))), DEMO_NOW_ISO)
      : null;
    const resolvedAt =
      status === 'resolved' && firstResponseAt !== null ? minIso(addMinutes(firstResponseAt, 45), DEMO_NOW_ISO) : null;

    const alert: SentimentAlert = {
      id: seqId('alt', index + 1),
      level,
      topic: draft.topic,
      title: `${draft.topic} · ${draft.date.slice(5)} 集中负面`,
      summary: buildAlertSummary(draft, clusterComments),
      windowStart: `${draft.date}T00:00:00+08:00`,
      windowEnd: `${draft.date}T23:59:00+08:00`,
      triggerRules: draft.triggerRules,
      commentIds: [...draft.commentIds].sort(),
      status,
      owner: sentimentOwner(draft.topic, level),
      slaMinutes,
      slaDueAt,
      firstResponseAt,
      resolvedAt,
      timeline: buildAlertTimeline(status, createdAt, firstResponseAt, resolvedAt),
      linkedClueIds: [],
      createdAt,
    };
    alerts.push(alert);
    for (const id of alert.commentIds) {
      const comment = commentById.get(id);
      if (comment) {
        comment.alertId = alert.id;
      }
    }
  }
  return alerts;
}

/* ------------------------------ 线索种子 ------------------------------ */

interface ClueSeedPlan {
  target: ClueTarget;
  status: ClueStatus;
  source: 'sentiment' | 'qc' | 'dashboard' | 'agent';
}

const CLUE_PLAN: readonly ClueSeedPlan[] = [
  { target: 'brand', status: 'closed', source: 'sentiment' },
  { target: 'product', status: 'closed', source: 'sentiment' },
  { target: 'cs', status: 'accepted', source: 'sentiment' },
  { target: 'market', status: 'accepted', source: 'sentiment' },
  { target: 'product', status: 'routed', source: 'qc' },
  { target: 'cs', status: 'routed', source: 'qc' },
  { target: 'brand', status: 'rejected', source: 'sentiment' },
  { target: 'market', status: 'rejected', source: 'dashboard' },
  { target: 'product', status: 'draft', source: 'dashboard' },
  { target: 'cs', status: 'draft', source: 'agent' },
];

const CLUE_STATUS_STEPS: Record<ClueStatus, ClueStatus[]> = {
  draft: ['draft'],
  routed: ['draft', 'routed'],
  accepted: ['draft', 'routed', 'accepted'],
  rejected: ['draft', 'routed', 'rejected'],
  closed: ['draft', 'routed', 'accepted', 'closed'],
};

function clueActionForStatus(status: ClueStatus): ClueActionType {
  switch (status) {
    case 'routed':
      return 'routed';
    case 'accepted':
      return 'accepted';
    case 'rejected':
      return 'rejected';
    case 'closed':
      return 'closed';
    default:
      return 'created';
  }
}

function buildClues(alerts: readonly SentimentAlert[], badcases: readonly Badcase[]): Clue[] {
  const clues: Clue[] = [];
  for (let index = 0; index < CLUE_PLAN.length; index += 1) {
    const plan = CLUE_PLAN[index];
    if (!plan) {
      continue;
    }
    const alert = alerts.length > 0 ? alerts[index % alerts.length] : undefined;
    const badcase = badcases.length > 0 ? badcases[index % badcases.length] : undefined;
    const createdAt = addMinutes(alert?.createdAt ?? DEMO_NOW_ISO, 30 + index * 10);
    const owner = clueOwner(plan.target);
    const steps = CLUE_STATUS_STEPS[plan.status];
    const timeline: Clue['timeline'] = [
      {
        at: createdAt,
        by: '系统',
        type: 'created',
        note: '由预警/质检结果沉淀为线索。',
        from: null,
        to: 'draft',
      },
    ];
    let stepAt = createdAt;
    for (const step of steps.slice(1)) {
      stepAt = addMinutes(stepAt, 25);
      const note =
        step === 'routed'
          ? `已分派给 ${owner} 跟进。`
          : step === 'accepted'
            ? '接收方已确认，纳入迭代计划。'
            : step === 'rejected'
              ? '评估后判定为已有覆盖，暂不立项。'
              : '已交付完成，线索关闭归档。';
      timeline.push({
        at: stepAt,
        by: step === 'routed' ? OWNER_NAMES.qc : owner,
        type: clueActionForStatus(step),
        note,
        from: timeline[timeline.length - 1]?.to ?? null,
        to: step,
      });
    }

    let title: string;
    let description: string;
    let sourceRef: Clue['sourceRef'];
    if (plan.source === 'sentiment' && alert) {
      title = `舆情线索：${alert.title}`;
      description = `根据 ${alert.level} 预警「${alert.title}」沉淀，建议 ${plan.target} 团队跟进。${alert.summary}`;
      sourceRef = { type: 'alert', id: alert.id, label: alert.title };
    } else if (plan.source === 'qc' && badcase) {
      title = `质检线索：${badcase.title}`;
      description = `由 badcase ${badcase.code} 沉淀，建议 ${plan.target} 团队评估根因整改。${badcase.rootCause}`;
      sourceRef = { type: 'badcase', id: badcase.id, label: badcase.code };
    } else {
      title = `运营线索：${plan.target} 侧体验优化建议 ${String(index + 1).padStart(2, '0')}`;
      description = '由看板指标波动与人工洞察汇总生成的体验优化线索。';
      sourceRef = { type: 'dashboard', id: 'dashboard-summary', label: '运营看板' };
    }

    clues.push({
      id: seqId('clue', index + 1),
      title,
      description,
      sourceType: plan.source,
      sourceRef,
      target: plan.target,
      priority: index % 3 === 0 ? 'high' : index % 3 === 1 ? 'medium' : 'low',
      status: plan.status,
      owner,
      createdBy: OWNER_NAMES.qc,
      evidence: [sourceRef.label],
      outcome: plan.status === 'closed' ? '已纳入版本迭代并完成验收。' : null,
      timeline,
      createdAt,
      updatedAt: timeline[timeline.length - 1]?.at ?? createdAt,
      closedAt: plan.status === 'closed' ? (timeline[timeline.length - 1]?.at ?? createdAt) : null,
    });
  }
  return clues;
}

/* ------------------------------ 指标快照与评测 ------------------------------ */

function buildMetricSnapshots(): MetricSnapshot[] {
  const snapshots: MetricSnapshot[] = [];
  const nowKey = dateKey(DEMO_NOW_ISO);
  for (let offset = 13; offset >= 0; offset -= 1) {
    const date = dateKey(addDays(`${nowKey}T00:00:00+08:00`, -offset));
    const index = 13 - offset;
    snapshots.push({
      date,
      qcCoverage: round(0.94 + (index % 3) * 0.02, 3),
      qcAccuracy: round(0.82 + (index % 4) * 0.02, 3),
      qcReviewRatio: round(0.15 + (index % 3) * 0.02, 3),
      badcaseCloseRate: round(0.3 + (index % 3) * 0.05, 3),
      recurrenceRate: round(0.1 + (index % 2) * 0.03, 3),
      p0ResponseMin: round(12 + (index % 5) * 2, 1),
      p1ResponseMin: round(40 + (index % 4) * 5, 1),
      alertPrecision: round(0.82 + (index % 3) * 0.03, 3),
      sentimentAccuracy: round(0.82 + (index % 4) * 0.02, 3),
      clueCloseRate: round(0.2 + (index % 2) * 0.1, 3),
      clueConversion: round(0.15 + (index % 3) * 0.03, 3),
      csat: round(4.1 + (index % 5) * 0.1, 1),
      firstResponseSec: round(90 + (index % 5) * 10, 0),
      transferRate: round(0.08 + (index % 3) * 0.01, 3),
    });
  }
  return snapshots;
}

function buildEvalRuns(datasets: LoadedDatasets): EvalRun[] {
  const qc = evaluateDataset('qc', datasets);
  const sentiment = evaluateDataset('sentiment', datasets);
  return [
    {
      id: 'eval-0001',
      dataset: 'qc',
      datasetId: qc.datasetId,
      datasetVersion: qc.datasetVersion,
      runAt: DEMO_NOW_ISO,
      durationMs: qc.durationMs,
      modelVersion: MODEL_VERSION,
      metrics: qc.metrics,
      confusion: qc.confusion,
      mismatches: qc.mismatches,
      thresholdsMet: qc.thresholdsMet,
      summary: qc.summary,
      ...(qc.tagPrecision ? { tagPrecision: qc.tagPrecision } : {}),
    },
    {
      id: 'eval-0002',
      dataset: 'sentiment',
      datasetId: sentiment.datasetId,
      datasetVersion: sentiment.datasetVersion,
      runAt: DEMO_NOW_ISO,
      durationMs: sentiment.durationMs,
      modelVersion: MODEL_VERSION,
      metrics: sentiment.metrics,
      confusion: sentiment.confusion,
      mismatches: sentiment.mismatches,
      thresholdsMet: sentiment.thresholdsMet,
      summary: sentiment.summary,
    },
  ];
}

/* ------------------------------ 汇总 ------------------------------ */

export interface SeedCounts {
  conversations: number;
  qcResults: number;
  comments: number;
  badcases: number;
  knowledgeEntries: number;
  alerts: number;
  clues: number;
  metricSnapshots: number;
  reviewTasks: number;
  evalRuns: number;
}

export interface SeedResult {
  store: StoreData;
  counts: SeedCounts;
}

/** 由数据集构建完整运行态（纯函数，确定性）。 */
export function buildSeed(datasets: LoadedDatasets): SeedResult {
  const analyzedAt = DEMO_NOW_ISO;
  const knowledgeEntries = buildKnowledgeEntries(datasets.knowledge.entries);
  const conversations = datasets.qc.items.map((item, index) => buildConversation(item, index));
  const qcResults = conversations.map((conversation, index) =>
    buildQcResult(conversation, index, analyzedAt, knowledgeEntries),
  );
  const reviewTasks = buildReviewTasks(qcResults, analyzedAt);
  const badcases = buildBadcases(conversations, qcResults);
  linkKnowledgeBadcases(knowledgeEntries, badcases, qcResults);
  const comments = buildComments(datasets.sentiment.items);
  const alerts = buildAlertsAndBind(comments);
  const clues = buildClues(alerts, badcases);
  const metricSnapshots = buildMetricSnapshots();
  const evalRuns = buildEvalRuns(datasets);

  const store: StoreData = {
    schemaVersion: STORE_SCHEMA_VERSION,
    datasetVersion: datasets.datasetStamp,
    seededAt: DEMO_NOW_ISO,
    conversations,
    qcResults,
    reviewTasks,
    badcases,
    knowledgeEntries,
    comments,
    alerts,
    clues,
    evalRuns,
    metricSnapshots,
  };

  return {
    store,
    counts: {
      conversations: conversations.length,
      qcResults: qcResults.length,
      comments: comments.length,
      badcases: badcases.length,
      knowledgeEntries: knowledgeEntries.length,
      alerts: alerts.length,
      clues: clues.length,
      metricSnapshots: metricSnapshots.length,
      reviewTasks: reviewTasks.length,
      evalRuns: evalRuns.length,
    },
  };
}

/** 当前业务时间（演示时间，供路由复用）。 */
export function seedNow(): string {
  return demoNow();
}

/** 供统计复用（与 runtime 统计口径一致）。 */
export function ratioOf(numerator: number, denominator: number, digits = 3): number {
  return ratio(numerator, denominator, digits);
}

/** 时间差（分钟，供路由计算响应时长）。 */
export function minutesBetween(fromIso: string, toIso: string): number {
  return diffMinutes(fromIso, toIso);
}
