/**
 * 审计 off_topic 检测 — 检查意图匹配逻辑
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

// 检查 qc-0029 和 qc-0039 的意图匹配
console.log("=== qc-0029 ===");
const qc29 = qcItems.find(i => i.id === 'qc-0029')!;
for (const msg of qc29.messages) {
  const intents = intentsOf(msg.text);
  console.log(`  ${msg.role}: "${msg.text}" → intents=[${[...intents].join(',')}]`);
}

console.log("\n=== qc-0039 ===");
const qc39 = qcItems.find(i => i.id === 'qc-0039')!;
for (const msg of qc39.messages) {
  const intents = intentsOf(msg.text);
  console.log(`  ${msg.role}: "${msg.text}" → intents=[${[...intents].join(',')}]`);
}

// 检查 "已反馈给技术团队" 是否应该匹配 bug 意图
console.log("\n=== 意图匹配分析 ===");
console.log(`"已反馈给技术团队" 匹配 bug? ${matchAny("已反馈给技术团队", INTENT_GROUPS.find(g => g.key === 'bug')!.patterns)}`);
console.log(`"退款手续费是 20%" 匹配 recharge? ${matchAny("退款手续费是 20%", INTENT_GROUPS.find(g => g.key === 'recharge')!.patterns)}`);
console.log(`"退款手续费是 20%" 匹配 refund? ${matchAny("退款手续费是 20%", INTENT_GROUPS.find(g => g.key === 'refund')!.patterns)}`);
console.log(`"我多充的 328 能退吗" 匹配 recharge? ${matchAny("我多充的 328 能退吗", INTENT_GROUPS.find(g => g.key === 'recharge')!.patterns)}`);
console.log(`"我多充的 328 能退吗" 匹配 refund? ${matchAny("我多充的 328 能退吗", INTENT_GROUPS.find(g => g.key === 'refund')!.patterns)}`);
