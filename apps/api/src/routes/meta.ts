/**
 * 元信息与健康检查路由（FR-SYS-007 / openapi Health、Meta）。
 */
import { Router } from 'express';
import { APP_VERSION, MODEL_VERSION } from '../config.js';
import { getDatasets } from '../datasets.js';
import { asyncHandler, sendJson } from '../http.js';
import {
  CLUE_TARGETS,
  KNOWLEDGE_CATEGORIES,
  KNOWLEDGE_COMPARE_LABELS,
  KNOWLEDGE_SOURCE_LABELS,
  KNOWLEDGE_STATUS_LABELS,
  OWNERS,
  ROLES,
  SOURCES,
  STATUS_LABELS,
  TAGS,
  TOPICS,
} from '../engine/taxonomy.js';
import { getStore } from '../store.js';
import { demoNow } from '../util/time.js';

export const metaRouter: Router = Router();

metaRouter.get('/health', (_req, res) => {
  sendJson(res, {
    status: 'ok',
    version: APP_VERSION,
    uptimeSec: Math.round(process.uptime()),
  });
});

metaRouter.get(
  '/meta',
  asyncHandler((_req, res) => {
    const store = getStore();
    const datasets = getDatasets();
    const labels = STATUS_LABELS;
    sendJson(res, {
      product: 'AI客服运营质量管控工作台',
      version: APP_VERSION,
      generatedAt: demoNow(),
      modelVersion: MODEL_VERSION,
      roles: ROLES.map((role) => ({ id: role.id, label: role.label })),
      owners: OWNERS.map((owner) => ({ role: owner.role, name: owner.name })),
      tagTaxonomy: TAGS.map((tag) => ({
        code: tag.code,
        name: tag.name,
        description: tag.description,
        severity: tag.severity,
        weight: tag.weight,
      })),
      topics: [...TOPICS],
      sources: SOURCES.map((source) => ({ id: source.id, label: source.label })),
      clueTargets: CLUE_TARGETS.map((target) => ({ id: target.id, label: target.label })),
      knowledgeCategories: KNOWLEDGE_CATEGORIES.map((category) => ({ id: category.code, label: category.name })),
      knowledgeStatuses: Object.entries(KNOWLEDGE_STATUS_LABELS).map(([id, label]) => ({ id, label })),
      knowledgeSources: Object.entries(KNOWLEDGE_SOURCE_LABELS).map(([id, label]) => ({ id, label })),
      knowledgeCompares: Object.entries(KNOWLEDGE_COMPARE_LABELS).map(([id, label]) => ({ id, label })),
      statusLabels: {
        badcase: labels['badcase'] ?? {},
        alert: labels['alert'] ?? {},
        clue: labels['clue'] ?? {},
      },
      demo: {
        datasetVersion: datasets.displayDatasetVersion,
        resetAvailable: true,
        itemCounts: {
          qc: datasets.qc.items.length,
          sentiment: datasets.sentiment.items.length,
        },
      },
    });
  }),
);
