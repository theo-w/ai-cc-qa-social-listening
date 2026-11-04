/**
 * 类型定义：运行态实体、原始数据集、评测与看板结构。
 *
 * 运行态实体字段与 specs/contracts/openapi.yaml 严格对齐；
 * 原始数据集结构对齐 specs/004-data-model.md §7（金标主口径见 §7.5）。
 */

/* ------------------------------ 基础枚举 ------------------------------ */

export type Channel = 'online' | 'ticket' | 'phone';
export type MessageRole = 'customer' | 'agent' | 'system';
export type Verdict = 'pass' | 'violation';
export type TagCode = 'attitude' | 'forbidden' | 'off_topic' | 'wrong_knowledge' | 'timeout' | 'escalation';
export type Severity = 'low' | 'medium' | 'high';
export type Emotion = 'calm' | 'anxious' | 'angry';

export type BadcaseCategory = 'knowledge' | 'script' | 'process' | 'system';
export type BadcaseStatus = 'open' | 'in_progress' | 'pending_verify' | 'closed';
export type BadcaseActionType =
  | 'created'
  | 'assigned'
  | 'progressed'
  | 'verified'
  | 'closed'
  | 'reopened'
  | 'commented';

export type CommentSource = 'steam' | 'taptap' | 'googleplay' | 'community' | 'ticket';
export type Sentiment = 'positive' | 'neutral' | 'negative';
export type SingleSeverity = 'p0' | 'p1' | 'p2' | 'none';
export type AlertLevel = 'P0' | 'P1' | 'P2';
export type AlertStatus = 'new' | 'acknowledged' | 'responding' | 'escalated' | 'resolved';
export type AlertActionType = 'created' | 'acknowledged' | 'responded' | 'escalated' | 'resolved' | 'commented';

export type ClueSourceType = 'qc' | 'sentiment' | 'dashboard' | 'agent';
export type ClueTarget = 'product' | 'brand' | 'market' | 'cs';
export type CluePriority = 'high' | 'medium' | 'low';
export type ClueStatus = 'draft' | 'routed' | 'accepted' | 'rejected' | 'closed';
export type ClueActionType = 'created' | 'routed' | 'accepted' | 'rejected' | 'closed' | 'commented';

export type RangeKey = '7d' | '14d' | '30d';

/* ------------------------------ 运行态实体 ------------------------------ */

export interface Evidence {
  seq: number;
  quote: string;
  note?: string | null;
}

export interface ConversationMessage {
  seq: number;
  role: MessageRole;
  text: string;
  atSec: number;
  /** 相对上一条消息的间隔（派生字段，详情接口返回）。 */
  gapSec?: number | null;
}

export interface Conversation {
  id: string;
  channel: Channel;
  product: string;
  agent: { id: string; name: string };
  customer: { id: string; name: string };
  startedAt: string;
  durationSec: number;
  messages: ConversationMessage[];
  importedAt: string;
  batchId: string;
}

export interface QcTag {
  code: TagCode;
  name: string;
  severity: Severity;
  confidence: number;
  evidence: Evidence[];
  ruleId: string;
  /** 知识错误时引用的知识条目、事实与标准值（009）；未覆盖时为 null。 */
  knowledge?: KnowledgeRef | null;
}

export interface QcResult {
  id: string;
  conversationId: string;
  score: number;
  verdict: Verdict;
  tags: QcTag[];
  summary: string;
  emotion: Emotion;
  confidence: number;
  needsReview: boolean;
  modelVersion: string;
  analyzedAt: string;
  latestReviewId?: string | null;
}

export type ReviewDecision = 'confirm' | 'overturn' | 'amend';
export type ReviewStatus = 'pending' | 'done';

export interface ReviewTask {
  id: string;
  qcResultId: string;
  conversationId: string;
  status: ReviewStatus;
  assignee: string;
  decision: ReviewDecision | null;
  finalVerdict: Verdict | null;
  finalTags: string[];
  note: string;
  createdAt: string;
  reviewedAt: string | null;
}

export interface BadcaseAction {
  at: string;
  by: string;
  type: BadcaseActionType;
  note?: string | null;
  from?: string | null;
  to?: string | null;
}

export interface Badcase {
  id: string;
  code: string;
  conversationId: string;
  qcResultId: string;
  title: string;
  category: BadcaseCategory;
  rootCause: string;
  owner: string;
  creator: string;
  severity: Severity;
  slaHours: number;
  dueAt: string;
  status: BadcaseStatus;
  recurrence: boolean;
  recurrenceOf: string | null;
  evidence: Evidence[];
  closedAt: string | null;
  proof: string | null;
  timeline: BadcaseAction[];
  createdAt: string;
  updatedAt: string;
}

export interface SentimentComment {
  id: string;
  source: CommentSource;
  brand: string;
  author: string;
  text: string;
  publishedAt: string;
  sentiment: Sentiment;
  sentimentScore: number;
  topics: string[];
  primaryTopic: string;
  severity: SingleSeverity;
  confidence: number;
  needsReview: boolean;
  alertId: string | null;
  engineRules: string[];
}

export interface AlertAction {
  at: string;
  by: string;
  type: AlertActionType;
  note?: string | null;
  from?: string | null;
  to?: string | null;
}

export interface AlertTriggerRule {
  ruleId: string;
  description: string;
}

export interface SentimentAlert {
  id: string;
  level: AlertLevel;
  topic: string;
  title: string;
  summary: string;
  windowStart: string;
  windowEnd: string;
  triggerRules: AlertTriggerRule[];
  commentIds: string[];
  status: AlertStatus;
  owner: string;
  slaMinutes: number;
  slaDueAt: string;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  timeline: AlertAction[];
  linkedClueIds: string[];
  createdAt: string;
}

export interface ClueAction {
  at: string;
  by: string;
  type: ClueActionType;
  note?: string | null;
  from?: string | null;
  to?: string | null;
}

export interface ClueSourceRef {
  type: string;
  id: string;
  label: string;
}

export interface Clue {
  id: string;
  title: string;
  description: string;
  sourceType: ClueSourceType;
  sourceRef: ClueSourceRef;
  target: ClueTarget;
  priority: CluePriority;
  status: ClueStatus;
  owner: string;
  createdBy: string;
  evidence: string[];
  outcome: string | null;
  timeline: ClueAction[];
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

/* ------------------------------ 知识库（009） ------------------------------ */

export type KnowledgeCategory = 'refund' | 'recharge' | 'activity' | 'version' | 'account' | 'other';
export type KnowledgeStatus = 'draft' | 'published' | 'offline';
export type KnowledgeSource = 'official' | 'qc_badcase' | 'manual';
export type KnowledgeFactCompare = 'number' | 'duration_minutes' | 'date' | 'text';

export interface KnowledgeFact {
  key: string;
  label: string;
  expected: string;
  compare: KnowledgeFactCompare;
  expectedNumber?: number | null;
  expectedMinutes?: number | null;
  expectedMonth?: number | null;
  expectedDay?: number | null;
  unit?: string | null;
  claimPatterns: string[];
  violationPatterns: string[];
  note?: string | null;
}

export interface KnowledgeRevision {
  version: number;
  status: KnowledgeStatus;
  content: string;
  facts: KnowledgeFact[];
  note: string;
  by: string;
  at: string;
}

export interface KnowledgeSourceRef {
  type: 'conversation' | 'badcase' | 'manual';
  id: string;
  label: string;
}

export interface KnowledgeEntry {
  id: string;
  code: string;
  title: string;
  category: KnowledgeCategory;
  status: KnowledgeStatus;
  version: number;
  content: string;
  facts: KnowledgeFact[];
  keywords: string[];
  owner: string;
  source: KnowledgeSource;
  sourceRef: KnowledgeSourceRef | null;
  linkedBadcaseIds: string[];
  revisions: KnowledgeRevision[];
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  /** 种子稳定键（仅种子条目携带，便于复现）。 */
  seedKey?: string;
}

/** 挂在 QcTag 上的知识依据。 */
export interface KnowledgeRef {
  entryId: string;
  code: string;
  title: string;
  factKey: string;
  factLabel: string;
  expected: string;
  actual: string;
  ruleId: string;
}

export interface KnowledgeListItem {
  id: string;
  code: string;
  title: string;
  category: KnowledgeCategory;
  status: KnowledgeStatus;
  version: number;
  owner: string;
  source: KnowledgeSource;
  knowledgeHits: number;
  linkedHits: number;
  linkedBadcases: number;
  updatedAt: string;
}

export interface KnowledgeHit {
  conversationId: string;
  agentName: string;
  seq: number;
  quote: string;
  expected: string;
  actual: string;
}

export interface KnowledgeDetail {
  entry: KnowledgeEntry;
  hits: KnowledgeHit[];
  badcases: Badcase[];
}

export interface KnowledgeRecheckStats {
  knowledgeTags: number;
  linkedKnowledgeTags: number;
  unlinkedKnowledgeTags: number;
  gaps: number;
}

export interface KnowledgeChange {
  conversationId: string;
  beforeTags: string[];
  afterTags: string[];
}

export interface KnowledgeRecheck {
  rechecked: number;
  changed: number;
  before: KnowledgeRecheckStats;
  after: KnowledgeRecheckStats;
  changes: KnowledgeChange[];
}

export interface KnowledgeStats {
  total: number;
  published: number;
  draft: number;
  offline: number;
  byCategory: { category: string; count: number }[];
  hits: {
    knowledgeTags: number;
    linked: number;
    unlinked: number;
    conversations: number;
    linkRate: number;
  };
  gaps: number;
  knowledgeBadcases: number;
  linkedKnowledgeBadcases: number;
}

export interface KnowledgeGapSample {
  conversationId: string;
  seq: number;
  quote: string;
  note: string;
}

export interface KnowledgeGap {
  id: string;
  type: 'unlinked_qc_hit' | 'unlinked_badcase';
  ruleId: string | null;
  badcaseId: string | null;
  title: string;
  count: number;
  category: KnowledgeCategory;
  owner: string;
  sample: KnowledgeGapSample;
}

export interface KnowledgeMutationResult {
  entry: KnowledgeEntry;
  recheck: KnowledgeRecheck;
}

export interface EvalMismatch {
  itemId: string;
  expected: string;
  predicted: string;
  reason: string;
}

export interface EvalRun {
  id: string;
  dataset: 'qc' | 'sentiment';
  datasetId: string;
  datasetVersion: string;
  runAt: string;
  durationMs: number;
  modelVersion: string;
  metrics: Record<string, number | Record<string, number>>;
  confusion: Record<string, number>;
  mismatches: EvalMismatch[];
  thresholdsMet: Record<string, boolean>;
  summary: string;
}

export interface EvalRunSummary {
  id: string;
  dataset: 'qc' | 'sentiment';
  datasetId: string;
  datasetVersion: string;
  runAt: string;
  durationMs: number;
  modelVersion: string;
  metrics: Record<string, number | Record<string, number>>;
  thresholdsMet: Record<string, boolean>;
  summary: string;
}

export interface EvalDataset {
  dataset: 'qc' | 'sentiment';
  datasetId: string;
  version: string;
  itemCount: number;
  description: string;
  lastRunAt: string | null;
}

export interface MetricSnapshot {
  date: string;
  qcCoverage: number;
  qcAccuracy: number;
  qcReviewRatio: number;
  badcaseCloseRate: number;
  recurrenceRate: number;
  p0ResponseMin: number;
  p1ResponseMin: number;
  alertPrecision: number;
  sentimentAccuracy: number;
  clueCloseRate: number;
  clueConversion: number;
  csat: number;
  firstResponseSec: number;
  transferRate: number;
}

/** 运行态存储（单文件 JSON）。 */
export interface StoreData {
  schemaVersion: number;
  datasetVersion: string;
  seededAt: string;
  conversations: Conversation[];
  qcResults: QcResult[];
  reviewTasks: ReviewTask[];
  badcases: Badcase[];
  knowledgeEntries: KnowledgeEntry[];
  comments: SentimentComment[];
  alerts: SentimentAlert[];
  clues: Clue[];
  evalRuns: EvalRun[];
  metricSnapshots: MetricSnapshot[];
}

/* ------------------------------ 原始数据集 ------------------------------ */

export interface DatasetMessage {
  seq: number;
  role: MessageRole;
  text: string;
  atSec: number;
}

export interface QcGoldLabels {
  verdict: Verdict;
  tags: string[];
  primaryTag: string | null;
  note: string;
  /** 可选扩展字段（不依赖）。 */
  tagEvidence?: { code: string; evidenceSeq: number; quote: string }[];
  confidence?: number;
  needsReview?: boolean;
  summary?: string;
  emotion?: Emotion;
  complexity?: 'explicit' | 'implicit';
}

export interface QcDatasetItem {
  id: string;
  channel: Channel;
  product: string;
  agent: { id: string; name: string };
  customer: { id: string; name: string };
  startedAt: string;
  durationSec: number;
  messages: DatasetMessage[];
  labels: QcGoldLabels;
}

export interface QcDataset {
  datasetId: string;
  version: string;
  description: string;
  items: QcDatasetItem[];
}

/* ------------------------------ 知识库种子数据 ------------------------------ */

export interface KnowledgeSeedRevision {
  version: number;
  status: KnowledgeStatus;
  content: string;
  facts: KnowledgeFact[];
  note: string;
  by: string;
  at: string;
}

export interface KnowledgeSeedEntry {
  key: string;
  code: string;
  title: string;
  category: KnowledgeCategory;
  keywords: string[];
  owner: string;
  source: KnowledgeSource;
  sourceRef: KnowledgeSourceRef | null;
  linkedBadcaseIds: string[];
  revisions: KnowledgeSeedRevision[];
}

export interface KnowledgeDataset {
  datasetId: string;
  version: string;
  datasetVersion?: string;
  description: string;
  generatedAt?: string;
  entries: KnowledgeSeedEntry[];
}

export interface SentimentGoldLabels {
  sentiment: Sentiment;
  topics: string[];
  primaryTopic: string;
  expectedLevel: 'P0' | 'P1' | 'P2' | 'none';
  noise: boolean;
  note: string;
  /** 可选扩展字段（不依赖）。 */
  severity?: string;
  confidence?: number;
  needsReview?: boolean;
  sentimentScore?: number;
}

export interface SentimentDatasetItem {
  id: string;
  source: CommentSource;
  brand: string;
  author: string;
  publishedAt: string;
  text: string;
  language?: string;
  labels: SentimentGoldLabels;
}

export interface SentimentDataset {
  datasetId: string;
  version: string;
  description: string;
  items: SentimentDatasetItem[];
}

export interface ManifestDatasetEntry {
  datasetId: string;
  version: string;
  /** 相对 data/ 的文件路径（也兼容 `file` 为绝对/带 data 前缀）。 */
  file: string;
  itemCount: number;
  description?: string;
}

export interface Manifest {
  version: string;
  datasetVersion?: string;
  generatedAt?: string;
  description?: string;
  datasets: {
    qc: ManifestDatasetEntry;
    sentiment: ManifestDatasetEntry;
  };
}

/* ------------------------------ 引擎输出 ------------------------------ */

export interface QcAnalysis {
  score: number;
  verdict: Verdict;
  tags: QcTag[];
  summary: string;
  emotion: Emotion;
  confidence: number;
  needsReview: boolean;
}

export interface SentimentAnalysis {
  sentiment: Sentiment;
  sentimentScore: number;
  topics: string[];
  primaryTopic: string;
  severity: SingleSeverity;
  confidence: number;
  needsReview: boolean;
  engineRules: string[];
}

export interface SentimentClusterDraft {
  topic: string;
  date: string;
  level: AlertLevel;
  maxSingleLevel: AlertLevel | null;
  negativeCount: number;
  totalCount: number;
  commentIds: string[];
  triggerRules: AlertTriggerRule[];
  sourceCounts: Partial<Record<CommentSource, number>>;
  signalWords: string[];
}

/* ------------------------------ 统计/看板输出 ------------------------------ */

export interface QcStats {
  total: number;
  analyzed: number;
  pass: number;
  violation: number;
  needsReview: number;
  reviewed: number;
  avgScore: number;
  reviewRatio: number;
  tagDistribution: { code: string; name: string; count: number }[];
  channelDistribution: { channel: string; count: number }[];
}

export interface BadcaseStats {
  total: number;
  open: number;
  inProgress: number;
  pendingVerify: number;
  closed: number;
  overdue: number;
  closeRate: number;
  recurrenceRate: number;
  byCategory: { category: string; count: number }[];
  byOwner: { owner: string; count: number }[];
}

export interface SentimentStats {
  comments: number;
  analyzed: number;
  negativeRatio: number;
  needsReview: number;
  alertsTotal: number;
  alertsOpen: number;
  p0: number;
  p1: number;
  p2: number;
  avgFirstResponseMin: number | null;
  p0ResponseMin: number | null;
  p1ResponseMin: number | null;
  topicDistribution: { topic: string; count: number }[];
  sourceDistribution: { source: string; count: number }[];
  sentimentDistribution: { sentiment: string; count: number }[];
}

export interface DashboardKpi {
  id: string;
  label: string;
  value: number;
  target: number;
  op: '>=' | '<=';
  status: 'ok' | 'warn' | 'bad';
  delta: number;
  unit: 'percent' | 'min' | 'count' | 'score' | 'sec';
  hint?: string | null;
}

export interface DashboardAnomaly {
  id: string;
  metric: string;
  metricLabel: string;
  current: number;
  target: number;
  deviation: number;
  severity: 'warn' | 'bad';
  drillType: 'qc' | 'sentiment' | 'badcase' | 'clue';
  drillFilter: Record<string, string>;
  owner: string;
  suggestion: string;
}

export interface TrendRow {
  date: string;
  qcCoverage: number | null;
  qcAccuracy: number | null;
  badcaseCloseRate: number | null;
  p0ResponseMin: number | null;
  alertPrecision: number | null;
  clueCloseRate: number | null;
  csat: number | null;
}

export interface DashboardSummary {
  range: RangeKey;
  generatedAt: string;
  kpis: DashboardKpi[];
  volume: {
    conversations: number;
    reviewPending: number;
    badcasesOpen: number;
    alertsOpen: number;
    cluesOpen: number;
  };
  quality: { avgScore: number; violationRate: number };
  distribution: {
    tags: { code: string; name: string; count: number }[];
    channels: { channel: string; count: number }[];
    alertLevels: { level: string; count: number }[];
    clueTargets: { target: string; count: number }[];
  };
}

/* ------------------------------ 列表输出 ------------------------------ */

export interface ConversationListItem {
  id: string;
  channel: Channel;
  product: string;
  agentName: string;
  customerName: string;
  startedAt: string;
  durationSec: number;
  messageCount: number;
  score: number;
  verdict: Verdict;
  needsReview: boolean;
  emotion: Emotion;
  summary: string;
  tags: { code: string; name: string; severity: string }[];
  /** 扩展字段（FR-QC-002 要求复核列表返回置信度与推荐理由）。 */
  confidence: number;
  recommendedReason: string | null;
}

export interface BadcaseListItem {
  id: string;
  code: string;
  title: string;
  category: BadcaseCategory;
  owner: string;
  status: BadcaseStatus;
  severity: Severity;
  dueAt: string;
  overdue: boolean;
  recurrence: boolean;
  conversationId: string;
  agentName: string;
  createdAt: string;
  updatedAt: string;
}

export interface AlertListItem {
  id: string;
  level: AlertLevel;
  topic: string;
  title: string;
  status: AlertStatus;
  owner: string;
  createdAt: string;
  firstResponseAt: string | null;
  slaDueAt: string;
  overdue: boolean;
  commentCount: number;
}

/* ------------------------------ 请求体 ------------------------------ */

export interface ReviewRequestBody {
  decision: ReviewDecision;
  finalTags?: string[];
  note?: string;
  reviewer?: string;
}

export interface BadcaseCreateBody {
  category: BadcaseCategory;
  owner?: string;
  slaHours?: 24 | 48 | 72;
  title?: string;
  rootCause?: string;
}

export interface BadcaseActionBody {
  type: 'assign' | 'progress' | 'verify' | 'close' | 'reopen' | 'comment';
  owner?: string;
  note?: string;
  proof?: string;
  by?: string;
}

export interface AlertActionBody {
  type: 'acknowledge' | 'respond' | 'escalate' | 'resolve' | 'comment';
  note?: string;
  by?: string;
}

export interface ClueCreateBody {
  title: string;
  description: string;
  sourceType: ClueSourceType;
  sourceRef: ClueSourceRef;
  target: ClueTarget;
  priority: CluePriority;
  evidence?: string[];
  createdBy?: string;
}

export interface ClueActionBody {
  type: 'route' | 'accept' | 'reject' | 'close' | 'comment';
  owner?: string;
  note?: string;
  outcome?: string;
  by?: string;
}

export interface EvalRunBody {
  dataset: 'qc' | 'sentiment';
}

/* ------------------------------ 列表分页 ------------------------------ */

export interface PageQuery {
  page: number;
  pageSize: number;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
