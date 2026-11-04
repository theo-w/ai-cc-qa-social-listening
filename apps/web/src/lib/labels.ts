/**
 * 中文文案与枚举字典。
 * 规则：静态字典只作为「后端未返回/加载中」的兜底；运行时可从 Meta（tagTaxonomy / topics /
 * sources / clueTargets / statusLabels / owners）读取的展示项优先使用 Meta，避免前后端枚举漂移。
 */
import { useMemo } from 'react';
import { useAppData } from '../hooks/useAppData';
import type { Meta, TagTaxonomyEntry } from '../types';

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'muted' | 'primary' | 'neutral';

export type LabelDict = Record<string, string>;

export interface SelectOption {
  value: string;
  label: string;
}

/* ------------------------------ 静态兜底字典 ------------------------------ */

export const CHANNEL_LABELS: LabelDict = {
  online: '在线',
  ticket: '工单',
  phone: '电话转写',
};

export const VERDICT_LABELS: LabelDict = {
  pass: '通过',
  violation: '违规',
};

export const REVIEW_STATUS_LABELS: LabelDict = {
  pending: '待复核',
  done: '已复核',
};

export const REVIEW_DECISION_LABELS: LabelDict = {
  confirm: '确认判定',
  overturn: '推翻判定',
  amend: '修正标签',
};

export const REVIEW_FILTER_LABELS: LabelDict = {
  pending: '仅看待复核',
  done: '已复核',
  none: '无需复核',
};

export const EMOTION_LABELS: LabelDict = {
  calm: '平静',
  anxious: '焦虑',
  angry: '愤怒',
};

export const SEVERITY_LABELS: LabelDict = {
  low: '低',
  medium: '中',
  high: '高',
};

export const QC_TAG_LABELS: LabelDict = {
  attitude: '服务态度',
  forbidden: '违规话术',
  off_topic: '答非所问',
  wrong_knowledge: '知识错误',
  timeout: '响应超时',
  escalation: '情绪升级',
};

export const BADCASE_CATEGORY_LABELS: LabelDict = {
  knowledge: '知识缺失',
  script: '话术问题',
  process: '流程问题',
  system: '系统问题',
};

export const BADCASE_CATEGORY_DESCRIPTIONS: LabelDict = {
  knowledge: '知识库新增或修订条目，标注复测',
  script: '话术模板更新并安排培训',
  process: '流程 / SOP 修订',
  system: '产品缺陷或工具问题转产研',
};

export const BADCASE_STATUS_LABELS: LabelDict = {
  open: '待处理',
  in_progress: '处理中',
  pending_verify: '待验证',
  closed: '已闭环',
};

export const KNOWLEDGE_CATEGORY_LABELS: LabelDict = {
  refund: '退款',
  recharge: '充值',
  activity: '活动',
  version: '版本',
  account: '账号',
  other: '其他',
};

export const KNOWLEDGE_STATUS_LABELS: LabelDict = {
  draft: '草稿',
  published: '已发布',
  offline: '已下线',
};

export const KNOWLEDGE_SOURCE_LABELS: LabelDict = {
  official: '官方口径',
  qc_badcase: '质检驱动',
  manual: '人工新增',
};

export const KNOWLEDGE_COMPARE_LABELS: LabelDict = {
  number: '数值比对',
  duration_minutes: '时效比对',
  date: '日期比对',
  text: '固定口径',
};

export const BADCASE_ACTION_LABELS: LabelDict = {  created: '创建',
  assigned: '分派',
  progressed: '更新进展',
  verified: '提交验证',
  closed: '闭环',
  reopened: '重开',
  commented: '评论',
};

export const BADCASE_BUTTON_LABELS: LabelDict = {
  assign: '分派责任人',
  progress: '提交进展',
  verify: '提交验证',
  close: '验证通过并关闭',
  reopen: '重新打开',
  comment: '添加评论',
};

export const ALERT_LEVEL_LABELS: LabelDict = {
  P0: 'P0',
  P1: 'P1',
  P2: 'P2',
};

export const ALERT_STATUS_LABELS: LabelDict = {
  new: '待确认',
  acknowledged: '已确认',
  responding: '处理中',
  escalated: '已升级',
  resolved: '已解决',
};

export const ALERT_ACTION_LABELS: LabelDict = {
  created: '生成预警',
  acknowledged: '确认收到',
  responded: '开始响应',
  escalated: '升级',
  resolved: '解决',
  commented: '评论',
};

export const ALERT_BUTTON_LABELS: LabelDict = {
  acknowledge: '确认收到',
  respond: '开始响应',
  escalate: '升级',
  resolve: '标记解决',
  comment: '添加评论',
};

export const SENTIMENT_LABELS: LabelDict = {
  positive: '正面',
  neutral: '中性',
  negative: '负面',
};

export const COMMENT_SEVERITY_LABELS: LabelDict = {
  p0: 'P0',
  p1: 'P1',
  p2: 'P2',
  none: '无',
};

export const SOURCE_LABELS: LabelDict = {
  steam: 'Steam',
  taptap: 'TapTap',
  googleplay: 'Google Play',
  community: '社区',
  ticket: '工单',
};

export const DEFAULT_TOPICS = ['版本', '充值', '外挂', '客服', '活动', 'Bug', '其他'];

export const CLUE_STATUS_LABELS: LabelDict = {
  draft: '草稿',
  routed: '已分派',
  accepted: '已接受',
  rejected: '已拒绝',
  closed: '已关闭',
};

export const CLUE_TARGET_LABELS: LabelDict = {
  product: '产研',
  brand: '品牌',
  market: '市场',
  cs: '客服',
};

export const CLUE_SOURCE_LABELS: LabelDict = {
  qc: '质检',
  sentiment: '舆情',
  dashboard: '看板',
  agent: '人工录入',
};

export const PRIORITY_LABELS: LabelDict = {
  high: '高',
  medium: '中',
  low: '低',
};

export const CLUE_ACTION_LABELS: LabelDict = {
  created: '创建',
  routed: '分派',
  accepted: '接受',
  rejected: '拒绝',
  closed: '关闭',
  commented: '评论',
};

export const CLUE_BUTTON_LABELS: LabelDict = {
  route: '提交分派',
  accept: '接受线索',
  reject: '拒绝线索',
  close: '关闭线索',
  comment: '添加评论',
};

export const ROLE_LABELS: LabelDict = {
  qc: '质检/培训',
  lead: '客服主管',
  agent: '坐席',
  brand: '品牌/市场',
  product: '产研',
  algo: '算法/研发',
};

export const TAG_WEIGHTS: Record<string, number> = {
  attitude: 25,
  forbidden: 30,
  off_topic: 15,
  wrong_knowledge: 25,
  timeout: 10,
  escalation: 20,
};

export const CATEGORY_OWNER: LabelDict = {
  knowledge: '顾清',
  script: '唐沐',
  process: '陆川',
  system: '周野',
};

export const TARGET_OWNER: LabelDict = {
  product: '周野',
  brand: '江岚',
  market: '程雨',
  cs: '陆川',
};

export const TOPIC_OWNER: LabelDict = {
  外挂: '江岚',
  充值: '江岚',
  版本: '周野',
  Bug: '周野',
  客服: '陆川',
  活动: '陆川',
  其他: '陆川',
};

export const CATEGORY_DEFAULT_SLA: Record<string, number> = {
  knowledge: 48,
  script: 48,
  process: 24,
  system: 72,
};

export const SLA_HOURS: Array<24 | 48 | 72> = [24, 48, 72];

const FALLBACK_OWNERS: Array<{ role: string; name: string }> = [
  { role: 'qc', name: '沈言' },
  { role: 'lead', name: '陆川' },
  { role: 'brand', name: '江岚' },
  { role: 'product', name: '周野' },
  { role: 'market', name: '程雨' },
  { role: 'algo', name: '周野' },
];

/* ------------------------------ 字典读取工具 ------------------------------ */

export function dictLabel(dict: LabelDict, code: string | null | undefined, fallback = '—'): string {
  if (!code) return fallback;
  return dict[code] ?? code;
}

export function dictOptions(dict: LabelDict): SelectOption[] {
  return Object.entries(dict).map(([value, label]) => ({ value, label }));
}

export function withAll(options: SelectOption[], allLabel = '全部'): SelectOption[] {
  return [{ value: '', label: allLabel }, ...options];
}

function pickStatusLabel(meta: Meta | null, groups: string[], code: string): string | null {
  if (!meta) return null;
  for (const group of groups) {
    const groupDict = meta.statusLabels[group];
    const value = groupDict?.[code];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

/* ------------------------------ 运行时字典 ------------------------------ */

export interface Labels {
  channel: (code: string) => string;
  verdict: (code: string) => string;
  reviewStatus: (code: string) => string;
  reviewDecision: (code: string) => string;
  emotion: (code: string) => string;
  severity: (code: string) => string;
  tag: (code: string) => string;
  badcaseStatus: (code: string) => string;
  badcaseCategory: (code: string) => string;
  alertLevel: (code: string) => string;
  alertStatus: (code: string) => string;
  sentiment: (code: string) => string;
  commentSeverity: (code: string) => string;
  source: (code: string) => string;
  topic: (topic: string) => string;
  clueStatus: (code: string) => string;
  clueTarget: (code: string) => string;
  clueSourceType: (code: string) => string;
  priority: (code: string) => string;
  knowledgeCategory: (code: string) => string;
  knowledgeStatus: (code: string) => string;
  knowledgeSource: (code: string) => string;
  knowledgeCompare: (code: string) => string;
  tagInfo: (code: string) => TagTaxonomyEntry | null;
}

function makeResolver(meta: Meta | null, groups: string[], fallback: LabelDict): (code: string) => string {
  return (code: string) => {
    if (!code) return '—';
    return pickStatusLabel(meta, groups, code) ?? dictLabel(fallback, code);
  };
}

export function createLabels(meta: Meta | null): Labels {
  const sourceMap: LabelDict = {};
  for (const item of meta?.sources ?? []) sourceMap[item.id] = item.label || dictLabel(SOURCE_LABELS, item.id);
  const targetMap: LabelDict = {};
  for (const item of meta?.clueTargets ?? []) targetMap[item.id] = item.label || dictLabel(CLUE_TARGET_LABELS, item.id);
  const tagMap: LabelDict = {};
  for (const item of meta?.tagTaxonomy ?? []) tagMap[item.code] = item.name || dictLabel(QC_TAG_LABELS, item.code);
  const knowledgeCategoryMap: LabelDict = {};
  for (const item of meta?.knowledgeCategories ?? []) {
    knowledgeCategoryMap[item.id] = item.label || dictLabel(KNOWLEDGE_CATEGORY_LABELS, item.id);
  }
  const knowledgeStatusMap: LabelDict = {};
  for (const item of meta?.knowledgeStatuses ?? []) {
    knowledgeStatusMap[item.id] = item.label || dictLabel(KNOWLEDGE_STATUS_LABELS, item.id);
  }
  const knowledgeSourceMap: LabelDict = {};
  for (const item of meta?.knowledgeSources ?? []) {
    knowledgeSourceMap[item.id] = item.label || dictLabel(KNOWLEDGE_SOURCE_LABELS, item.id);
  }
  const knowledgeCompareMap: LabelDict = {};
  for (const item of meta?.knowledgeCompares ?? []) {
    knowledgeCompareMap[item.id] = item.label || dictLabel(KNOWLEDGE_COMPARE_LABELS, item.id);
  }

  const tagInfo = (code: string): TagTaxonomyEntry | null => {
    const entry = meta?.tagTaxonomy.find((item) => item.code === code);
    return entry ?? null;
  };

  return {
    channel: makeResolver(meta, ['channel'], CHANNEL_LABELS),
    verdict: makeResolver(meta, ['verdict', 'qcVerdict'], VERDICT_LABELS),
    reviewStatus: makeResolver(meta, ['reviewStatus', 'review'], REVIEW_STATUS_LABELS),
    reviewDecision: makeResolver(meta, ['reviewDecision', 'decision'], REVIEW_DECISION_LABELS),
    emotion: makeResolver(meta, ['emotion'], EMOTION_LABELS),
    severity: makeResolver(meta, ['severity'], SEVERITY_LABELS),
    tag: (code: string) => tagMap[code] ?? pickStatusLabel(meta, ['qcTag', 'tag'], code) ?? dictLabel(QC_TAG_LABELS, code),
    badcaseStatus: makeResolver(meta, ['badcaseStatus', 'badcase'], BADCASE_STATUS_LABELS),
    badcaseCategory: makeResolver(meta, ['badcaseCategory', 'category'], BADCASE_CATEGORY_LABELS),
    alertLevel: makeResolver(meta, ['alertLevel', 'level'], ALERT_LEVEL_LABELS),
    alertStatus: makeResolver(meta, ['alertStatus', 'alert'], ALERT_STATUS_LABELS),
    sentiment: makeResolver(meta, ['sentiment'], SENTIMENT_LABELS),
    commentSeverity: makeResolver(meta, ['commentSeverity', 'severity'], COMMENT_SEVERITY_LABELS),
    source: (code: string) => sourceMap[code] ?? pickStatusLabel(meta, ['source'], code) ?? dictLabel(SOURCE_LABELS, code),
    topic: (topic: string) => topic || '—',
    clueStatus: makeResolver(meta, ['clueStatus', 'clue'], CLUE_STATUS_LABELS),
    clueTarget: (code: string) => targetMap[code] ?? pickStatusLabel(meta, ['clueTarget', 'target'], code) ?? dictLabel(CLUE_TARGET_LABELS, code),
    clueSourceType: makeResolver(meta, ['clueSourceType', 'sourceType'], CLUE_SOURCE_LABELS),
    priority: makeResolver(meta, ['priority', 'cluePriority'], PRIORITY_LABELS),
    knowledgeCategory: (code: string) => knowledgeCategoryMap[code] ?? dictLabel(KNOWLEDGE_CATEGORY_LABELS, code),
    knowledgeStatus: (code: string) => knowledgeStatusMap[code] ?? dictLabel(KNOWLEDGE_STATUS_LABELS, code),
    knowledgeSource: (code: string) => knowledgeSourceMap[code] ?? dictLabel(KNOWLEDGE_SOURCE_LABELS, code),
    knowledgeCompare: (code: string) => knowledgeCompareMap[code] ?? dictLabel(KNOWLEDGE_COMPARE_LABELS, code),
    tagInfo,
  };
}

export function useLabels(): Labels {
  const { meta } = useAppData();
  return useMemo(() => createLabels(meta), [meta]);
}

/* ------------------------------ 选项构造 ------------------------------ */

export function tagOptions(meta: Meta | null): SelectOption[] {
  if (meta && meta.tagTaxonomy.length > 0) {
    return meta.tagTaxonomy.map((item) => ({
      value: item.code,
      label: item.name || dictLabel(QC_TAG_LABELS, item.code),
    }));
  }
  return dictOptions(QC_TAG_LABELS);
}

export function topicOptions(meta: Meta | null): SelectOption[] {
  const topics = meta && meta.topics.length > 0 ? meta.topics : DEFAULT_TOPICS;
  return topics.map((topic) => ({ value: topic, label: topic }));
}

export function sourceOptions(meta: Meta | null): SelectOption[] {
  if (meta && meta.sources.length > 0) {
    return meta.sources.map((item) => ({
      value: item.id,
      label: item.label || dictLabel(SOURCE_LABELS, item.id),
    }));
  }
  return dictOptions(SOURCE_LABELS);
}

export function clueTargetOptions(meta: Meta | null): SelectOption[] {
  if (meta && meta.clueTargets.length > 0) {
    return meta.clueTargets.map((item) => ({
      value: item.id,
      label: item.label || dictLabel(CLUE_TARGET_LABELS, item.id),
    }));
  }
  return dictOptions(CLUE_TARGET_LABELS);
}

export function ownerOptions(meta: Meta | null): SelectOption[] {
  const owners = meta && meta.owners.length > 0 ? meta.owners : FALLBACK_OWNERS;
  const seen = new Set<string>();
  const options: SelectOption[] = [];
  for (const owner of owners) {
    if (seen.has(owner.name)) continue;
    seen.add(owner.name);
    const role = owner.role ? (ROLE_LABELS[owner.role] ?? owner.role) : '成员';
    options.push({ value: owner.name, label: `${owner.name}（${role}）` });
  }
  return options;
}

export function tagWeight(meta: Meta | null, code: string): number | null {
  const entry = meta?.tagTaxonomy.find((item) => item.code === code);
  if (entry && typeof entry.weight === 'number') return entry.weight;
  return TAG_WEIGHTS[code] ?? null;
}

/* ------------------------------ 语义色 ------------------------------ */

export function verdictTone(verdict: string): Tone {
  return verdict === 'violation' ? 'danger' : 'ok';
}

export function reviewTone(status: string | null | undefined): Tone {
  if (status === 'pending') return 'warn';
  if (status === 'done') return 'ok';
  return 'muted';
}

export function badcaseStatusTone(status: string): Tone {
  if (status === 'closed') return 'ok';
  if (status === 'pending_verify') return 'warn';
  if (status === 'in_progress') return 'info';
  return 'danger';
}

export function alertLevelTone(level: string): Tone {
  if (level === 'P0') return 'danger';
  if (level === 'P1') return 'warn';
  return 'info';
}

export function alertStatusTone(status: string): Tone {
  if (status === 'resolved') return 'ok';
  if (status === 'escalated') return 'danger';
  if (status === 'responding') return 'info';
  if (status === 'acknowledged') return 'primary';
  return 'warn';
}

export function commentSeverityTone(severity: string): Tone {
  if (severity === 'p0') return 'danger';
  if (severity === 'p1') return 'warn';
  if (severity === 'p2') return 'info';
  return 'muted';
}

export function sentimentTone(sentiment: string): Tone {
  if (sentiment === 'negative') return 'danger';
  if (sentiment === 'positive') return 'ok';
  return 'muted';
}

export function clueStatusTone(status: string): Tone {
  if (status === 'closed') return 'ok';
  if (status === 'accepted') return 'primary';
  if (status === 'rejected') return 'danger';
  if (status === 'routed') return 'info';
  return 'muted';
}

export function clueTargetTone(target: string): Tone {
  if (target === 'product') return 'info';
  if (target === 'brand') return 'warn';
  if (target === 'market') return 'primary';
  return 'neutral';
}

export function priorityTone(priority: string): Tone {
  if (priority === 'high') return 'danger';
  if (priority === 'medium') return 'warn';
  return 'muted';
}

export function severityTone(severity: string): Tone {
  if (severity === 'high') return 'danger';
  if (severity === 'medium') return 'warn';
  return 'muted';
}

export function knowledgeStatusTone(status: string): Tone {
  if (status === 'published') return 'ok';
  if (status === 'draft') return 'warn';
  return 'muted';
}

export function knowledgeSourceTone(source: string): Tone {
  if (source === 'qc_badcase') return 'primary';
  if (source === 'official') return 'info';
  return 'muted';
}

export function kpiStatusTone(status: string): Tone {
  if (status === 'ok') return 'ok';
  if (status === 'warn') return 'warn';
  return 'danger';
}

export function emotionTone(emotion: string): Tone {
  if (emotion === 'angry') return 'danger';
  if (emotion === 'anxious') return 'warn';
  return 'muted';
}

/* ------------------------------ 其它展示辅助 ------------------------------ */

export function ownerForCategory(category: string): string {
  return CATEGORY_OWNER[category] ?? '陆川';
}

export function ownerForTarget(target: string): string {
  return TARGET_OWNER[target] ?? '陆川';
}

export function ownerForTopic(topic: string): string {
  return TOPIC_OWNER[topic] ?? '陆川';
}

export const EMPTY_LABEL = '—';
