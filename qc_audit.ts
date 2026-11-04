/**
 * QC 引擎审计脚本：分析 60 条金标数据中 wrong_knowledge 命中的误报/漏报根因
 */
import { getDatasets } from './apps/api/src/datasets.js';
import { analyzeQc } from './apps/api/src/engine/qc.js';
import { buildKnowledgeEntries } from './apps/api/src/knowledge.js';
import type { QcDatasetItem, QcTag } from './apps/api/src/types.js';

const datasets = getDatasets();
const knowledgeEntries = buildKnowledgeEntries(datasets.knowledge.entries);
const qcItems = datasets.qc.items;

interface Mismatch {
  itemId: string;
  goldTags: string[];
  engineTags: string[];
  goldWrongKnowledge: boolean;
  engineWrongKnowledge: boolean;
  goldPrimary: string | null;
  enginePrimary: string | null;
  reason: string;
  goldQuote?: string;
  engineQuote?: string;
}

const mismatches: Mismatch[] = [];

for (const item of qcItems) {
  const analysis = analyzeQc(item.messages, knowledgeEntries);
  
  const goldTags = item.labels.tags;
  const engineTags = analysis.tags.map(t => t.code);
  const goldWrongKnowledge = goldTags.includes('wrong_knowledge');
  const engineWrongKnowledge = analysis.tags.some(t => t.code === 'wrong_knowledge');
  const goldPrimary = item.labels.primaryTag;
  const enginePrimary = analysis.tags.length > 0 ? analysis.tags[0].code : null;
  
  // 检查 verdict 一致性
  const verdictMatch = item.labels.verdict === analysis.verdict;
  const tagsMatch = JSON.stringify(goldTags.sort()) === JSON.stringify(engineTags.sort());
  
  if (!verdictMatch || !tagsMatch) {
    // 找出不一致的原因
    let reason = '';
    if (!verdictMatch) {
      reason += `判定不一致：金标 ${item.labels.verdict}，引擎 ${analysis.verdict}`;
    }
    if (!tagsMatch) {
      if (reason) reason += '；';
      reason += `标签不一致：金标 [${goldTags.join(', ')}]，引擎 [${engineTags.join(', ')}]`;
    }
    
    // 找出不一致的标签证据
    const goldQuote = goldWrongKnowledge ? item.messages.find(m => m.role === 'agent')?.text?.slice(0, 100) : undefined;
    const engineQuote = engineWrongKnowledge ? analysis.tags.find(t => t.code === 'wrong_knowledge')?.evidence[0]?.quote : undefined;
    
    mismatches.push({
      itemId: item.id,
      goldTags,
      engineTags,
      goldWrongKnowledge,
      engineWrongKnowledge,
      goldPrimary,
      enginePrimary,
      reason,
      goldQuote,
      engineQuote,
    });
  }
}

console.log(`\n=== QC 引擎审计结果 ===`);
console.log(`总条目: ${qcItems.length}`);
console.log(`不一致: ${mismatches.length} 条`);

for (const m of mismatches) {
  console.log(`\n--- 条目 ${m.itemId} ---`);
  console.log(`  金标标签: [${m.goldTags.join(', ')}]`);
  console.log(`  引擎标签: [${m.engineTags.join(', ')}]`);
  console.log(`  金标 wrong_knowledge: ${m.goldWrongKnowledge}`);
  console.log(`  引擎 wrong_knowledge: ${m.engineWrongKnowledge}`);
  console.log(`  金标主标签: ${m.goldPrimary}`);
  console.log(`  引擎主标签: ${m.enginePrimary}`);
  console.log(`  原因: ${m.reason}`);
  if (m.goldQuote) console.log(`  金标坐席消息: ${m.goldQuote}`);
  if (m.engineQuote) console.log(`  引擎命中: ${m.engineQuote}`);
}

// 统计 wrong_knowledge 命中的 precision/recall
let tp = 0, fp = 0, fn = 0, tn = 0;
for (const item of qcItems) {
  const analysis = analyzeQc(item.messages, knowledgeEntries);
  const engineWrongKnowledge = analysis.tags.some(t => t.code === 'wrong_knowledge');
  const goldWrongKnowledge = item.labels.tags.includes('wrong_knowledge');
  
  if (goldWrongKnowledge && engineWrongKnowledge) tp++;
  else if (!goldWrongKnowledge && engineWrongKnowledge) fp++;
  else if (goldWrongKnowledge && !engineWrongKnowledge) fn++;
  else tn++;
}

console.log(`\n=== wrong_knowledge 混淆矩阵 ===`);
console.log(`TP: ${tp}, FP: ${fp}, FN: ${fn}, TN: ${tn}`);
console.log(`Precision: ${(tp / (tp + fp)).toFixed(4)}`);
console.log(`Recall: ${(tp / (tp + fn)).toFixed(4)}`);
