/**
 * 详细审计 off_topic 检测逻辑
 */
import { getDatasets } from './apps/api/src/datasets.js';
import { analyzeQc } from './apps/api/src/engine/qc.js';
import { buildKnowledgeEntries } from './apps/api/src/knowledge.js';

const datasets = getDatasets();
const knowledgeEntries = buildKnowledgeEntries(datasets.knowledge.entries);
const qcItems = datasets.qc.items;

const QUESTION_PATTERN =
  /([？?]|怎么|为什么|为啥|能不能|能否|可以吗|多久|什么时候|多少钱|哪里|怎么办|如何|是否|有没有|吗|呢|请问|想问)/;

const INTENT_GROUPS = [
  { key: 'refund', patterns: [/(退款|到账|退钱|退订|扣款|没收到|未到账|退款进度|多久到)/] },
  { key: 'recharge', patterns: [/(充值|氪|648|328|首充|月卡|点券|钻石|支付|付款|礼包|订单)/] },
  { key: 'activity', patterns: [/(活动|奖励|兑换|签到|福利|抽奖|任务|限时)/] },
  { key: 'version', patterns: [/(版本|更新|新版本|维护|赛季|公告|回档)/] },
  { key: 'account', patterns: [/(封号|封禁|误封|账号|解封|被盗|盗号|登录不上)/] },
  { key: 'bug', patterns: [/(闪退|卡顿|掉线|崩溃|报错|进不去|黑屏|异常|延迟|死机|bug)/i] },
  { key: 'attitude', patterns: [/(客服|投诉|态度|工单|人工|售后|反馈)/] },
];

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

const targetIds = ['qc-0029', 'qc-0037', 'qc-0039', 'qc-0040'];

for (const id of targetIds) {
  const item = qcItems.find(i => i.id === id);
  if (!item) continue;
  console.log(`\n=== ${id} ===`);
  for (let i = 1; i < item.messages.length; i++) {
    const current = item.messages[i];
    const previous = item.messages[i - 1];
    if (current.role !== 'agent' || previous.role !== 'customer') continue;
    
    const isQ = QUESTION_PATTERN.test(previous.text);
    const custIntents = intentsOf(previous.text);
    const replyIntents = intentsOf(current.text);
    const addressed = [...custIntents].some(k => replyIntents.has(k));
    
    console.log(`  seq=${previous.seq}→${current.seq}`);
    console.log(`    客户: "${previous.text}"`);
    console.log(`    坐席: "${current.text}"`);
    console.log(`    isQuestion=${isQ} custIntents=[${[...custIntents].join(',')}] replyIntents=[${[...replyIntents].join(',')}] addressed=${addressed}`);
  }
}
