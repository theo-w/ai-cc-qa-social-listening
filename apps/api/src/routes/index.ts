/**
 * API 路由汇总：/api 前缀下注册全部端点（26 paths / 28 operations）。
 */
import { Router } from 'express';
import { invalidateDatasets } from '../datasets.js';
import { asyncHandler, sendJson } from '../http.js';
import { resetStore } from '../store.js';
import { badcaseRouter } from './badcase.js';
import { clueRouter } from './clue.js';
import { dashboardRouter } from './dashboard.js';
import { evalRouter } from './eval.js';
import { knowledgeRouter } from './knowledge.js';
import { metaRouter } from './meta.js';
import { qcRouter } from './qc.js';
import { sentimentRouter } from './sentiment.js';

export function createApiRouter(): Router {
  const router = Router();

  router.use(metaRouter);

  // POST /api/admin/reset：清空运行态并按同一逻辑重建（FR-SYS-006，确定性可复现）。
  router.post(
    '/admin/reset',
    asyncHandler(async (_req, res) => {
      const summary = await resetStore();
      invalidateDatasets();
      sendJson(res, {
        ok: true,
        resetAt: summary.resetAt,
        seeded: {
          conversations: summary.counts.conversations,
          qcResults: summary.counts.qcResults,
          comments: summary.counts.comments,
          badcases: summary.counts.badcases,
          knowledgeEntries: summary.counts.knowledgeEntries,
          alerts: summary.counts.alerts,
          clues: summary.counts.clues,
          metricSnapshots: summary.counts.metricSnapshots,
        },
      });
    }),
  );

  router.use(dashboardRouter);
  router.use(qcRouter);
  router.use(knowledgeRouter);
  router.use(badcaseRouter);
  router.use(sentimentRouter);
  router.use(clueRouter);
  router.use(evalRouter);

  return router;
}
