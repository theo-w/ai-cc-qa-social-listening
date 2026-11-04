/**
 * 详细审计：打印 5 条不一致条目的完整对话和引擎标签
 */
import { getDatasets } from './apps/api/src/datasets.js';
import { analyzeQc } from './apps/api/src/engine/qc.js';
import { buildKnowledgeEntries } from './apps/api/src/knowledge.js';
import { publishedKnowledge } from './apps/api/src/engine/knowledge.js';

const datasets = getDatasets();
const knowledgeEntries = buildKnowledgeEntries(datasets.knowledge.entries);
const published = publishedKnowledge(knowledgeEntries);
const qcItems = datasets.qc.items;

// 打印所有 wrong_knowledge 相关的条目
console.log(`\n=== 所有 wrong_knowledge 相关条目 ===`);
for (const item of qcItems) {
  const analysis = analyzeQc(item.messages, knowledgeEntries);
  const hasWK = analysis.tags.some(t => t.code === 'wrong_knowledge');
  const goldWK = item.labels.tags.includes('wrong_knowledge');
  if (hasWK || goldWK) {
    console.log(`\n--- ${item.id} ---`);
    console.log(`  金标: [${item.labels.tags.join(', ')}] primary=${item.labels.primaryTag}`);
    console.log(`  引擎: [${analysis.tags.map(t => t.code).join(', ')}] primary=${analysis.tags[0]?.code}`);
    console.log(`  引擎 wrong_knowledge 标签:`);
    for (const tag of analysis.tags) {
      if (tag.code === 'wrong_knowledge') {
        console.log(`    ruleId=${tag.ruleId} confidence=${tag.confidence}`);
        console.log(`    evidence: ${tag.evidence[0]?.quote}`);
        if (tag.knowledge) {
          console.log(`    knowledge: ${tag.knowledge.entryId}/${tag.knowledge.factKey} (${tag.knowledge.code})`);
        } else {
          console.log(`    knowledge: null (未关联)`);
        }
      }
    }
    // 打印所有坐席消息
    console.log(`  坐席消息:`);
    for (const msg of item.messages) {
      if (msg.role === 'agent') {
        console.log(`    [seq=${msg.seq}] ${msg.text}`);
      }
    }
  }
}
