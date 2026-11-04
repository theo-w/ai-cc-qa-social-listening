/**
 * 运行态统计与看板聚合（002 FR-QC-006 / FR-BC-005 / FR-SEN-006 / FR-SYS-001..003 / FR-SYS-004）。
 *
 * 口径约定：
 * - 所有 ratio 分母为 0 时返回 0；响应时长无样本时返回 null（BR-10）；
 * - 统计总量不受 range 影响，range 只影响趋势与 delta；
 * - "当前时间"统一取固定演示时间 DEMO_NOW（决不允许 Date.now() 参与判定）。
 */
import type {
  AlertLevel,
  Badcase,
  BadcaseStats,
  DashboardAnomaly,
  DashboardKpi,
  DashboardSummary,
  QcStats,
  RangeKey,
  SentimentAlert,
  SentimentStats,
  StoreData,
  TrendRow,
} from './types.js';
import {
  alertLevelRank,
  BADCASE_CATEGORIES,
  CLUE_TARGETS,
  OWNER_NAMES,
  TAGS,
  TAG_MAP,
  TOPICS,
} from './engine/taxonomy.js';
import { dateKey, dateRangeKeys, demoNow, diffMinutes, ratio, round } from './util/time.js';
import { SOURCES } from './engine/taxonomy.js';

const CHANNELS = ['online', 'ticket', 'phone'] as const;
const ALERT_LEVELS: readonly AlertLevel[] = ['P0', 'P1', 'P2'];
const SENTIMENTS = ['positive', 'neutral', 'negative'] as const;

export const RANGE_DAYS: Record<RangeKey, number> = { '7d': 7, '14d': 14, '30d': 30 };

export function isBadcaseOverdue(badcase: Badcase, now = demoNow()): boolean {
  return badcase.status !== 'closed' && new Date(badcase.dueAt).getTime() < new Date(now).getTime();
}

export function isAlertOverdue(alert: SentimentAlert, now = demoNow()): boolean {
  if (alert.firstResponseAt !== null || alert.status === 'resolved') {
    return false;
  }
  return new Date(alert.slaDueAt).getTime() < new Date(now).getTime();
}

/* ------------------------------ 质检统计 ------------------------------ */

export function buildQcStats(store: StoreData): QcStats {
  const verdictById = new Map(store.qcResults.map((result) => [result.id, result]));
  const pass = store.qcResults.filter((result) => result.verdict === 'pass').length;
  const violation = store.qcResults.filter((result) => result.verdict === 'violation').length;
  const analyzed = store.qcResults.length;
  const needsReview = store.qcResults.filter((result) => result.needsReview).length;
  const reviewed = store.reviewTasks.filter((task) => task.status === 'done').length;
  const scoreSum = store.qcResults.reduce((sum, result) => sum + result.score, 0);

  const tagDistribution = TAGS.map((tag) => ({
    code: tag.code,
    name: tag.name,
    count: store.qcResults.filter((result) => result.tags.some((item) => item.code === tag.code)).length,
  }));

  const conversationById = new Map(store.conversations.map((conversation) => [conversation.id, conversation]));
  const channelDistribution = CHANNELS.map((channel) => ({
    channel,
    count: store.qcResults.filter((result) => conversationById.get(result.conversationId)?.channel === channel).length,
  }));

  return {
    total: pass + violation,
    analyzed,
    pass,
    violation,
    needsReview,
    reviewed,
    avgScore: analyzed === 0 ? 0 : round(scoreSum / analyzed, 1),
    reviewRatio: ratio(needsReview, analyzed, 3),
    tagDistribution,
    channelDistribution,
  };
}

/* ------------------------------ badcase 统计 ------------------------------ */

export function buildBadcaseStats(store: StoreData): BadcaseStats {
  const now = demoNow();
  const total = store.badcases.length;
  const closed = store.badcases.filter((badcase) => badcase.status === 'closed').length;
  const ownerCounts = new Map<string, number>();
  for (const badcase of store.badcases) {
    ownerCounts.set(badcase.owner, (ownerCounts.get(badcase.owner) ?? 0) + 1);
  }
  const byOwner = [...ownerCounts.entries()]
    .map(([owner, count]) => ({ owner, count }))
    .sort((left, right) => (right.count - left.count !== 0 ? right.count - left.count : left.owner < right.owner ? -1 : 1));

  return {
    total,
    open: store.badcases.filter((badcase) => badcase.status === 'open').length,
    inProgress: store.badcases.filter((badcase) => badcase.status === 'in_progress').length,
    pendingVerify: store.badcases.filter((badcase) => badcase.status === 'pending_verify').length,
    closed,
    overdue: store.badcases.filter((badcase) => isBadcaseOverdue(badcase, now)).length,
    closeRate: ratio(closed, total),
    recurrenceRate: ratio(store.badcases.filter((badcase) => badcase.recurrence).length, total, 3),
    byCategory: BADCASE_CATEGORIES.map((category) => ({
      category: category.code,
      count: store.badcases.filter((badcase) => badcase.category === category.code).length,
    })),
    byOwner,
  };
}

/* ------------------------------ 舆情统计 ------------------------------ */

function averageMinutes(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return round(values.reduce((sum, value) => sum + value, 0) / values.length, 2);
}

export function buildSentimentStats(store: StoreData): SentimentStats {
  const comments = store.comments.length;
  const negative = store.comments.filter((comment) => comment.sentiment === 'negative').length;
  const alerts = store.alerts;
  const responses = alerts
    .filter((alert) => alert.firstResponseAt !== null)
    .map((alert) => diffMinutes(alert.createdAt, alert.firstResponseAt as string));
  const p0Responses = alerts
    .filter((alert) => alert.level === 'P0' && alert.firstResponseAt !== null)
    .map((alert) => diffMinutes(alert.createdAt, alert.firstResponseAt as string));
  const p1Responses = alerts
    .filter((alert) => alert.level === 'P1' && alert.firstResponseAt !== null)
    .map((alert) => diffMinutes(alert.createdAt, alert.firstResponseAt as string));
  const p0Count = alerts.filter((alert) => alert.level === 'P0').length;
  const p1Count = alerts.filter((alert) => alert.level === 'P1').length;
  const p2Count = alerts.filter((alert) => alert.level === 'P2').length;

  return {
    comments,
    analyzed: comments,
    negativeRatio: ratio(negative, comments),
    needsReview: store.comments.filter((comment) => comment.needsReview).length,
    alertsTotal: alerts.length,
    alertsOpen: alerts.filter((alert) => alert.status !== 'resolved').length,
    p0: p0Count,
    p1: p1Count,
    p2: p2Count,
    avgFirstResponseMin: averageMinutes(responses),
    p0ResponseMin: averageMinutes(p0Responses),
    p1ResponseMin: averageMinutes(p1Responses),
    topicDistribution: TOPICS.map((topic) => ({
      topic,
      count: store.comments.filter((comment) => comment.primaryTopic === topic).length,
    })),
    sourceDistribution: SOURCES.map((source) => ({
      source: source.id,
      count: store.comments.filter((comment) => comment.source === source.id).length,
    })),
    sentimentDistribution: SENTIMENTS.map((sentiment) => ({
      sentiment,
      count: store.comments.filter((comment) => comment.sentiment === sentiment).length,
    })),
  };
}

/* ------------------------------ 评测指标复用 ------------------------------ */

export function latestEvalMetrics(store: StoreData, dataset: 'qc' | 'sentiment'): Record<string, number | Record<string, number>> | null {
  const runs = store.evalRuns
    .filter((run) => run.dataset === dataset)
    .sort((left, right) => {
      const timeDiff = new Date(right.runAt).getTime() - new Date(left.runAt).getTime();
      if (timeDiff !== 0) {
        return timeDiff;
      }
      return right.id < left.id ? -1 : 1;
    });
  return runs[0]?.metrics ?? null;
}

/* ------------------------------ 看板 ------------------------------ */

function kpiStatus(op: '>=' | '<=', value: number, target: number): 'ok' | 'warn' | 'bad' {
  if (op === '>=') {
    if (value >= target) {
      return 'ok';
    }
    return value >= target * 0.9 ? 'warn' : 'bad';
  }
  if (value <= target) {
    return 'ok';
  }
  return value <= target * 1.1 ? 'warn' : 'bad';
}

function snapshotValue(store: StoreData, index: number, field: keyof StoreData['metricSnapshots'][number]): number | null {
  const snapshot = store.metricSnapshots[index];
  if (!snapshot) {
    return null;
  }
  const value = snapshot[field];
  return typeof value === 'number' ? value : null;
}

function buildKpis(store: StoreData): DashboardKpi[] {
  const qcStats = buildQcStats(store);
  const badcaseStats = buildBadcaseStats(store);
  const sentimentStats = buildSentimentStats(store);
  const qcMetrics = latestEvalMetrics(store, 'qc');
  const sentimentMetrics = latestEvalMetrics(store, 'sentiment');
  const lastIndex = store.metricSnapshots.length - 1;
  const prevIndex = lastIndex - 1;
  const latestSnapshot = store.metricSnapshots[lastIndex];

  const clueCloseRate = ratio(store.clues.filter((clue) => clue.status === 'closed').length, store.clues.length, 3);
  const qcCoverage = ratio(qcStats.analyzed, store.conversations.length, 3);
  const qcAccuracy = (qcMetrics?.accuracy as number) ?? 0;
  const alertPrecision = (sentimentMetrics?.alertPrecision as number) ?? 0;
  const p0ResponseMin = sentimentStats.p0ResponseMin ?? 0;
  const csat = latestSnapshot?.csat ?? 0;

  const specs: {
    id: string;
    label: string;
    value: number;
    target: number;
    op: '>=' | '<=';
    unit: DashboardKpi['unit'];
    hint: string;
    snapshotField: keyof StoreData['metricSnapshots'][number];
  }[] = [
    {
      id: 'qcCoverage',
      label: '质检覆盖率',
      value: qcCoverage,
      target: 0.9,
      op: '>=',
      unit: 'percent',
      hint: '目标 ≥90%：已质检会话 / 导入会话',
      snapshotField: 'qcCoverage',
    },
    {
      id: 'qcAccuracy',
      label: '质检准确率',
      value: qcStats.avgScore / 100,
      target: 0.8,
      op: '>=',
      unit: 'percent',
      hint: '目标 ≥80%：质检平均分/100',
      snapshotField: 'qcAccuracy',
    },
    {
      id: 'badcaseCloseRate',
      label: 'badcase 关闭率',
      value: badcaseStats.closeRate,
      target: 0.7,
      op: '>=',
      unit: 'percent',
      hint: '目标 ≥70%：已关闭 / 全部 badcase',
      snapshotField: 'badcaseCloseRate',
    },
    {
      id: 'p0ResponseMin',
      label: 'P0 首响时长',
      value: p0ResponseMin,
      target: 30,
      op: '<=',
      unit: 'min',
      hint: '目标 ≤30 分钟：P0 预警首响均值',
      snapshotField: 'p0ResponseMin',
    },
    {
      id: 'alertPrecision',
      label: '预警准确率',
      value: alertPrecision,
      target: 0.8,
      op: '>=',
      unit: 'percent',
      hint: '目标 ≥80%：最近一次舆情评测预警 precision',
      snapshotField: 'alertPrecision',
    },
    {
      id: 'clueCloseRate',
      label: '线索关闭率',
      value: clueCloseRate,
      target: 0.7,
      op: '>=',
      unit: 'percent',
      hint: '目标 ≥70%：已关闭 / 全部线索',
      snapshotField: 'clueCloseRate',
    },
    {
      id: 'csat',
      label: '客户满意度',
      value: csat,
      target: 4.2,
      op: '>=',
      unit: 'score',
      hint: '目标 ≥4.2 分（5 分制）',
      snapshotField: 'csat',
    },
  ];

  return specs.map((spec) => {
    const previous = snapshotValue(store, prevIndex, spec.snapshotField);
    const delta = previous === null ? 0 : round(spec.value - previous, 3);
    return {
      id: spec.id,
      label: spec.label,
      value: spec.value,
      target: spec.target,
      op: spec.op,
      status: kpiStatus(spec.op, spec.value, spec.target),
      delta,
      unit: spec.unit,
      hint: spec.hint,
    };
  });
}

export function buildDashboardSummary(store: StoreData, range: RangeKey): DashboardSummary {
  const qcStats = buildQcStats(store);
  const badcaseStats = buildBadcaseStats(store);
  const alerts = store.alerts;
  const channelById = new Map(store.conversations.map((conversation) => [conversation.id, conversation.channel]));

  return {
    range,
    generatedAt: demoNow(),
    kpis: buildKpis(store),
    volume: {
      conversations: store.conversations.length,
      reviewPending: qcStats.needsReview,
      badcasesOpen: badcaseStats.total - badcaseStats.closed,
      alertsOpen: alerts.filter((alert) => alert.status !== 'resolved').length,
      cluesOpen: store.clues.filter((clue) => clue.status !== 'closed').length,
    },
    quality: {
      avgScore: qcStats.avgScore,
      violationRate: ratio(qcStats.violation, qcStats.analyzed, 3),
    },
    distribution: {
      tags: TAGS.map((tag) => ({
        code: tag.code,
        name: tag.name,
        count: store.qcResults.filter((result) => result.tags.some((item) => item.code === tag.code)).length,
      })),
      channels: CHANNELS.map((channel) => ({
        channel,
        count: store.qcResults.filter((result) => channelById.get(result.conversationId) === channel).length,
      })),
      alertLevels: ALERT_LEVELS.map((level) => ({
        level,
        count: alerts.filter((alert) => alert.level === level).length,
      })),
      clueTargets: CLUE_TARGETS.map((target) => ({
        target: target.id,
        count: store.clues.filter((clue) => clue.target === target.id).length,
      })),
    },
  };
}

export function buildDashboardTrends(store: StoreData, range: RangeKey): { range: RangeKey; rows: TrendRow[] } {
  const days = RANGE_DAYS[range];
  const end = demoNow();
  const endDate = dateKey(end);
  const startDate = dateKey(new Date(new Date(`${endDate}T00:00:00+08:00`).getTime() - (days - 1) * 24 * 60 * 60 * 1000).toISOString());
  const dates = dateRangeKeys(startDate, endDate);
  const snapshotByDate = new Map(store.metricSnapshots.map((snapshot) => [snapshot.date, snapshot]));

  return {
    range,
    rows: dates.map((date) => {
      const snapshot = snapshotByDate.get(date);
      return {
        date,
        qcCoverage: snapshot?.qcCoverage ?? null,
        qcAccuracy: snapshot?.qcAccuracy ?? null,
        badcaseCloseRate: snapshot?.badcaseCloseRate ?? null,
        p0ResponseMin: snapshot?.p0ResponseMin ?? null,
        alertPrecision: snapshot?.alertPrecision ?? null,
        clueCloseRate: snapshot?.clueCloseRate ?? null,
        csat: snapshot?.csat ?? null,
      };
    }),
  };
}

const DRILL: Record<string, { drillType: DashboardAnomaly['drillType']; drillFilter: Record<string, string>; owner: string; suggestion: string }> = {
  qcCoverage: {
    drillType: 'qc',
    drillFilter: {},
    owner: OWNER_NAMES.qc,
    suggestion: '检查导入批次与质检任务队列，确认新会话已完成全量检测。',
  },
  qcAccuracy: {
    drillType: 'qc',
    drillFilter: { review: 'pending' },
    owner: OWNER_NAMES.qc,
    suggestion: '抽检低置信度会话并回放评测错例，必要时补充规则词典。',
  },
  badcaseCloseRate: {
    drillType: 'badcase',
    drillFilter: { status: 'open' },
    owner: OWNER_NAMES.lead,
    suggestion: '优先清理超期未关闭 badcase，按归因类别分派责任人。',
  },
  p0ResponseMin: {
    drillType: 'sentiment',
    // 下钻展示全部 P0 预警：指标按"已首响的 P0"计算，若只筛 status=new，
    // 一旦 P0 都已确认就会下钻为空，反而看不到该指标的样本来源。
    drillFilter: { level: 'P0' },
    owner: OWNER_NAMES.brand,
    suggestion: '核对 P0 预警值守排班与升级链路，确保 30 分钟内首响。',
  },
  alertPrecision: {
    drillType: 'sentiment',
    drillFilter: { level: 'P1' },
    owner: OWNER_NAMES.lead,
    suggestion: '复核误报预警的聚簇与分级规则，调整主题词表与聚合阈值。',
  },
  clueCloseRate: {
    drillType: 'clue',
    drillFilter: { status: 'draft' },
    owner: OWNER_NAMES.product,
    suggestion: '推动草稿态线索尽快路由与验收，清理长期未关闭线索。',
  },
  csat: {
    drillType: 'sentiment',
    drillFilter: { sentiment: 'negative' },
    owner: OWNER_NAMES.brand,
    suggestion: '聚焦负面评论主题，联合客服与产研制定体验修复计划。',
  },
};

export function buildDashboardAnomalies(store: StoreData): DashboardAnomaly[] {
  return buildKpis(store)
    .filter((kpi) => kpi.status !== 'ok')
    .map((kpi) => {
      const drill = DRILL[kpi.id] ?? {
        drillType: 'qc' as const,
        drillFilter: {},
        owner: OWNER_NAMES.qc,
        suggestion: '请人工复核该指标异常原因。',
      };
      return {
        id: `ano-${kpi.id}`,
        metric: kpi.id,
        metricLabel: kpi.label,
        current: kpi.value,
        target: kpi.target,
        deviation: round(kpi.value - kpi.target, 3),
        severity: kpi.status === 'bad' ? ('bad' as const) : ('warn' as const),
        drillType: drill.drillType,
        drillFilter: drill.drillFilter,
        owner: drill.owner,
        suggestion: drill.suggestion,
      };
    });
}

/** 线索统计（列表/看板复用）。 */
export function clueClosedCount(store: StoreData): number {
  return store.clues.filter((clue) => clue.status === 'closed').length;
}

/** 质检标签权重（badcase 转写复用）。 */
export function tagWeight(code: string): number {
  return TAG_MAP[code as keyof typeof TAG_MAP]?.weight ?? 0;
}

/** 预警级别排序值（列表排序复用）。 */
export function alertLevelOrder(level: AlertLevel): number {
  return alertLevelRank(level);
}
