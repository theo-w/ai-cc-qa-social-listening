/**
 * 字典与路由：质检标签、舆情主题、归因类别、角色/责任人、状态文案、SLA 与路由规则。
 * 全部为冻结静态数据（specs/004 §4），供引擎、种子与 /api/meta 共用。
 */
import type {
  AlertLevel,
  BadcaseCategory,
  ClueTarget,
  CommentSource,
  KnowledgeCategory,
  KnowledgeFactCompare,
  KnowledgeSource,
  KnowledgeStatus,
  Severity,
  SingleSeverity,
  TagCode,
} from '../types.js';

export interface TagMeta {
  code: TagCode;
  name: string;
  description: string;
  severity: Severity;
  weight: number;
  ruleId: string;
}

/** 质检标签与扣分权重（004 §4.1 / 002 FR-QC-004）。 */
export const TAGS: readonly TagMeta[] = [
  {
    code: 'attitude',
    name: '服务态度',
    description: '辱骂、指责、嘲讽反问、驱赶、明显不耐烦等态度问题',
    severity: 'high',
    weight: 25,
    ruleId: 'R-QC-ATT',
  },
  {
    code: 'forbidden',
    name: '违规话术',
    description: '索要好评、私下交易/站外引流、泄露隐私、绝对化承诺、诱导充值返利',
    severity: 'high',
    weight: 30,
    ruleId: 'R-QC-FOR',
  },
  {
    code: 'off_topic',
    name: '答非所问',
    description: '用户问题与坐席回答意图不匹配、模板回复、连续多轮未回应核心诉求',
    severity: 'medium',
    weight: 15,
    ruleId: 'R-QC-OFF',
  },
  {
    code: 'wrong_knowledge',
    name: '知识错误',
    description: '与知识库事实冲突的陈述（费率、返还比例、活动时间、退款规则、版本信息）',
    severity: 'high',
    weight: 25,
    ruleId: 'R-QC-KNW',
  },
  {
    code: 'timeout',
    name: '响应超时',
    description: '坐席回复间隔超过 180 秒',
    severity: 'medium',
    weight: 10,
    ruleId: 'R-QC-TIM',
  },
  {
    code: 'escalation',
    name: '情绪升级',
    description: '用户从平静转为愤怒，或提出投诉/曝光/退款升级等诉求（会话风险标记）',
    severity: 'medium',
    weight: 20,
    ruleId: 'R-QC-ESC',
  },
] as const;

export const TAG_MAP: Record<TagCode, TagMeta> = TAGS.reduce(
  (acc, tag) => {
    acc[tag.code] = tag;
    return acc;
  },
  {} as Record<TagCode, TagMeta>,
);

export const TAG_CODES: readonly TagCode[] = TAGS.map((tag) => tag.code);

export function isTagCode(value: string): value is TagCode {
  return (TAG_CODES as readonly string[]).includes(value);
}

/** 舆情主题字典（004 §4.3，顺序即展示/排序顺序）。 */
export const TOPICS: readonly string[] = ['版本', '充值', '外挂', '客服', '活动', 'Bug', '其他'] as const;

/** 评论来源（openapi SentimentComment.source）。 */
export const SOURCES: readonly { id: CommentSource; label: string }[] = [
  { id: 'steam', label: 'Steam 商店' },
  { id: 'taptap', label: 'TapTap' },
  { id: 'googleplay', label: 'Google Play' },
  { id: 'community', label: '官方社区' },
  { id: 'ticket', label: '客服工单' },
] as const;

/** 线索接收目标团队。 */
export const CLUE_TARGETS: readonly { id: ClueTarget; label: string }[] = [
  { id: 'product', label: '产研（周野）' },
  { id: 'brand', label: '品牌市场（江岚）' },
  { id: 'market', label: '市场（程雨）' },
  { id: 'cs', label: '客服（陆川）' },
] as const;

/** 归因类别。 */
export const BADCASE_CATEGORIES: readonly { code: BadcaseCategory; name: string }[] = [
  { code: 'knowledge', name: '知识缺失' },
  { code: 'script', name: '话术问题' },
  { code: 'process', name: '流程问题' },
  { code: 'system', name: '系统问题' },
] as const;

/** 知识条目分类（009）。 */
export const KNOWLEDGE_CATEGORIES: readonly { code: KnowledgeCategory; name: string }[] = [
  { code: 'refund', name: '退款' },
  { code: 'recharge', name: '充值' },
  { code: 'activity', name: '活动' },
  { code: 'version', name: '版本' },
  { code: 'account', name: '账号' },
  { code: 'other', name: '其他' },
] as const;

export const KNOWLEDGE_CATEGORY_CODES: readonly KnowledgeCategory[] = KNOWLEDGE_CATEGORIES.map(
  (category) => category.code,
);

export const KNOWLEDGE_STATUS_LABELS: Record<KnowledgeStatus, string> = {
  draft: '草稿',
  published: '已发布',
  offline: '已下线',
};

export const KNOWLEDGE_SOURCE_LABELS: Record<KnowledgeSource, string> = {
  official: '官方口径',
  qc_badcase: '质检驱动',
  manual: '人工新增',
};

export const KNOWLEDGE_COMPARE_LABELS: Record<KnowledgeFactCompare, string> = {
  number: '数值比对',
  duration_minutes: '时效比对',
  date: '日期比对',
  text: '固定口径',
};

export function knowledgeCategoryName(code: string): string {
  return KNOWLEDGE_CATEGORIES.find((category) => category.code === code)?.name ?? '其他';
}

/** 模拟角色（004 §4.4）。 */
export const ROLES: readonly { id: string; label: string }[] = [
  { id: 'qc', label: '质检 / 培训' },
  { id: 'lead', label: '客服主管' },
  { id: 'agent', label: '坐席' },
  { id: 'brand', label: '品牌 / 市场' },
  { id: 'product', label: '产研' },
  { id: 'algo', label: '算法 / 研发' },
] as const;

/** 责任人名录（004 §4.5）。 */
export const OWNERS: readonly { role: string; name: string; title: string }[] = [
  { role: 'qc', name: '沈言', title: '质检组长' },
  { role: 'lead', name: '陆川', title: '客服主管' },
  { role: 'brand', name: '江岚', title: '品牌负责人' },
  { role: 'product', name: '周野', title: '产研负责人' },
  { role: 'market', name: '程雨', title: '市场负责人' },
  { role: 'knowledge', name: '顾清', title: '知识运营' },
  { role: 'training', name: '唐沐', title: '培训负责人' },
] as const;

export const OWNER_NAMES = {
  qc: '沈言',
  lead: '陆川',
  brand: '江岚',
  product: '周野',
  market: '程雨',
  knowledge: '顾清',
  training: '唐沐',
} as const;

/** badcase 归因 → 默认责任人。 */
export function badcaseOwner(category: BadcaseCategory): string {
  switch (category) {
    case 'knowledge':
      return OWNER_NAMES.knowledge;
    case 'script':
      return OWNER_NAMES.training;
    case 'process':
      return OWNER_NAMES.lead;
    case 'system':
      return OWNER_NAMES.product;
  }
}

/** badcase 归因 → 默认 SLA 小时数（002 FR-BC-002）。 */
export function badcaseSlaHours(category: BadcaseCategory): number {
  switch (category) {
    case 'knowledge':
      return 48;
    case 'script':
      return 48;
    case 'process':
      return 24;
    case 'system':
      return 72;
  }
}

/** 舆情主题 → 默认责任人（004 §4.5）。P0 预警统一归品牌负责人（007 §6.3）。 */
export function sentimentOwner(topic: string, level?: 'P0' | 'P1' | 'P2'): string {
  if (level === 'P0') {
    return OWNER_NAMES.brand;
  }
  if (topic === '外挂' || topic === '充值') {
    return OWNER_NAMES.brand;
  }
  if (topic === '版本' || topic === 'Bug') {
    return OWNER_NAMES.product;
  }
  return OWNER_NAMES.lead;
}

/** 预警级别 → SLA 分钟数（007 §7）。 */
export function alertSlaMinutes(level: AlertLevel): number {
  switch (level) {
    case 'P0':
      return 30;
    case 'P1':
      return 120;
    case 'P2':
      return 1440;
  }
}

/** 线索目标 → 接收负责人。 */
export function clueOwner(target: ClueTarget): string {
  switch (target) {
    case 'product':
      return OWNER_NAMES.product;
    case 'brand':
      return OWNER_NAMES.brand;
    case 'market':
      return OWNER_NAMES.market;
    case 'cs':
      return OWNER_NAMES.lead;
  }
}

/** 质检标签 → 默认归因类别（默认路由，可由用户覆盖）。 */
export function categoryForTag(tag: TagCode): BadcaseCategory {
  switch (tag) {
    case 'wrong_knowledge':
      return 'knowledge';
    case 'attitude':
    case 'forbidden':
      return 'script';
    case 'off_topic':
    case 'timeout':
      return 'process';
    case 'escalation':
      return 'system';
  }
}

/** 严重级别排序权重（high 最大）。 */
export function severityRank(severity: Severity): number {
  switch (severity) {
    case 'high':
      return 3;
    case 'medium':
      return 2;
    case 'low':
      return 1;
  }
}

/** 最高严重级别。 */
export function maxSeverity(severities: readonly Severity[]): Severity {
  let current: Severity = 'low';
  for (const severity of severities) {
    if (severityRank(severity) > severityRank(current)) {
      current = severity;
    }
  }
  return current;
}

/** 单条舆情级别排序权重（p0 最大）。 */
export function singleSeverityRank(severity: SingleSeverity): number {
  switch (severity) {
    case 'p0':
      return 3;
    case 'p1':
      return 2;
    case 'p2':
      return 1;
    case 'none':
      return 0;
  }
}

/** 预警级别排序权重（P0 最大）。 */
export function alertLevelRank(level: AlertLevel): number {
  switch (level) {
    case 'P0':
      return 3;
    case 'P1':
      return 2;
    case 'P2':
      return 1;
  }
}

/** 单条评论等级 ↔ 预警级别转换。 */
export function singleToAlertLevel(severity: SingleSeverity): AlertLevel | null {
  switch (severity) {
    case 'p0':
      return 'P0';
    case 'p1':
      return 'P1';
    case 'p2':
      return 'P2';
    case 'none':
      return null;
  }
}

export function alertLevelToSingle(level: AlertLevel): SingleSeverity {
  switch (level) {
    case 'P0':
      return 'p0';
    case 'P1':
      return 'p1';
    case 'P2':
      return 'p2';
  }
}

/** 状态文案：供 /api/meta 使用，前端不硬编码中文（FR-SYS-007）。 */
export const STATUS_LABELS: Record<string, Record<string, string>> = {
  channel: { online: '在线客服', ticket: '工单', phone: '电话转写' },
  verdict: { pass: '通过', violation: '违规' },
  emotion: { calm: '平静', anxious: '焦虑', angry: '愤怒' },
  tag: Object.fromEntries(TAGS.map((tag) => [tag.code, tag.name])),
  tagSeverity: { high: '高', medium: '中', low: '低' },
  review: { pending: '待复核', done: '已复核' },
  reviewDecision: { confirm: '确认', overturn: '改判', amend: '修正标签' },
  category: { knowledge: '知识缺失', script: '话术问题', process: '流程问题', system: '系统问题' },
  severity: { high: '高', medium: '中', low: '低' },
  badcase: { open: '待处理', in_progress: '处理中', pending_verify: '待验证', closed: '已闭环' },
  badcaseAction: {
    created: '创建',
    assigned: '分派',
    progressed: '进展',
    verified: '提交验证',
    closed: '闭环',
    reopened: '重开',
    commented: '备注',
  },
  alertLevel: { P0: 'P0 紧急', P1: 'P1 高', P2: 'P2 中' },
  alert: { new: '待响应', acknowledged: '已确认', responding: '处理中', escalated: '已升级', resolved: '已解决' },
  alertAction: {
    created: '生成',
    acknowledged: '确认',
    responded: '响应',
    escalated: '升级',
    resolved: '解决',
    commented: '备注',
  },
  commentSeverity: { p0: 'P0', p1: 'P1', p2: 'P2', none: '无' },
  sentiment: { positive: '正面', neutral: '中性', negative: '负面' },
  source: Object.fromEntries(SOURCES.map((source) => [source.id, source.label])),
  clueStatus: { draft: '草稿', routed: '已提交', accepted: '已接收', rejected: '已拒绝', closed: '已关闭' },
  clue: { draft: '草稿', routed: '已提交', accepted: '已接收', rejected: '已拒绝', closed: '已关闭' },
  clueTarget: { product: '产研', brand: '品牌', market: '市场', cs: '客服' },
  cluePriority: { high: '高', medium: '中', low: '低' },
  clueAction: {
    created: '创建',
    routed: '提交',
    accepted: '接收',
    rejected: '拒绝',
    closed: '闭环',
    commented: '备注',
  },
  range: { '7d': '近 7 天', '14d': '近 14 天', '30d': '近 30 天' },
};
