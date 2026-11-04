/**
 * 追踪 detectOffTopic 逻辑
 */
import { getDatasets } from './apps/api/src/datasets.js';

const datasets = getDatasets();
const qcItems = datasets.qc.items;

const INTENT_GROUPS = [
  { key: 'refund', patterns: [/(退款|到账|退钱|退订|扣款|没收到|未到账|退款进度|多久到)/] },
  { key: 'recharge', patterns: [/(充值|氪|648|328|首充|月卡|点券|钻石|支付|付款|礼包|订单)/] },
  { key: 'activity', patterns: [/(活动|奖励|兑换|签到|福利|抽奖|任务|限时)/] },
  { key: 'version', patterns: [/(版本|更新|新版本|维护|赛季|公告|回档)/] },
  { key: 'account', patterns: [/(封号|封禁|误封|账号|解封|被盗|盗号|登录不上)/] },
  { key: 'bug', patterns: [/(闪退|卡顿|掉线|崩溃|报错|进不去|黑屏|异常|延迟|死机|bug|反馈|技术团队|正在处理)/i] },
  { key: 'attitude', patterns: [/(客服|投诉|态度|工单|人工|售后|反馈)/] },
];

const QUESTION_PATTERN =
  /([？?]|怎么|为什么|为啥|能不能|能否|可以吗|多久|什么时候|多少钱|哪里|怎么办|如何|是否|有没有|吗|呢|请问|想问|我问的是|具体一点|能说明|能解释)/;

const GENERIC_REPLY_PATTERN =
  /^(好的|好呢|收到|感谢您的反馈|感谢反馈|感谢您的支持|请稍等|稍等|已记录|已反馈|会尽快处理|请您耐心等待|请您稍后再试|您可以查看公告|请关注.{0,6}公告|亲|您好|在的|嗯嗯|稍后回复|祝您|.*请关注游戏内公告)/;

const CLOSING_REPLY_PATTERN =
  /(感谢您的支持|祝您游戏愉快|祝您生活愉快|再见|请关注.{0,8}公告|关注游戏内公告|以公告为准|公告里都有|请耐心等待|先看.{0,6}公告|看公告|去公告|看规则|看活动规则)/;

function matchAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some(p => p.test(text));
}

function intentsOf(text: string): Set<string> {
  const keys = new Set<string>();
  for (const group of INTENT_GROUPS) {
    if (matchAny(text, group.patterns)) {
      keys.add(group.key);
    }
  }
  return keys;
}

const item = qcItems.find(i => i.id === 'qc-0037')!;

console.log("=== qc-0037 详细追踪 ===\n");

for (let i = 1; i < item.messages.length; i++) {
  const current = item.messages[i];
  const previous = item.messages[i - 1];
  
  console.log(`--- Exchange ${i} (seq ${previous.seq}→${current.seq}) ---`);
  console.log(`  Customer: "${previous.text}"`);
  console.log(`  Agent: "${current.text}"`);
  
  if (current.role !== 'agent' || previous.role !== 'customer') {
    console.log(`  SKIP: not agent/customer pair`);
    continue;
  }
  
  const isQ = QUESTION_PATTERN.test(previous.text);
  console.log(`  isQuestion: ${isQ}`);
  
  if (!isQ) {
    console.log(`  SKIP: not a question`);
    continue;
  }
  
  const custIntents = intentsOf(previous.text);
  const replyIntents = intentsOf(current.text);
  console.log(`  customer intents: [${[...custIntents].join(', ')}]`);
  console.log(`  reply intents: [${[...replyIntents].join(', ')}]`);
  
  const addressed = [...custIntents].some((key) => replyIntents.has(key));
  console.log(`  addressed: ${addressed}`);
  
  if (addressed) {
    console.log(`  SKIP: addressed`);
    continue;
  }
  
  if (replyIntents.size > 0) {
    console.log(`  HIT: off_topic (reply has intents but not addressed)`);
    continue;
  }
  
  if (replyIntents.size === 0) {
    const isGeneric = GENERIC_REPLY_PATTERN.test(current.text.trim());
    console.log(`  isGenericReply: ${isGeneric}`);
    if (isGeneric) {
      const isClosing = CLOSING_REPLY_PATTERN.test(current.text);
      console.log(`  isClosing: ${isClosing}`);
    }
  }
}
