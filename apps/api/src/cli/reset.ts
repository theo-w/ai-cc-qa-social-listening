/**
 * CLI：重置运行态（按 data/ 全量重建并原子落盘）。
 * 用法：pnpm --filter @qcc/api reset
 */
import { resetStore, storeFilePath } from '../store.js';

async function main(): Promise<void> {
  const summary = await resetStore();
  console.log(`[qcc:reset] 完成于 ${summary.resetAt}`);
  console.log(JSON.stringify(summary.counts, null, 2));
  console.log(`[qcc:reset] store: ${storeFilePath()}`);
}

main().catch((error) => {
  console.error('[qcc:reset] 失败:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
