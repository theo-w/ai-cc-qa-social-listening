/**
 * CLI：离线回放两个数据集并打印指标（不写运行态）。
 * 用法：pnpm --filter @qcc/api eval
 */
import { getDatasets } from '../datasets.js';
import { evaluateDataset } from '../eval/run.js';
import { ensureStore } from '../store.js';

async function main(): Promise<void> {
  const { store } = await ensureStore();
  const datasets = getDatasets();
  console.log(`[qcc:eval] dataset=${store.datasetVersion} 现有评测记录 ${store.evalRuns.length} 条`);

  for (const dataset of ['qc', 'sentiment'] as const) {
    const result = evaluateDataset(dataset, datasets);
    console.log(`\n=== ${dataset} 评测（${result.datasetId} v${result.datasetVersion}）===`);
    for (const [key, value] of Object.entries(result.metrics)) {
      console.log(`  ${key}: ${value}`);
    }
    if (result.tagPrecision !== undefined) {
      for (const [tag, value] of Object.entries(result.tagPrecision)) {
        console.log(`  tagPrecision.${tag}: ${value}`);
      }
    }
    console.log(`  confusion: ${JSON.stringify(result.confusion)}`);
    console.log(`  thresholdsMet: ${JSON.stringify(result.thresholdsMet)}`);
    console.log(`  mismatches: ${result.mismatches.length} 条（最多展示 20 条）`);
    console.log(`  summary: ${result.summary}`);
  }
}

main().catch((error) => {
  console.error('[qcc:eval] 失败:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
