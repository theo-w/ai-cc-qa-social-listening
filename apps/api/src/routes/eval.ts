/**
 * 评测路由：数据集、历史、发起回放、单次结果（FR-EVAL-001..003）。
 */
import { Router } from 'express';
import { z } from 'zod';
import { MODEL_VERSION } from '../config.js';
import { getDatasets } from '../datasets.js';
import { evaluateDataset } from '../eval/run.js';
import {
  asyncHandler,
  notFound,
  parseBody,
  queryString,
  sendJson,
  validationError,
} from '../http.js';
import { getStore, mutateStore } from '../store.js';
import type { EvalRun, EvalRunSummary } from '../types.js';
import { nextSequentialId } from '../util/ids.js';

export const evalRouter: Router = Router();

const runSchema = z.object({ dataset: z.enum(['qc', 'sentiment']) });
const DATASETS = ['qc', 'sentiment'] as const;

function toSummary(run: EvalRun): EvalRunSummary {
  return {
    id: run.id,
    dataset: run.dataset,
    datasetId: run.datasetId,
    datasetVersion: run.datasetVersion,
    runAt: run.runAt,
    durationMs: run.durationMs,
    modelVersion: run.modelVersion,
    metrics: run.metrics,
    thresholdsMet: run.thresholdsMet,
    summary: run.summary,
  };
}

/* ------------------------------ 数据集 ------------------------------ */

evalRouter.get(
  '/eval/datasets',
  asyncHandler((_req, res) => {
    const datasets = getDatasets();
    const store = getStore();
    const lastRunAt = (dataset: 'qc' | 'sentiment'): string | null => {
      const runs = store.evalRuns
        .filter((run) => run.dataset === dataset)
        .sort((left, right) => {
          const timeDiff = new Date(right.runAt).getTime() - new Date(left.runAt).getTime();
          return timeDiff !== 0 ? timeDiff : right.id.localeCompare(left.id);
        });
      return runs[0]?.runAt ?? null;
    };
    sendJson(res, {
      items: [
        {
          dataset: 'qc',
          datasetId: datasets.qc.datasetId || datasets.manifest.datasets.qc.datasetId,
          version: datasets.qc.version || datasets.manifest.datasets.qc.version,
          itemCount: datasets.qc.items.length,
          description: datasets.qc.description,
          lastRunAt: lastRunAt('qc'),
        },
        {
          dataset: 'sentiment',
          datasetId: datasets.sentiment.datasetId || datasets.manifest.datasets.sentiment.datasetId,
          version: datasets.sentiment.version || datasets.manifest.datasets.sentiment.version,
          itemCount: datasets.sentiment.items.length,
          description: datasets.sentiment.description,
          lastRunAt: lastRunAt('sentiment'),
        },
      ],
    });
  }),
);

/* ------------------------------ 评测历史 ------------------------------ */

evalRouter.get(
  '/eval/runs',
  asyncHandler((req, res) => {
    const rawDataset = queryString(req, 'dataset');
    if (rawDataset !== undefined && !(DATASETS as readonly string[]).includes(rawDataset)) {
      throw validationError('dataset 必须为 qc 或 sentiment', { field: 'dataset', value: rawDataset });
    }
    const items = getStore()
      .evalRuns.filter((run) => rawDataset === undefined || run.dataset === rawDataset)
      .sort((left, right) => {
        const timeDiff = new Date(right.runAt).getTime() - new Date(left.runAt).getTime();
        return timeDiff !== 0 ? timeDiff : right.id.localeCompare(left.id);
      })
      .map(toSummary);
    sendJson(res, { total: items.length, items });
  }),
);

/* ------------------------------ 发起评测 ------------------------------ */

evalRouter.post(
  '/eval/runs',
  asyncHandler(async (req, res) => {
    const body = parseBody(runSchema, req);
    const datasets = getDatasets();
    const result = evaluateDataset(body.dataset, datasets);
    const created = await mutateStore((store) => {
      const id = nextSequentialId('eval-', store.evalRuns.map((run) => run.id));
      const run: EvalRun = {
        id,
        dataset: result.dataset,
        datasetId: result.datasetId,
        datasetVersion: result.datasetVersion,
        runAt: result.runAt,
        durationMs: result.durationMs,
        modelVersion: MODEL_VERSION,
        metrics: result.metrics,
        confusion: result.confusion,
        mismatches: result.mismatches,
        thresholdsMet: result.thresholdsMet,
        summary: result.summary,
        ...(result.tagPrecision === undefined ? {} : { tagPrecision: result.tagPrecision }),
      };
      store.evalRuns.push(run);
      return run;
    });
    sendJson(res, created);
  }),
);

/* ------------------------------ 单次结果 ------------------------------ */

evalRouter.get(
  '/eval/runs/:id',
  asyncHandler((req, res) => {
    const runId = String(req.params.id);
    const run = getStore().evalRuns.find((item) => item.id === runId);
    if (run === undefined) {
      throw notFound(`评测记录不存在：${runId}`);
    }
    sendJson(res, run);
  }),
);
