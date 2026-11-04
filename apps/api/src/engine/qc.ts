/**
 * 质检规则引擎（确定性，rule-engine-v0.3.0）。
 *
 * 实现 specs/007 §2 的六条规则：
 * - R-QC-ATT 服务态度：辱骂/人身攻击、嘲讽反问、指责、驱赶、明显不耐烦
 * - R-QC-FOR 违规话术：索评、站外/私下交易、绝对化承诺、泄露隐私、诱导充值返利
 * - R-QC-OFF 答非所问：用户问题与坐席回答意图不匹配、模板回复、连续多轮未回应核心诉求
 * - R-QC-KNW 知识错误：与知识库事实冲突的费率/比例/活动时间/退款规则/版本信息陈述
 * - R-QC-TIM 响应超时：坐席回复间隔 > 180 秒（用户未结束会话）
 * - R-QC-ESC 情绪升级：用户由平静转为愤怒，或提出投诉/曝光/监管/退游/退款升级
 *
 * 置信度：强信号 0.9，多命中可小幅提升；隐晦/边界信号 0.6-0.74（触发人工复核）。
 * 证据 `quote` 均为原文子串（≤60 字），`seq` 可在会话中定位。
 * 引擎不使用 Date.now()/随机数/数据金标标签，同一输入输出完全一致。
 */
import { REVIEW_CONFIDENCE_THRESHOLD } from '../config.js';
import type {
  Emotion,
  Evidence,
  KnowledgeEntry,
  KnowledgeRef,
  QcAnalysis,
  QcTag,
  Severity,
  TagCode,
  Verdict,
} from '../types.js';
import { detectKnowledgeHits, knowledgeRefFromMatch, matchKnowledge } from './knowledge.js';
import { TAG_MAP, maxSeverity, severityRank } from './taxonomy.js';

export interface QcInputMessage {
  seq: number;
  role: 'customer' | 'agent' | 'system';
  text: string;
  atSec: number;
}

interface RuleHit {
  tag: TagCode;
  confidence: number;
  ruleId: string;
  seq: number;
  quote: string;
  note: string;
  knowledge?: KnowledgeRef;
}

interface TagBucket {
  tag: TagCode;
  confidence: number;
  ruleId: string;
  evidence: Evidence[];
  knowledge?: KnowledgeRef;
}

interface WeakSignal {
  note: string;
}

const TIMEOUT_SECONDS = 180;
const TIMEOUT_HARD_SECONDS = 300;
const MAX_QUOTE_LENGTH = 60;

function clipQuote(text: string): string {
  const normalized = text.trim();
  if (normalized.length <= MAX_QUOTE_LENGTH) {
    return normalized;
  }
  return normalized.slice(0, MAX_QUOTE_LENGTH);
}

/** 匹配任意模式；返回命中模式说明。 */
function matchAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}

function agentMessages(messages: readonly QcInputMessage[]): QcInputMessage[] {
  return messages.filter((message) => message.role === 'agent');
}

function customerMessages(messages: readonly QcInputMessage[]): QcInputMessage[] {
  return messages.filter((message) => message.role === 'customer');
}

/* ------------------------------ R-QC-TIM 响应超时 ------------------------------ */

const END_INTENT_PATTERN = /(不用了|算了|没事了|没事|谢谢|就这样|结束了|没有问题|没问题了|先这样)/;

function detectTimeout(messages: readonly QcInputMessage[]): RuleHit[] {
  const hits: RuleHit[] = [];
  for (let index = 1; index < messages.length; index += 1) {
    const current = messages[index];
    const previous = messages[index - 1];
    if (!current || !previous) {
      continue;
    }
    if (current.role !== 'agent' || previous.role !== 'customer') {
      continue;
    }
    // 用户刚表达"可以结束了"（如谢谢/不用了）后，坐席再慢回复不计超时。
    if (END_INTENT_PATTERN.test(previous.text)) {
      continue;
    }
    const gapSec = current.atSec - previous.atSec;
    if (gapSec <= TIMEOUT_SECONDS) {
      continue;
    }
    const confidence = gapSec >= TIMEOUT_HARD_SECONDS ? 0.9 : 0.72;
    hits.push({
      tag: 'timeout',
      confidence,
      ruleId: 'R-QC-TIM',
      seq: current.seq,
      quote: clipQuote(current.text),
      note:
        gapSec >= TIMEOUT_HARD_SECONDS
          ? `客户等待 ${gapSec}s 后坐席才回复（阈值 180s）`
          : `客户等待 ${gapSec}s，接近/超过 180s 阈值`,
    });
  }
  return hits;
}

/* ------------------------------ R-QC-ATT 服务态度 ------------------------------ */

interface AttitudePattern {
  ruleId: string;
  confidence: number;
  note: string;
  patterns: readonly RegExp[];
  excludePatterns?: readonly RegExp[];
}

const ATTITUDE_PATTERNS: readonly AttitudePattern[] = [
  {
    ruleId: 'R-QC-ATT-01',
    confidence: 0.9,
    note: '坐席使用辱骂/人身攻击类表达',
    patterns: [
      /(傻[逼比xX]?|蠢|笨蛋|白痴|有病|废物|垃圾|神经病|脑残|智障|滚蛋|滚开|闭嘴|闭嘴吧|没长眼|眼瞎)/,
    ],
  },
  {
    ruleId: 'R-QC-ATT-02',
    confidence: 0.88,
    note: '坐席使用嘲讽反问问句',
    patterns: [
      /(你不会看|不会看吗|不会看么|不会看一下|这都看不出来|这都不懂|这都不知道|自己不会|还用问|问这么多|看都不会|都说了几遍|都说了多少遍|说了多少遍|说了几次|说了几遍|烦不烦|别催了|别催|早就说了|自己看|自己找|这还用问|不懂吗|不明白吗|很难理解吗)/,
    ],
  },
  {
    ruleId: 'R-QC-ATT-03',
    confidence: 0.86,
    note: '坐席将问题归咎于用户',
    patterns: [/(你的问题|你自己操作|怪谁|谁让你|不是我的错|跟我没关系|别问我|不关我事|自己弄错|是你自己)/],
  },
  {
    ruleId: 'R-QC-ATT-04',
    confidence: 0.88,
    note: '坐席使用驱赶/推脱类表达',
    patterns: [
      /(爱要不要|不买拉倒|随便你|随便您|爱咋咋|别来了|不管了|你自己看着办|你爱怎么想|爱信不信)/,
    ],
  },
  {
    ruleId: 'R-QC-ATT-05',
    confidence: 0.84,
    note: '坐席表现出明显不耐烦/反向指责',
    patterns: [
      /(说了多少遍了|到底要我说几遍|真的很烦|有完没完|别老问|烦死|急什么急|说话客气)/,
    ],
  },
];

function detectAttitude(messages: readonly QcInputMessage[]): RuleHit[] {
  const hits: RuleHit[] = [];
  for (const message of agentMessages(messages)) {
    for (const rule of ATTITUDE_PATTERNS) {
      if (matchAny(message.text, rule.patterns)) {
        hits.push({
          tag: 'attitude',
          confidence: rule.confidence,
          ruleId: rule.ruleId,
          seq: message.seq,
          quote: clipQuote(message.text),
          note: rule.note,
        });
        break;
      }
    }
  }
  return hits;
}

/* ------------------------------ R-QC-FOR 违规话术 ------------------------------ */

const FORBIDDEN_PATTERNS: readonly AttitudePattern[] = [
  {
    ruleId: 'R-QC-FOR-01',
    confidence: 0.9,
    note: '坐席索要好评/评价（违规话术）',
    patterns: [
      /(给个?好评|求好评|好评返现|五星好评|写个好评|帮忙(给个)?评价|麻烦(给个)?评价|评价一下|给个五星|点个好评|晒图好评)/,
    ],
  },
  {
    ruleId: 'R-QC-FOR-02',
    confidence: 0.9,
    note: '坐席引导站外/私下交易',
    patterns: [
      /(加我微信|加微信|微信号|加我qq|加qq|qq群|私聊|私下交易|私下解决|私下转账|站外交易|站外平台|加v|vx|支付宝转账|转账给我|线下交易|私单|走私人)/i,
    ],
  },
  {
    ruleId: 'R-QC-FOR-03',
    confidence: 0.88,
    note: '坐席给出绝对化承诺',
    patterns: [/(百分百|100%|包退|包治|保证解决|一定能|绝对能|绝对可以|万能|永久解决|无条件退款|绝不翻车)/],
  },
  {
    ruleId: 'R-QC-FOR-04',
    confidence: 0.9,
    note: '坐席泄露其他用户隐私',
    patterns: [/(其他用户|别的用户|别人信息|他的电话|他的地址|另一个客户|其他玩家信息|后台看到其他)/],
  },
  {
    ruleId: 'R-QC-FOR-05',
    confidence: 0.88,
    note: '坐席诱导充值/返利',
    patterns: [
      /(充值返利|返利给你|返现给你|私下返利|走内部渠道|内部渠道充值|低价代充|代充|多充多送|充值就送|再充一点|再氪|帮你走内部)/,
    ],
  },
];

function detectForbidden(messages: readonly QcInputMessage[]): RuleHit[] {
  const hits: RuleHit[] = [];
  for (const message of agentMessages(messages)) {
    for (const rule of FORBIDDEN_PATTERNS) {
      if (matchAny(message.text, rule.patterns)) {
        hits.push({
          tag: 'forbidden',
          confidence: rule.confidence,
          ruleId: rule.ruleId,
          seq: message.seq,
          quote: clipQuote(message.text),
          note: rule.note,
        });
        break;
      }
    }
  }
  return hits;
}

/* ------------------------------ R-QC-KNW 知识错误 ------------------------------ */

const KNOWLEDGE_PATTERNS: readonly AttitudePattern[] = [
  {
    ruleId: 'R-QC-KNW-01',
    confidence: 0.9,
    note: '退款规则陈述与知识库冲突',
    patterns: [
      /(不能退款|不支持退款|无法退款|退不了款|概不退款|一律不退|退款不可能|退款要扣|退款手续费|退款服务费)/,
    ],
  },
  {
    ruleId: 'R-QC-KNW-02',
    confidence: 0.88,
    note: '返还比例/费率陈述与知识库冲突',
    patterns: [/(返还比例|返利比例|退还比例).{0,8}(\d{1,3})\s*%|(\d{1,3})\s*%.{0,6}(返还|返利|退还|手续费)/],
  },
  {
    ruleId: 'R-QC-KNW-03',
    confidence: 0.88,
    note: '活动时间陈述与知识库冲突',
    patterns: [
      /(活动|奖励|发放|兑换).{0,12}(提前结束|已经结束|已经下架|改到|延迟到|不再发放|取消发放|三天内|半个月)/,
      /(活动时间|活动周期).{0,8}(改|调整|延长|缩短)/,
    ],
  },
  {
    ruleId: 'R-QC-KNW-04',
    confidence: 0.88,
    note: '版本信息陈述与知识库冲突',
    patterns: [
      /(当前版本|版本号|最新版本).{0,10}(不是|没有|还没|不存在|已经下架|回退)/,
      /(1\.\d+\.\d+).{0,10}(版本|更新)/,
    ],
  },
  {
    ruleId: 'R-QC-KNW-05',
    confidence: 0.86,
    note: '账号/封禁规则陈述与事实冲突',
    patterns: [
      /(封号|封禁|误封).{0,8}(不可能|不会|绝对没有|不存在|自己找原因)/,
      /(外挂|挂).{0,6}(不存在|没有|不可能有|管不了)/,
      /(回档|数据丢失).{0,8}(不会|不可能|不存在)/,
    ],
  },
  {
    ruleId: 'R-QC-KNW-06',
    confidence: 0.86,
    note: '付费规则陈述与知识库冲突',
    patterns: [/(必须|只能|需要).{0,6}(充值|付费|氪金).{0,8}(才能|才可以|方可)/],
  },
  {
    ruleId: 'R-QC-KNW-07',
    confidence: 0.86,
    note: '退款到账时长陈述与知识库（24 小时内原路退回）冲突',
    patterns: [/(退款|退钱|退款申请|退到).{0,12}(\d{1,2})\s*个?\s*工作日/],
  },
  {
    ruleId: 'R-QC-KNW-08',
    confidence: 0.88,
    note: '返还比例/费率陈述与知识库冲突',
    patterns: [
      /(首充|返利|返还|返).{0,8}(\d{1,3})\s*%/,
      /(\d{1,3})\s*%.{0,6}(返利|返还|退还)/,
    ],
    excludePatterns: [
      // 排除违规语境：私下/内部返利不属于知识错误，而是违规话术（由 forbidden 规则覆盖）。
      /私下|内部(?!返利)|别走官方|内部渠道|私下操作/,
    ],
  },
  {
    ruleId: 'R-QC-KNW-09',
    confidence: 0.86,
    note: '活动每日免费次数陈述与知识库（每天 1 次）冲突',
    patterns: [/每天\s*[2-9]\s*次/],
  },
  {
    ruleId: 'R-QC-KNW-10',
    confidence: 0.82,
    note: '版本上线日期陈述与官方公告冲突',
    patterns: [
      /(11\s*月\s*30\s*日).{0,10}(上线|发布|更新)/,
      /(公告是旧的|以我说的为准)/,
    ],
  },
];

function detectWrongKnowledge(messages: readonly QcInputMessage[]): RuleHit[] {
  const hits: RuleHit[] = [];
  for (const message of agentMessages(messages)) {
    for (const rule of KNOWLEDGE_PATTERNS) {
      if (!matchAny(message.text, rule.patterns)) {
        continue;
      }
      // 排除模式：命中排除模式则跳过（如违规语境由 forbidden 覆盖）。
      if (rule.excludePatterns && matchAny(message.text, rule.excludePatterns)) {
        continue;
      }
      hits.push({
        tag: 'wrong_knowledge',
        confidence: rule.confidence,
        ruleId: rule.ruleId,
        seq: message.seq,
        quote: clipQuote(message.text),
        note: rule.note,
      });
      break;
    }
  }
  return hits;
}

/* ------------------------------ R-QC-OFF 答非所问 ------------------------------ */

interface IntentGroup {
  key: string;
  label: string;
  patterns: readonly RegExp[];
}

const INTENT_GROUPS: readonly IntentGroup[] = [
  {
    key: 'refund',
    label: '退款/到账',
    patterns: [/(退款|到账|退钱|退订|扣款|没收到|未到账|退款进度|多久到)/],
  },
  {
    key: 'recharge',
    label: '充值/支付',
    patterns: [/(充值|氪|648|328|首充|月卡|点券|钻石|支付|付款|礼包|订单)/],
  },
  {
    key: 'activity',
    label: '活动/奖励',
    patterns: [/(活动|奖励|兑换|签到|福利|抽奖|任务|限时)/],
  },
  {
    key: 'version',
    label: '版本/更新',
    patterns: [/(版本|更新|新版本|维护|赛季|公告|回档)/],
  },
  {
    key: 'account',
    label: '账号/封禁',
    patterns: [/(封号|封禁|误封|账号|解封|被盗|盗号|登录不上)/],
  },
  {
    key: 'bug',
    label: '故障/Bug',
    patterns: [/(闪退|卡顿|掉线|崩溃|报错|进不去|黑屏|异常|延迟|死机|bug|反馈|技术团队|正在处理)/i],
  },
  {
    key: 'attitude',
    label: '客服/投诉',
    patterns: [/(客服|投诉|态度|工单|人工|售后|反馈)/],
  },
];

/** 意图关联映射：充值与退款互为关联意图（如"充值退款"问题）。 */
const RELATED_INTENTS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['recharge', new Set(['refund'])],
  ['refund', new Set(['recharge'])],
]);

const QUESTION_PATTERN =
  /([？?]|怎么|为什么|为啥|能不能|能否|可以吗|多久|什么时候|多少钱|哪里|怎么办|如何|是否|有没有|吗|呢|请问|想问|我问的是|具体一点|能说明|能解释)/;

const GENERIC_REPLY_PATTERN =
  /^(好的|好呢|收到|感谢您的反馈|感谢反馈|感谢您的支持|请稍等|稍等|已记录|已反馈|会尽快处理|请您耐心等待|请您稍后再试|您可以查看公告|请关注.{0,6}公告|亲|您好|在的|嗯嗯|稍后回复|祝您|.*请关注游戏内公告)/;

/** "结束/回避型"模板回复：在用户核心诉求未解决时视为答非所问。 */
const CLOSING_REPLY_PATTERN =
  /(感谢您的支持|祝您游戏愉快|祝您生活愉快|再见|请关注.{0,8}公告|关注游戏内公告|以公告为准|公告里都有|请耐心等待|先看.{0,6}公告|看公告|去公告|看规则|看活动规则)/;

function intentsOf(text: string): Set<string> {
  const keys = new Set<string>();
  for (const group of INTENT_GROUPS) {
    if (matchAny(text, group.patterns)) {
      keys.add(group.key);
    }
  }
  // 扩展关联意图：如充值↔退款互为关联。
  const expanded = new Set<string>(keys);
  for (const key of keys) {
    const related = RELATED_INTENTS.get(key);
    if (related) {
      for (const r of related) {
        expanded.add(r);
      }
    }
  }
  return expanded;
}

function isQuestion(text: string): boolean {
  return QUESTION_PATTERN.test(text);
}

function isGenericReply(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length <= 30 && GENERIC_REPLY_PATTERN.test(trimmed);
}

interface OffTopicResult {
  hits: RuleHit[];
  weakSignals: WeakSignal[];
}

function detectOffTopic(messages: readonly QcInputMessage[]): OffTopicResult {
  const hits: RuleHit[] = [];
  const weakSignals: WeakSignal[] = [];
  const consecutive: number[] = [];
  let lastCustomerIntents: Set<string> = new Set();

  for (let index = 1; index < messages.length; index += 1) {
    const current = messages[index];
    const previous = messages[index - 1];
    if (!current || !previous) {
      continue;
    }
    if (current.role !== 'agent' || previous.role !== 'customer') {
      continue;
    }
    if (!isQuestion(previous.text)) {
      continue;
    }
    const customerIntents = intentsOf(previous.text);
    // 当前客户消息无意图关键词时，沿用上一轮客户意图（处理澄清型追问）。
    const effectiveIntents = customerIntents.size > 0 ? customerIntents : lastCustomerIntents;
    if (effectiveIntents.size === 0) {
      continue;
    }
    // 更新上一轮客户意图（仅当当前消息有意图时）。
    if (customerIntents.size > 0) {
      lastCustomerIntents = customerIntents;
    }
    const replyIntents = intentsOf(current.text);
    const addressed = [...effectiveIntents].some((key) => replyIntents.has(key));
    if (addressed) {
      consecutive.length = 0;
      continue;
    }
    if (replyIntents.size > 0) {
      hits.push({
        tag: 'off_topic',
        confidence: 0.82,
        ruleId: 'R-QC-OFF-01',
        seq: current.seq,
        quote: clipQuote(current.text),
        note: '用户诉求主题与坐席回答主题不一致',
      });
      consecutive.push(current.seq);
      continue;
    }
    if (isGenericReply(current.text)) {
      consecutive.push(current.seq);
      if (CLOSING_REPLY_PATTERN.test(current.text)) {
        hits.push({
          tag: 'off_topic',
          confidence: 0.72,
          ruleId: 'R-QC-OFF-02',
          seq: current.seq,
          quote: clipQuote(current.text),
          note: '用户核心诉求未解决，坐席以结束语/公告模板回避',
        });
      } else if (consecutive.length >= 2) {
        hits.push({
          tag: 'off_topic',
          confidence: 0.86,
          ruleId: 'R-QC-OFF-03',
          seq: current.seq,
          quote: clipQuote(current.text),
          note: '连续多轮未回应核心诉求',
        });
      }
      continue;
    }
    // 回答了内容但与用户主题无交集：弱信号（供低置信度复核）。
    weakSignals.push({ note: '坐席回复与用户诉求疑似不匹配' });
  }
  return { hits, weakSignals };
}

/* ------------------------------ R-QC-ESC 情绪升级 ------------------------------ */

const ESCALATION_STRONG =
  /(投诉|12315|黑猫|曝光|举报|起诉|律师|维权|退游|弃游|卸载|退款潮|媒体|上热搜|找媒体|监管)/;
const ESCALATION_ANGRY =
  /(太失望|失望透顶|气死|恶心|垃圾|骗子|坑钱|什么玩意|无语|离谱|过分|再也不|垃圾游戏|差评|忍不了|受够了|烦死了)/;

function detectEscalation(messages: readonly QcInputMessage[]): { hits: RuleHit[]; angry: boolean } {
  const hits: RuleHit[] = [];
  const customer = customerMessages(messages);
  const firstCustomer = customer[0];
  const earlyCalm =
    firstCustomer !== undefined &&
    !ESCALATION_STRONG.test(firstCustomer.text) &&
    !ESCALATION_ANGRY.test(firstCustomer.text);
  let angry = false;

  for (const message of customer) {
    if (ESCALATION_ANGRY.test(message.text)) {
      angry = true;
    }
    // 用户"举报外挂/投诉作弊"属于正常举报诉求，不视为情绪升级（边界正常样本）。
    const isCheatReport =
      /(举报|投诉|反馈).{0,12}(外挂|开挂|作弊|脚本|科技|自动瞄准|自瞄|透视)/.test(message.text) &&
      !ESCALATION_ANGRY.test(message.text);
    if (ESCALATION_STRONG.test(message.text) && !isCheatReport) {
      const transitioned = earlyCalm && message !== firstCustomer;
      hits.push({
        tag: 'escalation',
        confidence: transitioned || earlyCalm ? 0.88 : 0.9,
        ruleId: 'R-QC-ESC-01',
        seq: message.seq,
        quote: clipQuote(message.text),
        note: '用户提出投诉/曝光/维权等升级诉求',
      });
      continue;
    }
    if (earlyCalm && message !== firstCustomer && ESCALATION_ANGRY.test(message.text)) {
      hits.push({
        tag: 'escalation',
        confidence: 0.8,
        ruleId: 'R-QC-ESC-02',
        seq: message.seq,
        quote: clipQuote(message.text),
        note: '用户情绪由平静转为愤怒（情绪升级）',
      });
    }
  }
  return { hits, angry };
}

/* ------------------------------ 组装 ------------------------------ */

function mergeHits(hits: readonly RuleHit[]): TagBucket[] {
  const buckets = new Map<TagCode, TagBucket>();
  for (const hit of hits) {
    const existing = buckets.get(hit.tag);
    if (!existing) {
      buckets.set(hit.tag, {
        tag: hit.tag,
        confidence: hit.confidence,
        ruleId: hit.ruleId,
        evidence: [{ seq: hit.seq, quote: hit.quote, note: hit.note }],
        ...(hit.knowledge ? { knowledge: hit.knowledge } : {}),
      });
      continue;
    }
    if (hit.confidence > existing.confidence) {
      existing.confidence = hit.confidence;
      existing.ruleId = hit.ruleId;
      if (hit.knowledge) {
        existing.knowledge = hit.knowledge;
      }
    } else if (!existing.knowledge && hit.knowledge) {
      existing.knowledge = hit.knowledge;
    }
    if (
      existing.evidence.length < 3 &&
      !existing.evidence.some((evidence) => evidence.seq === hit.seq && evidence.quote === hit.quote)
    ) {
      existing.evidence.push({ seq: hit.seq, quote: hit.quote, note: hit.note });
    }
  }
  return [...buckets.values()];
}

function buildTags(buckets: readonly TagBucket[]): QcTag[] {
  const tags: QcTag[] = buckets.map((bucket) => {
    const meta = TAG_MAP[bucket.tag];
    return {
      code: bucket.tag,
      name: meta.name,
      severity: meta.severity,
      confidence: Math.round(bucket.confidence * 100) / 100,
      evidence: bucket.evidence,
      ruleId: bucket.ruleId,
      knowledge: bucket.knowledge ?? null,
    };
  });
  tags.sort((left, right) => {
    const severityDiff = severityRank(right.severity) - severityRank(left.severity);
    if (severityDiff !== 0) {
      return severityDiff;
    }
    const confidenceDiff = right.confidence - left.confidence;
    if (confidenceDiff !== 0) {
      return confidenceDiff;
    }
    return left.code.localeCompare(right.code);
  });
  return tags;
}

function scoreForTags(tags: readonly QcTag[]): number {
  const total = tags.reduce((sum, tag) => sum + TAG_MAP[tag.code].weight, 0);
  return Math.max(0, Math.min(100, 100 - total));
}

function detectEmotion(messages: readonly QcInputMessage[], angryFromEscalation: boolean): Emotion {
  const customer = customerMessages(messages);
  const angry = angryFromEscalation || customer.some((message) => ESCALATION_ANGRY.test(message.text));
  if (angry) {
    return 'angry';
  }
  const anxious = customer.some((message) =>
    /(急|等|催|多久|还没|怎么还没|什么时候|快点|尽快|着急|到底)/.test(message.text),
  );
  if (anxious) {
    return 'anxious';
  }
  return 'calm';
}

const TAG_SUGGESTION: Record<TagCode, string> = {
  attitude: '话术培训与主管复盘',
  forbidden: '违规话术专项治理',
  off_topic: '知识库与流程对齐',
  wrong_knowledge: '知识库修订并复测',
  timeout: '排班与响应时效治理',
  escalation: '客诉预警与安抚流程',
};

const EMOTION_LABEL: Record<Emotion, string> = {
  calm: '平静',
  anxious: '焦虑',
  angry: '愤怒',
};

function buildSummary(
  tags: readonly QcTag[],
  emotion: Emotion,
  weakSignals: readonly WeakSignal[],
): string {
  const emotionText = `客户情绪${EMOTION_LABEL[emotion]}`;
  if (tags.length > 0) {
    const names = tags.map((tag) => tag.name).join('、');
    const suggestions = [...new Set(tags.map((tag) => TAG_SUGGESTION[tag.code]))].join('；');
    const firstNote = tags[0]?.evidence[0]?.note ?? '';
    return `${emotionText}；命中 ${tags.length} 个标签：${names}${firstNote ? `（${firstNote}）` : ''}。建议：${suggestions}。`;
  }
  if (weakSignals.length > 0) {
    return `${emotionText}；未命中违规标签，但存在 ${weakSignals.length} 处边界信号，建议人工复核确认。`;
  }
  return `${emotionText}；未命中违规标签，坐席按流程回应。`;
}

function computeConfidence(tags: readonly QcTag[], weakSignalCount: number): number {
  if (tags.length === 0) {
    return weakSignalCount > 0 ? 0.72 : 0.88;
  }
  // 总体置信度取各标签置信度最小值：任一维度不确定即整体需人工复核（FR-QC-005）。
  const minConfidence = Math.min(...tags.map((tag) => tag.confidence));
  return Math.round(minConfidence * 100) / 100;
}

/**
 * 对一段客服会话执行质检（纯函数，确定性）。
 *
 * `knowledgeEntries` 为运行态知识库；只有 published 条目会参与 wrong_knowledge 判定。
 * 未提供知识库时退化为 v0.1 的纯规则行为，保证评测/单测可独立运行。
 */
export function analyzeQc(
  messages: readonly QcInputMessage[],
  knowledgeEntries: readonly KnowledgeEntry[] = [],
): QcAnalysis {
  if (messages.length === 0) {
    return {
      score: 100,
      verdict: 'pass',
      tags: [],
      summary: '空会话，未命中违规标签。',
      emotion: 'calm',
      confidence: 0.9,
      needsReview: false,
    };
  }

  const timeoutHits = detectTimeout(messages);
  const attitudeHits = detectAttitude(messages);
  const forbiddenHits = detectForbidden(messages);
  const staticKnowledgeHits = detectWrongKnowledge(messages);
  const offTopicResult = detectOffTopic(messages);
  const escalationResult = detectEscalation(messages);

  // 知识库优先：能覆盖的旧规则命中由已发布事实裁决；KB 也能新增旧规则未覆盖的命中。
  const resolvedKnowledgeHits: RuleHit[] = [];
  const coveredFacts = new Set<string>();
  for (const hit of staticKnowledgeHits) {
    const match = matchKnowledge(hit.quote, knowledgeEntries);
    if (match === null) {
      resolvedKnowledgeHits.push(hit);
      continue;
    }
    if (match.violation === false) {
      // 知识库判定合规：丢弃旧规则误报。
      continue;
    }
    const knowledge = knowledgeRefFromMatch(match, hit.ruleId);
    coveredFacts.add(`${knowledge.entryId}|${knowledge.factKey}`);
    resolvedKnowledgeHits.push({ ...hit, knowledge });
  }
  const kbOnlyHits: RuleHit[] = detectKnowledgeHits(messages, knowledgeEntries)
    .filter((hit) => !coveredFacts.has(`${hit.ref.entryId}|${hit.ref.factKey}`))
    .map((hit) => ({
      tag: 'wrong_knowledge',
      confidence: hit.confidence,
      ruleId: hit.ruleId,
      seq: hit.seq,
      quote: hit.quote,
      note: hit.note,
      knowledge: hit.ref,
    }));

  const weakSignals: WeakSignal[] = [...offTopicResult.weakSignals];
  const allHits: RuleHit[] = [
    ...timeoutHits,
    ...attitudeHits,
    ...forbiddenHits,
    ...resolvedKnowledgeHits,
    ...kbOnlyHits,
    ...offTopicResult.hits,
    ...escalationResult.hits,
  ];

  const buckets = mergeHits(allHits);
  const tags = buildTags(buckets);
  const verdict: Verdict = tags.length > 0 ? 'violation' : 'pass';
  const emotion = detectEmotion(messages, escalationResult.angry);

  // 轻微负面情绪但未构成升级：作为 pass 的边界信号。
  if (tags.length === 0) {
    const customer = customerMessages(messages);
    if (customer.some((message) => ESCALATION_ANGRY.test(message.text))) {
      weakSignals.push({ note: '用户存在负面情绪表达' });
    }
    // 轻微超时（阈值内但接近阈值）也作为边界信号。
    for (let index = 1; index < messages.length; index += 1) {
      const current = messages[index];
      const previous = messages[index - 1];
      if (!current || !previous) {
        continue;
      }
      if (current.role === 'agent' && previous.role === 'customer') {
        const gapSec = current.atSec - previous.atSec;
        if (gapSec > 120 && gapSec <= TIMEOUT_SECONDS) {
          weakSignals.push({ note: `回复间隔 ${gapSec}s 接近超时阈值` });
        }
      }
    }
  }

  const confidence = computeConfidence(tags, weakSignals.length);
  const needsReview = confidence < REVIEW_CONFIDENCE_THRESHOLD;

  return {
    score: scoreForTags(tags),
    verdict,
    tags,
    summary: buildSummary(tags, emotion, weakSignals),
    emotion,
    confidence,
    needsReview,
  };
}

/** 由质检结果推导最高严重级别（badcase severity / 列表展示）。 */
export function highestSeverity(tags: readonly QcTag[]): Severity {
  if (tags.length === 0) {
    return 'low';
  }
  return maxSeverity(tags.map((tag) => tag.severity));
}
