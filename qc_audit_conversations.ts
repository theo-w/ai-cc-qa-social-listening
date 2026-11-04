/**
 * 打印 5 条不一致条目的完整对话
 */
import { getDatasets } from './apps/api/src/datasets.js';

const datasets = getDatasets();
const qcItems = datasets.qc.items;

const targetIds = ['qc-0011', 'qc-0029', 'qc-0037', 'qc-0039', 'qc-0040'];

for (const id of targetIds) {
  const item = qcItems.find(i => i.id === id);
  if (!item) continue;
  console.log(`\n=== ${id} ===`);
  console.log(`金标: [${item.labels.tags.join(', ')}] primary=${item.labels.primaryTag} verdict=${item.labels.verdict}`);
  for (const msg of item.messages) {
    const role = msg.role === 'customer' ? '👤客户' : '🎧坐席';
    console.log(`  ${role} [seq=${msg.seq}] ${msg.text}`);
  }
}
