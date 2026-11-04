/**
 * API 服务入口：初始化运行态 → 装配中间件 → 监听 127.0.0.1:8787。
 *
 * 中间件顺序：cors → json(2mb) → 请求日志 → 路由 → 404 → 错误处理。
 */
import cors from 'cors';
import express from 'express';
import { APP_VERSION, HOST, PORT, WEB_ORIGIN } from './config.js';
import { errorHandler, notFoundHandler } from './http.js';
import { createApiRouter } from './routes/index.js';
import { countStore, ensureStore } from './store.js';

const ORIGIN_ALLOWLIST = new Set([WEB_ORIGIN, 'http://127.0.0.1:5178', 'http://localhost:5178']);

async function main(): Promise<void> {
  const { store, rebuilt } = await ensureStore();
  const counts = countStore(store);
  console.log(
    `[qcc-api] v${APP_VERSION} 运行态${rebuilt ? '已按 data/ 重建' : '复用缓存'} dataset=${store.datasetVersion}`,
  );
  console.log(`[qcc-api] 种子计数 ${JSON.stringify(counts)}`);

  const app = express();
  app.disable('x-powered-by');
  app.use(
    cors({
      origin: (origin, callback) => {
        // 无 Origin（curl/同源）与白名单来源放行；本服务无鉴权，仅供本地演示。
        callback(null, origin === undefined || ORIGIN_ALLOWLIST.has(origin));
      },
    }),
  );
  app.use(express.json({ limit: '2mb' }));
  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      console.log(`[qcc-api] ${req.method} ${req.originalUrl} → ${res.statusCode} ${Date.now() - startedAt}ms`);
    });
    next();
  });

  app.use('/api', createApiRouter());
  app.use(notFoundHandler);
  app.use(errorHandler);

  app.listen(PORT, HOST, () => {
    console.log(`[qcc-api] listening on http://${HOST}:${PORT}（modelVersion=rule-engine-v0.3.0）`);
  });
}

main().catch((error) => {
  console.error('[qcc-api] 启动失败:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
