/**
 * 审计新增的 off_topic FP
 */
import { getDatasets } from './apps/api/src/datasets.js';

const datasets = getDatasets();
const qcItems = datasets.qc.items;

const targetIds = ['qc-0018', 'qc-0042', 'qc-0044', 'qc-0045', 'qc-0055'];

for (const id of targetIds) {
  const item = qcItems.find(i => i.id === id);
  if (!item) continue;
  console.log(`\n=== ${id} ===`);
  console.log(`金标: [${item.labels.tags.join(', ')}] primary=${item.labels.primaryTag} verdict=${item.labels.verdict}`);
  for (const msg of item.messages) {
    const role = msg.role === 'customer' ? '👤' : '🎧';
    console.log(`  ${role} [seq=${msg.seq}] ${msg.text}`);
  }
}
