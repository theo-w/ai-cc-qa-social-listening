/**
 * 前端类型：与 specs/contracts/openapi.yaml（唯一事实来源）逐字段对齐。
 * 约定：所有时间字段为 ISO 8601 字符串；比率为 0–1 小数；分页列表为 { items, page, pageSize, total }。
 * 本文件禁止使用 any；未知输入在 api/client.ts 边界处收敛。
 */

/* ---------------------------------- 基础枚举 ---------------------------------- */

export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION_ERROR'
  | 'INTERNAL';

export type Range = '7d' | '14d' | '30d';
export type Channel = 'online' | 'ticket' | 'phone';
export type Verdict = 'pass' | 'violation';
export type ReviewStatus = 'pending' | 'done';
export type ReviewDecision = 'confirm' | 'overturn' | 'amend';
export type ReviewFilter = 'pending' | 'done' | 'none';
export type Severity = 'low' | 'medium' | 'high';
export type QcTagCode =
  | 'attitude'
  | 'forbidden'
  | 'off_topic'
  | 'wrong_knowledge'
  | 'timeout'
  | 'escalation';
export type Emotion = 'calm' | 'anxious' | 'angry';
export type MessageRole = 'customer' | 'agent' | 'system';
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
export type BadcaseActionRequestType = 'assign' | 'progress' | 'verify' | 'close' | 'reopen' | 'comment';
export type SentimentSource = 'steam' | 'taptap' | 'googleplay' | 'community' | 'ticket';
export type SentimentValue = 'positive' | 'neutral' | 'negative';
export type CommentSeverity = 'p0' | 'p1' | 'p2' | 'none';
export type AlertLevel = 'P0' | 'P1' | 'P2';
export type AlertStatus = 'new' | 'acknowledged' | 'responding' | 'escalated' | 'resolved';
export type AlertActionType =
  | 'created'
  | 'acknowledged'
  | 'responded'
  | 'escalated'
  | 'resolved'
  | 'commented';
export type AlertActionRequestType = 'acknowledge' | 'respond' | 'escalate' | 'resolve' | 'comment';
export type ClueSourceType = 'qc' | 'sentiment' | 'dashboard' | 'agent';
export type ClueTarget = 'product' | 'brand' | 'market' | 'cs';
export type CluePriority = 'high' | 'medium' | 'low';
export type ClueStatus = 'draft' | 'routed' | 'accepted' | 'rejected' | 'closed';
export type ClueActionType = 'created' | 'routed' | 'accepted' | 'rejected' | 'closed' | 'commented';
export type ClueActionRequestType = 'route' | 'accept' | 'reject' | 'close' | 'comment';
export type EvalDatasetKey = 'qc' | 'sentiment';
export type KpiUnit = 'percent' | 'min' | 'count' | 'score' | 'sec';
export type KpiOp = '>=' | '<=';
export type KpiStatus = 'ok' | 'warn' | 'bad';
export type DrillType = 'qc' | 'sentiment' | 'badcase' | 'clue';
export type AnomalySeverity = 'warn' | 'bad';
export type QcSort = 'score_asc' | 'score_desc' | 'time_desc' | 'time_asc';

/* ---------------------------------- 通用结构 ---------------------------------- */

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ErrorPayload {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: Record<string, unknown> | null;
  };
}

export interface Health {
  status: 'ok';
  version: string;
  uptimeSec: number;
}

export interface RoleOption {
  id: string;
  label: string;
}

export interface OwnerEntry {
  role: string;
  name: string;
}

export interface TagTaxonomyEntry {
  code: string;
  name: string;
  description?: string;
  severity?: Severity;
  weight?: number;
}

export interface SourceOption {
  id: string;
  label: string;
}

export interface ClueTargetOption {
  id: string;
  label: string;
}

export type StatusLabels = Record<string, Record<string, string>>;

export interface MetaDemo {
  datasetVersion?: string;
  resetAvailable?: boolean;
  itemCounts?: {
    qc?: number;
    sentiment?: number;
  };
}

export interface Meta {
  product: string;
  version: string;
  generatedAt: string;
  modelVersion: string;
  roles: RoleOption[];
  owners: OwnerEntry[];
  tagTaxonomy: TagTaxonomyEntry[];
  topics: string[];
  sources: SourceOption[];
  clueTargets: ClueTargetOption[];
  knowledgeCategories?: Array<{ id: string; label: string }>;
  knowledgeStatuses?: Array<{ id: string; label: string }>;
  knowledgeSources?: Array<{ id: string; label: string }>;
  knowledgeCompares?: Array<{ id: string; label: string }>;
  statusLabels: StatusLabels;
  demo: MetaDemo;
}

export interface ResetResult {
  ok: boolean;
  resetAt: string;
  seeded: {
    conversations?: number;
    qcResults?: number;
    comments?: number;
    badcases?: number;
    knowledgeEntries?: number;
    alerts?: number;
    clues?: number;
    metricSnapshots?: number;
  };
}

/* ---------------------------------- 质检 ---------------------------------- */

export interface Message {
  seq: number;
  role: MessageRole;
  text: string;
  atSec: number;
  gapSec?: number | null;
}

export interface Evidence {
  seq: number;
  quote: string;
  note?: string | null;
}

export interface QcTag {
  code: QcTagCode;
  name: string;
  severity: Severity;
  confidence: number;
  evidence: Evidence[];
  ruleId: string;
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

export interface ConversationParty {
  id: string;
  name: string;
}

export interface Conversation {
  id: string;
  channel: Channel;
  product: string;
  agent: ConversationParty;
  customer: ConversationParty;
  startedAt: string;
  durationSec: number;
  messages: Message[];
  importedAt: string;
  batchId: string;
}

export interface ReviewTask {
  id: string;
  qcResultId: string;
  conversationId: string;
  status: ReviewStatus;
  assignee: string;
  decision?: ReviewDecision | null;
  finalVerdict?: Verdict | null;
  finalTags: string[];
  note?: string;
  createdAt: string;
  reviewedAt?: string | null;
}

export interface ConversationTagSummary {
  code: string;
  name: string;
  severity: string;
}

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
  tags: ConversationTagSummary[];
}

export interface ConversationList extends Paged<ConversationListItem> {}

export interface ReviewRequest {
  decision: ReviewDecision;
  finalTags?: QcTagCode[];
  note?: string;
  reviewer?: string;
}

export interface ReviewResult {
  review: ReviewTask;
  qcResult: QcResult;
}

export interface BadcaseCreateRequest {
  category: BadcaseCategory;
  owner?: string;
  slaHours?: 24 | 48 | 72;
  title?: string;
  rootCause?: string;
}

export interface ConversationDetail {
  conversation: Conversation;
  qcResult: QcResult;
  review?: ReviewTask | null;
  badcase?: Badcase | null;
}

export interface QcStats {
  total: number;
  analyzed: number;
  pass: number;
  violation: number;
  needsReview: number;
  reviewed: number;
  avgScore: number;
  reviewRatio: number;
  tagDistribution: Array<{ code?: string; name?: string; count?: number }>;
  channelDistribution: Array<{ channel?: string; count?: number }>;
}

/* ---------------------------------- 知识库（009） ---------------------------------- */

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
}

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
  byCategory: Array<{ category: string; count: number }>;
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

export interface KnowledgeGap {
  id: string;
  type: 'unlinked_qc_hit' | 'unlinked_badcase';
  ruleId: string | null;
  badcaseId: string | null;
  title: string;
  count: number;
  category: KnowledgeCategory;
  owner: string;
  sample: {
    conversationId: string;
    seq: number;
    quote: string;
    note: string;
  };
}

export interface KnowledgeMutationResult {
  entry: KnowledgeEntry;
  recheck: KnowledgeRecheck;
}

export interface KnowledgeListQuery extends PageQuery {
  status?: KnowledgeStatus;
  category?: KnowledgeCategory;
  source?: KnowledgeSource;
  badcaseId?: string;
  [key: string]: unknown;
}

export interface KnowledgeFactInput {
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

export interface KnowledgeCreateRequest {
  title: string;
  category: KnowledgeCategory;
  content: string;
  facts?: KnowledgeFactInput[];
  keywords?: string[];
  owner?: string;
  source?: KnowledgeSource;
  sourceRef?: KnowledgeSourceRef | null;
  linkedBadcaseIds?: string[];
}

export interface KnowledgeRevisionRequest {
  title?: string;
  category?: KnowledgeCategory;
  content: string;
  facts?: KnowledgeFactInput[];
  keywords?: string[];
  note?: string;
  by?: string;
}

export interface KnowledgeSuggestionRequest {
  conversationId?: string;
  badcaseId?: string;
}

/* ---------------------------------- badcase ---------------------------------- */

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
  recurrenceOf?: string | null;
  evidence: Evidence[];
  closedAt?: string | null;
  proof?: string | null;
  timeline: BadcaseAction[];
  createdAt: string;
  updatedAt: string;
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

export interface BadcaseList extends Paged<BadcaseListItem> {}

export interface BadcaseStats {
  total: number;
  open: number;
  inProgress: number;
  pendingVerify: number;
  closed: number;
  overdue: number;
  closeRate: number;
  recurrenceRate: number;
  byCategory: Array<{ category?: string; count?: number }>;
  byOwner: Array<{ owner?: string; count?: number }>;
}

export interface BadcaseActionRequest {
  type: BadcaseActionRequestType;
  owner?: string;
  note?: string;
  proof?: string;
  by?: string;
}

/* ---------------------------------- 舆情 ---------------------------------- */

export interface SentimentComment {
  id: string;
  source: SentimentSource;
  brand: string;
  author: string;
  text: string;
  publishedAt: string;
  sentiment: SentimentValue;
  sentimentScore: number;
  topics: string[];
  primaryTopic: string;
  severity: CommentSeverity;
  confidence: number;
  needsReview: boolean;
  alertId?: string | null;
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

export interface TriggerRule {
  ruleId?: string;
  description?: string;
}

export interface SentimentAlert {
  id: string;
  level: AlertLevel;
  topic: string;
  title: string;
  summary: string;
  windowStart: string;
  windowEnd: string;
  triggerRules: TriggerRule[];
  commentIds: string[];
  status: AlertStatus;
  owner: string;
  slaMinutes: number;
  slaDueAt: string;
  firstResponseAt?: string | null;
  resolvedAt?: string | null;
  timeline: AlertAction[];
  linkedClueIds: string[];
  createdAt: string;
}

export interface AlertListItem {
  id: string;
  level: AlertLevel;
  topic: string;
  title: string;
  status: AlertStatus;
  owner: string;
  createdAt: string;
  firstResponseAt?: string | null;
  slaDueAt: string;
  overdue: boolean;
  commentCount: number;
}

export interface AlertDetail {
  alert: SentimentAlert;
  comments: SentimentComment[];
  linkedClues: Clue[];
}

export interface AlertActionRequest {
  type: AlertActionRequestType;
  note?: string;
  by?: string;
}

export interface CommentList extends Paged<SentimentComment> {}

export interface AlertList extends Paged<AlertListItem> {}

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
  avgFirstResponseMin?: number | null;
  p0ResponseMin?: number | null;
  p1ResponseMin?: number | null;
  topicDistribution: Array<{ topic?: string; count?: number }>;
  sourceDistribution: Array<{ source?: string; count?: number }>;
  sentimentDistribution: Array<{ sentiment?: string; count?: number }>;
}

/* ---------------------------------- 线索 ---------------------------------- */

export interface ClueAction {
  at: string;
  by: string;
  type: ClueActionType;
  note?: string | null;
  from?: string | null;
  to?: string | null;
}

export interface ClueSourceRef {
  type?: string;
  id?: string;
  label?: string;
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
  outcome?: string | null;
  timeline: ClueAction[];
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
}

export interface ClueList extends Paged<Clue> {}

export interface ClueCreateRequest {
  title: string;
  description: string;
  sourceType: ClueSourceType;
  sourceRef: ClueSourceRef;
  target: ClueTarget;
  priority: CluePriority;
  evidence?: string[];
  createdBy?: string;
}

export interface ClueActionRequest {
  type: ClueActionRequestType;
  owner?: string;
  note?: string;
  outcome?: string;
  by?: string;
}

/* ---------------------------------- 评测 ---------------------------------- */

export interface EvalMismatch {
  itemId: string;
  expected: string;
  predicted: string;
  reason: string;
}

export interface EvalRun {
  id: string;
  dataset: EvalDatasetKey;
  datasetId: string;
  datasetVersion: string;
  runAt: string;
  durationMs: number;
  modelVersion: string;
  metrics: Record<string, number>;
  confusion: Record<string, number>;
  mismatches: EvalMismatch[];
  thresholdsMet: Record<string, boolean>;
  summary: string;
}

export interface EvalRunSummary {
  id: string;
  dataset: EvalDatasetKey;
  datasetId: string;
  datasetVersion: string;
  runAt: string;
  durationMs: number;
  modelVersion: string;
  metrics: Record<string, number>;
  thresholdsMet: Record<string, boolean>;
  summary: string;
}

export interface EvalDataset {
  dataset: EvalDatasetKey;
  datasetId: string;
  version: string;
  itemCount: number;
  description: string;
  lastRunAt?: string | null;
}

export interface EvalRunRequest {
  dataset: EvalDatasetKey;
}

/* ---------------------------------- 看板 ---------------------------------- */

export interface DashboardKpi {
  id: string;
  label: string;
  value: number;
  target: number;
  op: KpiOp;
  status: KpiStatus;
  delta: number;
  unit: KpiUnit;
  hint?: string | null;
}

export interface DashboardVolume {
  conversations?: number;
  reviewPending?: number;
  badcasesOpen?: number;
  alertsOpen?: number;
  cluesOpen?: number;
}

export interface DashboardQuality {
  avgScore?: number;
  violationRate?: number;
}

export interface DashboardDistribution {
  tags?: Array<{ code?: string; name?: string; count?: number }>;
  channels?: Array<{ channel?: string; count?: number }>;
  alertLevels?: Array<{ level?: string; count?: number }>;
  clueTargets?: Array<{ target?: string; count?: number }>;
}

export interface DashboardSummary {
  range: string;
  generatedAt: string;
  kpis: DashboardKpi[];
  volume?: DashboardVolume;
  quality?: DashboardQuality;
  distribution?: DashboardDistribution;
}

export interface TrendRow {
  date: string;
  qcCoverage?: number | null;
  qcAccuracy?: number | null;
  badcaseCloseRate?: number | null;
  p0ResponseMin?: number | null;
  alertPrecision?: number | null;
  clueCloseRate?: number | null;
  csat?: number | null;
  [key: string]: string | number | null | undefined;
}

export interface TrendsResponse {
  range: string;
  rows: TrendRow[];
}

export interface DashboardAnomaly {
  id: string;
  metric: string;
  metricLabel: string;
  current: number;
  target: number;
  deviation: number;
  severity: AnomalySeverity;
  drillType: DrillType;
  drillFilter: Record<string, string>;
  owner: string;
  suggestion: string;
}

export interface AnomalyResponse {
  items: DashboardAnomaly[];
}

/* ---------------------------------- 列表查询参数 ---------------------------------- */

export interface PageQuery {
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface QcListQuery extends PageQuery {
  verdict?: Verdict;
  tag?: QcTagCode;
  review?: ReviewFilter;
  channel?: Channel;
  sort?: QcSort;
  [key: string]: unknown;
}

export interface BadcaseListQuery extends PageQuery {
  status?: BadcaseStatus;
  category?: BadcaseCategory;
  owner?: string;
  [key: string]: unknown;
}

export interface CommentListQuery extends PageQuery {
  source?: SentimentSource;
  sentiment?: SentimentValue;
  topic?: string;
  severity?: CommentSeverity;
  [key: string]: unknown;
}

export interface AlertListQuery extends PageQuery {
  level?: AlertLevel;
  status?: AlertStatus;
  [key: string]: unknown;
}

export interface ClueListQuery extends PageQuery {
  status?: ClueStatus;
  target?: ClueTarget;
  sourceType?: ClueSourceType;
  [key: string]: unknown;
}
