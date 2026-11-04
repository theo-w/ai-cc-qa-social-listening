/**
 * 舆情规则引擎（确定性，rule-engine-v0.3.0）。
 *
 * 实现 specs/007 §6 的口径：
 * - 情感：正负词典 + 否定词 + 程度副词 + 弱否定/对比语境，输出 sentiment/sentimentScore；
 *   信息咨询问句（请问/想问下/BUG 反馈在哪里提交）判中性，避免被词面负面词带偏；
 * - 主题：加权关键词（显式词 > 强信号 > 弱信号）+ 句首场景标记，匹配 1-3 个主题（主题字典见 004 §4.3）；
 * - 单条分级：P0/P1/P2/none（高危主题+高危信号 → P0；明确影响 → P1；抱怨建议 → P2）；
 * - 聚簇升级：同主题同日的负面评论 ≥8 → P0、3-7 → ≥P1、1-2 → ≥P2，每簇最多一条预警。
 *
 * 引擎不使用 Date.now()/随机数/金标标签，同一输入输出完全一致。
 */
import type {
  AlertLevel,
  AlertTriggerRule,
  CommentSource,
  SentimentAnalysis,
  SentimentClusterDraft,
  SentimentComment,
  SingleSeverity,
} from '../types.js';
import {
  SOURCES,
  TOPICS,
  alertLevelRank,
  singleSeverityRank,
  singleToAlertLevel,
} from './taxonomy.js';
import { dateKey } from '../util/time.js';

/* ------------------------------ 词典 ------------------------------ */

const POSITIVE_WORDS = [
  '好玩',
  '好玩儿',
  '不错',
  '满意',
  '喜欢',
  '给力',
  '良心',
  '感谢',
  '支持',
  '好评',
  '太棒',
  '优秀',
  '点赞',
  '流畅',
  '舒服',
  '爱了',
  '厉害',
  '完美',
  '稳定',
  '福利',
  '推荐',
  '期待',
  '加油',
  '精彩',
  '用心',
  '诚意',
  '感动',
  '好看',
  '好听',
  '超值',
  '划算',
  '真香',
  '奈斯',
  '牛',
  '棒',
  '赞',
  '香',
  '爽',
  // 体验/服务类常见正面表达（用于覆盖"修复后转好""效率高"等结果性好评）
  '开心',
  '有意思',
  '及时',
  '专业',
  '清楚',
  '很快',
  '很好',
  '挺好',
  '到位',
  '丰富',
  '丰厚',
  '精致',
  '顺手',
  '好用',
  '合理',
  '显眼',
  '解决',
  '修复',
  '修好',
  '处理好',
  '好多了',
  '少了很多',
  '值得',
  '实惠',
  '进步',
  '耐心',
  '搞定',
] as const;

const NEGATIVE_WORDS = [
  '垃圾',
  '坑',
  '骗',
  '失望',
  '恶心',
  '差评',
  '退游',
  '退款',
  '投诉',
  '举报',
  '曝光',
  '维权',
  '闪退',
  '卡顿',
  '掉线',
  '回档',
  '封号',
  '误封',
  '扣款',
  '不到账',
  '无法登录',
  '登录不上',
  '支付失败',
  '外挂',
  '开挂',
  '挂机',
  '服务器',
  '崩溃',
  'bug',
  '敷衍',
  '态度差',
  '不回',
  '不理',
  '拖延',
  '慢',
  '贵',
  '坑钱',
  '吃相',
  '卸载',
  '弃坑',
  '无语',
  '离谱',
  '过分',
  '气死',
  '拉胯',
  '后悔',
  '劝退',
  '死机',
  '黑屏',
  '无法',
  '失败',
  '异常',
  '错误',
  '丢失',
  '被盗',
  '盗号',
  '误判',
  '割韭菜',
  '逼氪',
  '骗氪',
  '诈骗',
  '虚假',
  '欺骗',
  '缺德',
  '难受',
  '吐了',
  '要命',
  '不能忍',
  '忍不了',
  '受够',
  '好烦',
  '烦死',
  '差劲',
  '辣鸡',
  '圈钱',
  '不处理',
  '没人管',
  // 隐晦抱怨/体验受损（无脏话，但明确负向）
  '复杂',
  '太绕',
  '看不懂',
  '太小',
  '有点累',
  '不习惯',
  '不太习惯',
  '不显眼',
  '难找',
  '不好找',
  '找了半天',
  '找不到人',
  '没人处理',
  '没人接',
  '停滞',
  '延迟',
  '排队',
  '太低',
  '太少',
  '太吵',
  '太难',
  '太长',
  '藏得太深',
  '距离感',
  '模板化',
  '没认真',
  '不合理',
  '麻烦',
  '有点短',
  '很低',
  '太官方',
  '有点冷',
  '不顺手',
  '重新适应',
  '白花',
  '装死',
  '刺眼',
  '还没发',
  '越来越少',
  '越来越差',
  '卡在',
  '也没用',
] as const;

const NEGATION_WORDS = ['不', '没', '没有', '无', '未', '别', '非', '毫无', '并不', '不怎么'] as const;
const INTENSIFIERS = ['太', '非常', '特别', '极其', '超级', '巨', '贼', '真的很', '很', '超', '真', '十分', '相当'] as const;

/** 弱否定前缀：「不太」「有点」「一般」 — 表达 mild negative 而非 neutral/positive。 */
const WEAK_NEGATION_PREFIXES = ['不太', '有点', '一般'] as const;

/** 对比/怀旧语境：「还是旧版/不如以前」→ 对新版不满（negative）。 */
const CONTRAST_PAST_PATTERNS: readonly RegExp[] = [
  /还是(旧版|老版|老版本|以前的?|原来|当初)/,
  /还是(喜欢|习惯|怀念)(以前|旧版|老版|原来|当初)/,
  /(不如|比不上|没有比|没比)(以前|原来|旧版|老版|当初)/,
  /没(以前|原来|旧版|老版)(好|好用|顺手|舒服)/,
  /(以前|原来|旧版|老版)的?(感觉|体验)(更好|好很多)/,
] as const;

/** 信息咨询类疑问句标记（问句应判中性，避免被"一般/BUG"等词误判为负面）。 */
const INQUIRY_MARKERS = [
  '请问',
  '想问',
  '问一下',
  '问下',
  '想咨询',
  '咨询一下',
  '想了解',
  '了解一下',
  '求问',
  '求教',
] as const;

/** 疑问句中的"信息获取"意图（仅在句末为问号/吗/呢时生效）。 */
const INFO_QUESTION_PATTERNS: readonly RegExp[] = [
  /(在哪里|在哪|哪里(进入|查看|提交|领取|发|找|买|下载))/,
  /什么时候(开始|结束|上线|发放|刷新|开放|更新|出)/,
  /(几点|多久(一次|回复|结算|刷新|更新))/,
  /怎么(领取|参与|玩|获得|查看|提交|绑定|参加|进入)/,
  /(有哪些|是什么|有什么区别|多少钱|怎么弄)/,
  /(有|能不能|可以|是否).{0,8}(吗|么)[？?]?$/,
] as const;

const NEGATED_POSITIVE_WHITELIST = [
  '不卡',
  '不闪退',
  '不掉线',
  '不崩溃',
  '不坑',
  '不贵',
  '没有问题',
  '没有异常',
  '没有 bug',
  '没毛病',
] as const;

/** 明确"资损/数据丢失"信号（007 §6 单条分级 P0 补充条件）。 */
const LOSS_SIGNALS = [
  '钱没了',
  '数据丢失',
  '资产丢失',
  '账号被盗',
  '号被盗',
  '回档',
  '清零',
  '全没了',
  '钱全没',
  '钻石没了',
  '充值没到账',
  '扣款不到账',
  '充的钱',
] as const;

/** 高危主题（P0 必要条件之一）。 */
const HIGH_RISK_TOPICS: readonly string[] = ['外挂', '充值', '版本'] as const;

/** P0 高危信号词（007 §6 原词表）。 */
const P0_SIGNALS = [
  '回档',
  '封号',
  '误封',
  '扣款',
  '不到账',
  '无法登录',
  '登录不上',
  '大面积',
  '集体',
  '维权',
  '投诉',
  '12315',
  '曝光',
  '退款潮',
  '数据丢失',
  '丢号',
  '被盗',
  '盗号',
] as const;

/** P1 明确影响信号词（收紧：移除过于宽泛的"没人管""慢"）。 */
const P1_SIGNALS = [
  '无法使用',
  '不能',
  '失败',
  '异常',
  '拖延',
  '闪退',
  '卡顿',
  '崩溃',
  '掉线',
  '进不去',
  '登录不上',
  '态度差',
  '不回',
  '不理',
  '排队',
  '等了',
  '等待',
  '处理慢',
  '影响',
  '没法',
  '敷衍',
  '延迟',
  '停滞',
  '没人处理',
  '没人接',
  '卡在',
] as const;

/** 中性/抱怨建议信号（P2）。 */
const COMPLAINT_SIGNALS = ['建议', '希望', '能不能', '优化', '吐槽', '反馈', '改进', '加强', '修复'] as const;

/** 噪声判定（广告/无关/纯情绪灌水）。 */
const NOISE_PATTERNS: readonly RegExp[] = [
  /(加群|加微信|加v|vx|代练|代充|代打|低价出售|高价收购|账号出售|买号|卖号|私服|外挂出售|刷单|号商|诚招代理|工作室收号)/i,
  /^(哈哈哈+|来了来了|签到|水贴|沙发|顶|路过|广告|test|测试)+$/,
] as const;

/** 主题关键词表（弱信号，命中 1 次计 1 分）。 */
const TOPIC_KEYWORDS: Record<string, readonly string[]> = {
  版本: ['更新', '公告', '上线', '下架'],
  充值: ['氪', '到账', '返利', '礼包', '人民币', '钱'],
  外挂: [],
  客服: ['回复', '人工', '排队', '反馈'],
  活动: ['任务', '奖励', '参与', '玩法'],
  Bug: ['服务器', '延迟', '优化', '闪退'],
} as const;

/** 强信号关键词（命中 1 次计 2 分），用于区分"提到什么"与"讨论什么"。 */
const TOPIC_STRONG_KEYWORDS: Record<string, readonly string[]> = {
  版本: ['版本', '新版本', '版更', '回档', '热更新', '更新后', '补丁', '维护', '赛季', '版本号'],
  充值: ['充值', '氪金', '648', '328', '首充', '月卡', '点券', '扣款', '退款', '支付', '付款', '订单', '付费', '钻石'],
  外挂: ['外挂', '开挂', '透视', '自瞄', '作弊', '工作室', '科技', '封号', '误封', '封禁', '解封'],
  客服: ['客服', '工单', '售后', '申诉', '机器人', '态度'],
  活动: ['活动', '抽奖', '签到', '庆典', '周年', '限时', '兑换', '补偿'],
  Bug: ['修复', '闪退', '卡顿', '崩溃', '掉线', '黑屏', '报错', '异常', '卡死', '死机', '进不去', '登录不上', '无法登录'],
} as const;

/** 显式产品/技术名词：出现即强烈指向该主题（权重高于普通强信号）。 */
const TOPIC_EXPLICIT_KEYWORDS: Record<string, readonly string[]> = {
  Bug: ['bug'],
} as const;

/** 主题关键词权重：显式词 4 分，强信号 2 分，弱信号 1 分。 */
const TOPIC_KEYWORD_WEIGHT = 2;
const TOPIC_EXPLICIT_WEIGHT = 4;

/**
 * 句首主题标记：评论开头常先交代"在什么场景下"，据此确定主主题。
 * 例："更新完进不去副本"——用户归因于版本更新，主主题应为版本而不是 Bug。
 */
const LEADING_TOPIC_PATTERNS: readonly { topic: string; pattern: RegExp }[] = [
  { topic: '版本', pattern: /^(新版本|版本更新|更新完|更新后|版更后)/ },
];
const LEADING_TOPIC_WEIGHT = 3;

/* ------------------------------ 工具 ------------------------------ */

function countMatches(text: string, words: readonly string[]): number {
  let count = 0;
  for (const word of words) {
    if (word.length === 0) {
      continue;
    }
    let index = text.indexOf(word);
    while (index >= 0) {
      count += 1;
      index = text.indexOf(word, index + word.length);
    }
  }
  return count;
}

function containsAny(text: string, words: readonly string[]): boolean {
  return words.some((word) => word.length > 0 && text.includes(word));
}

function findSignalWords(text: string, words: readonly string[]): string[] {
  return words.filter((word) => word.length > 0 && text.includes(word));
}

function hasNegationBefore(text: string, index: number): boolean {
  const window = text.slice(Math.max(0, index - 3), index);
  return NEGATION_WORDS.some((word) => window.endsWith(word));
}

function hasIntensifierBefore(text: string, index: number): boolean {
  const window = text.slice(Math.max(0, index - 4), index);
  return INTENSIFIERS.some((word) => window.endsWith(word));
}

interface ScoreResult {
  positiveScore: number;
  negativeScore: number;
  weakNegationScore: number; // 弱否定（不太/有点/一般）的负向分数
  matchedPositive: boolean;
  matchedNegative: boolean;
  contrastNegative: boolean; // 对比/怀旧语境：对新版不满
}

function scoreText(text: string): ScoreResult {
  let working = text.toLowerCase();
  let positiveScore = 0;
  let negativeScore = 0;
  let weakNegationScore = 0;
  let matchedPositive = false;
  let matchedNegative = false;
  let contrastNegative = false;

  // 先处理"否定 + 负面词"的正面表达（不卡/没毛病等），避免误判。
  for (const phrase of NEGATED_POSITIVE_WHITELIST) {
    if (working.includes(phrase)) {
      positiveScore += 1;
      matchedPositive = true;
      working = working.split(phrase).join(' ');
    }
  }

  // 对比/怀旧语境检测：「还是旧版」「不如以前」→ 对新版/现状不满
  for (const pattern of CONTRAST_PAST_PATTERNS) {
    if (pattern.test(working)) {
      contrastNegative = true;
      matchedNegative = true;
      negativeScore += 1.5;
      break;
    }
  }

  // 弱否定前缀处理：「不太」「有点」「一般」+ 正面词 → mild negative
  for (const prefix of WEAK_NEGATION_PREFIXES) {
    let prefixIndex = working.indexOf(prefix);
    while (prefixIndex >= 0) {
      // 检查前缀后 1-4 个字符内是否有正面词
      const suffixStart = prefixIndex + prefix.length;
      const suffix = working.slice(suffixStart, suffixStart + 6);
      for (const word of POSITIVE_WORDS) {
        if (suffix.startsWith(word)) {
          // 「不太喜欢」「有点满意」→ mild negative
          weakNegationScore += 0.5;
          matchedNegative = true;
          // 不将正面词计为 positive
          break;
        }
      }
      prefixIndex = working.indexOf(prefix, prefixIndex + prefix.length);
    }
  }

  // 一般/一般般单独处理
  if (working.includes('一般') || working.includes('一般般')) {
    weakNegationScore += 0.3;
  }

  for (const word of POSITIVE_WORDS) {
    let index = working.indexOf(word);
    while (index >= 0) {
      // 跳过已被弱否定前缀覆盖的正面词
      const prefixStart = Math.max(0, index - 2);
      const prefix = working.slice(prefixStart, index);
      const isWeakNegated = WEAK_NEGATION_PREFIXES.some(p => prefix.endsWith(p));
      if (isWeakNegated) {
        index = working.indexOf(word, index + word.length);
        continue;
      }
      matchedPositive = true;
      const weight = hasIntensifierBefore(working, index) ? 1.5 : 1;
      if (hasNegationBefore(working, index)) {
        negativeScore += weight;
      } else {
        positiveScore += weight;
      }
      index = working.indexOf(word, index + word.length);
    }
  }

  for (const word of NEGATIVE_WORDS) {
    let index = working.indexOf(word);
    while (index >= 0) {
      matchedNegative = true;
      const weight = hasIntensifierBefore(working, index) ? 1.5 : 1;
      negativeScore += weight;
      index = working.indexOf(word, index + word.length);
    }
  }

  return { positiveScore, negativeScore, weakNegationScore, matchedPositive, matchedNegative, contrastNegative };
}

/* ------------------------------ 主题识别 ------------------------------ */

function detectTopics(text: string): { topics: string[]; matched: boolean } {
  const working = text.toLowerCase();
  // 按"得分 + 首次出现位置"排序：同一个词出现在不同主题时，谁先被提及谁更可能是主主题。
  const scores = new Map<string, { score: number; firstIndex: number }>();
  for (const topic of TOPICS) {
    const explicit = TOPIC_EXPLICIT_KEYWORDS[topic] ?? [];
    const strong = TOPIC_STRONG_KEYWORDS[topic] ?? [];
    const weak = TOPIC_KEYWORDS[topic] ?? [];
    let score = 0;
    let firstIndex = Number.POSITIVE_INFINITY;
    for (const [words, weight] of [
      [explicit, TOPIC_EXPLICIT_WEIGHT],
      [strong, TOPIC_KEYWORD_WEIGHT],
      [weak, 1],
    ] as const) {
      for (const word of words) {
        if (word.length === 0) {
          continue;
        }
        const index = working.indexOf(word);
        if (index < 0) {
          continue;
        }
        score += countMatches(working, [word]) * weight;
        firstIndex = Math.min(firstIndex, index);
      }
    }
    if (score > 0) {
      scores.set(topic, { score, firstIndex });
    }
  }
  // 句首主题标记加权：开篇交代的场景通常就是用户真正要讨论的主题。
  for (const { topic, pattern } of LEADING_TOPIC_PATTERNS) {
    if (!pattern.test(working)) {
      continue;
    }
    const current = scores.get(topic);
    scores.set(topic, { score: (current?.score ?? 0) + LEADING_TOPIC_WEIGHT, firstIndex: 0 });
  }
  if (scores.size === 0) {
    return { topics: ['其他'], matched: false };
  }
  const sorted = [...scores.entries()].sort((left, right) => {
    if (right[1].score !== left[1].score) {
      return right[1].score - left[1].score;
    }
    if (right[1].firstIndex !== left[1].firstIndex) {
      return left[1].firstIndex - right[1].firstIndex;
    }
    return TOPICS.indexOf(left[0]) - TOPICS.indexOf(right[0]);
  });
  return { topics: sorted.slice(0, 3).map(([topic]) => topic), matched: true };
}

/* ------------------------------ 单条分级 ------------------------------ */

function detectSeverity(
  text: string,
  sentiment: SentimentAnalysis['sentiment'],
  topics: readonly string[],
  matchedNegative: boolean,
  contrastNegative: boolean,
): { severity: SingleSeverity; confidence: number; rules: string[] } {
  const rules: string[] = [];
  const negative = sentiment === 'negative';

  const isNoise =
    NOISE_PATTERNS.some((pattern) => pattern.test(text)) &&
    !containsAny(text, ['投诉', '曝光', '维权', '12315']);
  if (isNoise) {
    return { severity: 'none', confidence: 0.86, rules: ['SEN-NOISE'] };
  }

  // 信息咨询问句（请问/想问下...）只是提问，不构成预警线索。
  if (sentiment === 'neutral' && informationRequestKind(text) !== null) {
    return { severity: 'none', confidence: 0.8, rules: ['SEN-INQUIRY'] };
  }

  const hasHighRiskTopic = topics.some((topic) => HIGH_RISK_TOPICS.includes(topic));
  const p0Signals = findSignalWords(text, P0_SIGNALS);
  const lossSignals = findSignalWords(text, LOSS_SIGNALS);
  const p1Signals = findSignalWords(text, P1_SIGNALS);
  const isComplaint = containsAny(text, COMPLAINT_SIGNALS);

  // 对比/怀旧语境：对新版不满 → 至少 P2
  if (contrastNegative) {
    rules.push('SEN-LEVEL-P2', 'SEN-CONTRAST-NOSTALGIA');
    return { severity: 'p2', confidence: 0.78, rules };
  }

  if (negative && (p0Signals.length > 0 || lossSignals.length > 0)) {
    rules.push('SEN-LEVEL-P0');
    if (hasHighRiskTopic) {
      rules.push('SEN-P0-HIGH-RISK-TOPIC');
    }
    if (p0Signals.length > 0) {
      rules.push(`SEN-P0-SIGNAL:${p0Signals.join('|')}`);
    }
    const confident = hasHighRiskTopic || lossSignals.length > 0;
    return { severity: 'p0', confidence: confident ? 0.9 : 0.82, rules };
  }

  if (negative && p1Signals.length > 0) {
    rules.push('SEN-LEVEL-P1', `SEN-P1-SIGNAL:${p1Signals.slice(0, 3).join('|')}`);
    return { severity: 'p1', confidence: 0.85, rules };
  }

  if (negative) {
    rules.push('SEN-LEVEL-P2', 'SEN-NEGATIVE-NO-IMPACT');
    return { severity: 'p2', confidence: 0.8, rules };
  }

  // 解耦：即使 sentiment=neutral，含明确抱怨/负面关键词也应标记 P2
  // 注意：正面评价里出现"希望/优化"（如"优化很到位，希望继续"）不算抱怨，不升级。
  if (sentiment === 'neutral' && matchedNegative && isComplaint) {
    rules.push('SEN-LEVEL-P2', 'SEN-NEUTRAL-COMPLAINT');
    return { severity: 'p2', confidence: 0.76, rules };
  }

  if (sentiment === 'neutral' && isComplaint) {
    rules.push('SEN-LEVEL-P2', 'SEN-NEUTRAL-SUGGESTION');
    return { severity: 'p2', confidence: 0.78, rules };
  }

  rules.push('SEN-LEVEL-NONE');
  return { severity: 'none', confidence: sentiment === 'positive' ? 0.88 : 0.74, rules };
}

/** 是否属于"信息咨询"问句：问句以获取信息为主，不应被词面负面词带偏。 */
function informationRequestKind(text: string): 'marker' | 'pattern' | null {
  if (INQUIRY_MARKERS.some((marker) => text.includes(marker))) {
    return 'marker';
  }
  const isQuestion = /[？?]\s*$/.test(text) || /[吗呢]$/.test(text.trim());
  if (isQuestion && INFO_QUESTION_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'pattern';
  }
  return null;
}

/* ------------------------------ 单条分析 ------------------------------ */

export function analyzeSentiment(input: { text: string }): SentimentAnalysis {
  const text = input.text.trim();
  const score = scoreText(text);
  const total = score.positiveScore + score.negativeScore;
  const rawScore = total === 0 ? 0 : (score.positiveScore - score.negativeScore) / total;
  const sentimentScore = Math.round(rawScore * 100) / 100;

  const { topics, matched } = detectTopics(text);
  const primaryTopic = topics[0] ?? '其他';

  // 综合评分：将弱否定和对比语境纳入情感判定
  const effectiveNegativeScore = score.negativeScore + score.weakNegationScore;
  const effectiveTotal = score.positiveScore + effectiveNegativeScore;
  const effectiveRawScore = effectiveTotal === 0 ? 0 : (score.positiveScore - effectiveNegativeScore) / effectiveTotal;

  let sentiment: SentimentAnalysis['sentiment'];
  if (score.positiveScore === 0 && effectiveNegativeScore === 0) {
    sentiment = 'neutral';
  } else if (effectiveRawScore >= 0.2) {
    sentiment = 'positive';
  } else if (effectiveRawScore <= -0.2) {
    sentiment = 'negative';
  } else {
    // 边界情况：弱否定倾向 negative
    sentiment = effectiveNegativeScore > score.positiveScore ? 'negative' : 'neutral';
  }

  // 信息咨询类问句（如"BUG 反馈在哪里提交？"）以获取信息为主，且没有明确负面证据时判中性。
  // 显式咨询标记（请问/想问）优先；仅靠句式判断时要求负面证据很弱，避免把"BUG 什么时候修？"这类质问判成中性。
  const inquiryKind = informationRequestKind(text);
  if (
    inquiryKind !== null &&
    !score.contrastNegative &&
    (inquiryKind === 'marker' || effectiveNegativeScore <= 0.5)
  ) {
    sentiment = 'neutral';
  }

  const severityResult = detectSeverity(text, sentiment, topics, score.matchedNegative, score.contrastNegative);

  const rules: string[] = [];
  if (score.matchedPositive) {
    rules.push('SEN-LEX-POS');
  }
  if (score.matchedNegative) {
    rules.push('SEN-LEX-NEG');
  }
  if (!matched) {
    rules.push('SEN-TOPIC-FALLBACK');
  } else {
    rules.push(`SEN-TOPIC:${topics.join('|')}`);
  }
  rules.push(...severityResult.rules);

  let confidence = severityResult.confidence;
  // 情感/主题证据不足时降低置信度，转人工复核。
  if (total === 0 && severityResult.severity === 'none') {
    confidence = 0.72;
  }
  if (!matched && severityResult.severity !== 'none') {
    confidence = Math.min(confidence, 0.72);
  }
  confidence = Math.round(confidence * 100) / 100;

  return {
    sentiment,
    sentimentScore,
    topics,
    primaryTopic,
    severity: severityResult.severity,
    confidence,
    needsReview: confidence < 0.75,
    engineRules: rules,
  };
}

/* ------------------------------ 聚簇升级 ------------------------------ */

interface ClusterInput {
  id: string;
  text: string;
  source: CommentSource;
  publishedAt: string;
  analysis: SentimentAnalysis;
}

const SOURCE_ORDER = SOURCES.map((source) => source.id);

function aggregateLevelFor(negativeCount: number): AlertLevel | null {
  if (negativeCount >= 8) {
    return 'P0';
  }
  if (negativeCount >= 3) {
    return 'P1';
  }
  if (negativeCount >= 1) {
    return 'P2';
  }
  return null;
}

function aggregateRuleId(level: AlertLevel): string {
  switch (level) {
    case 'P0':
      return 'aggregate_escalation_p0';
    case 'P1':
      return 'aggregate_escalation_p1';
    case 'P2':
      return 'aggregate_escalation_p2';
  }
}

/**
 * 按 (primaryTopic + 日期) 聚簇并计算簇级别（单条最大级别与聚合升级取 max）。
 * 仅返回级别 ∈ {P0,P1,P2} 的簇（即需要生成预警的簇）。
 */
export function buildSentimentClusters(inputs: readonly ClusterInput[]): SentimentClusterDraft[] {
  interface MutableCluster {
    topic: string;
    date: string;
    commentIds: string[];
    negativeCount: number;
    maxSingle: AlertLevel | null;
    sourceCounts: Partial<Record<CommentSource, number>>;
    signalWords: string[];
    texts: string[];
  }

  const clusters = new Map<string, MutableCluster>();
  for (const input of inputs) {
    const topic = input.analysis.primaryTopic;
    const day = dateKey(input.publishedAt);
    const key = `${topic}|${day}`;
    let cluster = clusters.get(key);
    if (!cluster) {
      cluster = {
        topic,
        date: day,
        commentIds: [],
        negativeCount: 0,
        maxSingle: null,
        sourceCounts: {},
        signalWords: [],
        texts: [],
      };
      clusters.set(key, cluster);
    }
    cluster.commentIds.push(input.id);
    cluster.texts.push(input.text);
    cluster.sourceCounts[input.source] = (cluster.sourceCounts[input.source] ?? 0) + 1;
    if (input.analysis.sentiment === 'negative') {
      cluster.negativeCount += 1;
    }
    const singleLevel = singleToAlertLevel(input.analysis.severity);
    if (singleLevel) {
      if (!cluster.maxSingle || alertLevelRank(singleLevel) > alertLevelRank(cluster.maxSingle)) {
        cluster.maxSingle = singleLevel;
      }
    }
    for (const signal of [...P0_SIGNALS, ...P1_SIGNALS]) {
      if (input.text.includes(signal) && !cluster.signalWords.includes(signal)) {
        cluster.signalWords.push(signal);
      }
    }
  }

  const drafts: SentimentClusterDraft[] = [];
  for (const cluster of clusters.values()) {
    const aggregate = aggregateLevelFor(cluster.negativeCount);
    const candidateLevels = [cluster.maxSingle, aggregate].filter(
      (level): level is AlertLevel => level !== null,
    );
    if (candidateLevels.length === 0) {
      continue;
    }
    const level = candidateLevels.reduce((max, current) =>
      alertLevelRank(current) > alertLevelRank(max) ? current : max,
    );
    const triggerRules: AlertTriggerRule[] = [];
    if (cluster.maxSingle) {
      triggerRules.push({
        ruleId: `single_comment_${cluster.maxSingle.toLowerCase()}`,
        description: `单条评论命中 ${cluster.maxSingle} 高危信号`,
      });
    }
    if (aggregate) {
      triggerRules.push({
        ruleId: aggregateRuleId(aggregate),
        description: `同主题当日负面 ${cluster.negativeCount} 条，聚合升级至 ${aggregate}`,
      });
    }
    if (cluster.maxSingle && alertLevelRank(level) > alertLevelRank(cluster.maxSingle)) {
      triggerRules.push({
        ruleId: 'cluster_escalated',
        description: `聚合后簇级别由 ${cluster.maxSingle} 升级为 ${level}`,
      });
    }
    triggerRules.push({
      ruleId: 'cluster_by_topic_day',
      description: `按 primaryTopic + 日期聚簇：${cluster.topic} / ${cluster.date}（共 ${cluster.commentIds.length} 条评论）`,
    });

    const commentIds = [...cluster.commentIds].sort((left, right) => left.localeCompare(right));
    drafts.push({
      topic: cluster.topic,
      date: cluster.date,
      level,
      maxSingleLevel: cluster.maxSingle,
      negativeCount: cluster.negativeCount,
      totalCount: cluster.commentIds.length,
      commentIds,
      triggerRules,
      sourceCounts: cluster.sourceCounts,
      signalWords: cluster.signalWords.slice(0, 6),
    });
  }

  drafts.sort((left, right) => {
    if (left.date !== right.date) {
      return left.date.localeCompare(right.date);
    }
    const topicDiff = TOPICS.indexOf(left.topic) - TOPICS.indexOf(right.topic);
    if (topicDiff !== 0) {
      return topicDiff;
    }
    return left.topic.localeCompare(right.topic);
  });
  return drafts;
}

/** 生成预警摘要文案（模板，确定性）。 */
export function buildAlertSummary(
  draft: SentimentClusterDraft,
  comments: readonly Pick<SentimentComment, 'source'>[],
): string {
  const sourceCounts = new Map<CommentSource, number>();
  for (const comment of comments) {
    sourceCounts.set(comment.source, (sourceCounts.get(comment.source) ?? 0) + 1);
  }
  const sourceText = SOURCE_ORDER.filter((source) => (sourceCounts.get(source) ?? 0) > 0)
    .map((source) => `${source} ${sourceCounts.get(source) ?? 0}`)
    .join(' / ');
  const signalText =
    draft.signalWords.length > 0
      ? `主要信号：${draft.signalWords.slice(0, 4).join('、')}。`
      : '未见明确高危信号词，按聚簇规模升级。';
  return `${draft.date} 共 ${draft.totalCount} 条评论，负面 ${draft.negativeCount} 条（来源：${
    sourceText || '无'
  }），聚合等级 ${draft.level}。${signalText}`;
}

/** 单条评论级别 → 排序值（导出给评测/统计复用）。 */
export function severityRankOf(severity: SingleSeverity): number {
  return singleSeverityRank(severity);
}
