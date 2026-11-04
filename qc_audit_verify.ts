/**
 * 验证修复后的引擎行为
 */
import { getDatasets } from './apps/api/src/datasets.js';
import { analyzeQc } from './apps/api/src/engine/qc.js';
import { buildKnowledgeEntries } from './apps/api/src/knowledge.js';

const datasets = getDatasets();
const knowledgeEntries = buildKnowledgeEntries(datasets.knowledge.entries);
const qcItems = datasets.qc.items;

const targetIds = ['qc-0037', 'qc-0040'];

for (const id of targetIds) {
  const item = qcItems.find(i => i.id === id);
  if (!item) continue;
  console.log(`\n=== ${id} ===`);
  console.log(`金标: [${item.labels.tags.join(', ')}] primary=${item.labels.primaryTag}`);
  const analysis = analyzeQc(item.messages, knowledgeEntries);
  console.log(`引擎: [${analysis.tags.map(t => t.code).join(', ')}] primary=${analysis.tags[0]?.code}`);
  for (const tag of analysis.tags) {
    console.log(`  tag: ${tag.code} ruleId=${tag.ruleId} confidence=${tag.confidence}`);
    for (const ev of tag.evidence) {
      console.log(`    evidence: ${ev.quote}`);
    }
  }
  // 打印所有对话
  console.log(`对话:`);
  for (const msg of item.messages) {
    const role = msg.role === 'customer' ? '👤' : '🎧';
    console.log(`  ${role} [seq=${msg.seq}] ${msg.text}`);
  }
}
