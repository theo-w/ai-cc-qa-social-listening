/**
 * 看板路由：summary / trends / anomalies（FR-SYS-001..003）。
 */
import { Router } from 'express';
import { asyncHandler, queryString, sendJson, validationError } from '../http.js';
import {
  buildDashboardAnomalies,
  buildDashboardSummary,
  buildDashboardTrends,
  RANGE_DAYS,
} from '../stats.js';
import { getStore } from '../store.js';
import type { RangeKey } from '../types.js';

export const dashboardRouter: Router = Router();

function parseRange(raw: string | undefined): RangeKey {
  if (raw === undefined) {
    return '7d';
  }
  if (raw in RANGE_DAYS) {
    return raw as RangeKey;
  }
  throw validationError('range 必须为 7d / 14d / 30d', { field: 'range', value: raw });
}

dashboardRouter.get(
  '/dashboard/summary',
  asyncHandler((req, res) => {
    sendJson(res, buildDashboardSummary(getStore(), parseRange(queryString(req, 'range'))));
  }),
);

dashboardRouter.get(
  '/dashboard/trends',
  asyncHandler((req, res) => {
    sendJson(res, buildDashboardTrends(getStore(), parseRange(queryString(req, 'range'))));
  }),
);

dashboardRouter.get(
  '/dashboard/anomalies',
  asyncHandler((_req, res) => {
    sendJson(res, { items: buildDashboardAnomalies(getStore()) });
  }),
);
