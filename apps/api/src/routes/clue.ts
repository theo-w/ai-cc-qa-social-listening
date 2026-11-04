/**
 * 舆情线索路由：创建、列表、详情、状态流转（FR-SYS-004 / FR-SEN-007）。
 */
import { Router } from 'express';
import { z } from 'zod';
import { clueOwner, CLUE_TARGETS } from '../engine/taxonomy.js';
import {
  asyncHandler,
  conflict,
  notFound,
  paginate,
  parseBody,
  parsePagination,
  queryString,
  sendJson,
  validationError,
} from '../http.js';
import { getStore, mutateStore } from '../store.js';
import type { Clue, ClueTarget } from '../types.js';
import { nextSequentialId } from '../util/ids.js';
import { realNow } from '../util/time.js';

export const clueRouter: Router = Router();

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  sourceType: z.enum(['qc', 'sentiment', 'dashboard', 'agent']),
  sourceRef: z.object({
    type: z.string().min(1).max(40),
    id: z.string().min(1).max(80),
    label: z.string().min(1).max(200),
  }),
  target: z.enum(['product', 'brand', 'market', 'cs']),
  priority: z.enum(['high', 'medium', 'low']),
  evidence: z.array(z.string().max(500)).max(20).optional(),
  createdBy: z.string().min(1).max(40).optional(),
});

const actionSchema = z.object({
  type: z.enum(['route', 'accept', 'reject', 'close', 'comment']),
  owner: z.string().min(1).max(40).optional(),
  note: z.string().max(2000).optional(),
  outcome: z.string().max(2000).optional(),
  by: z.string().min(1).max(40).optional(),
});

const CLUE_STATUSES = ['draft', 'routed', 'accepted', 'rejected', 'closed'] as const;
const CLUE_SOURCES = ['qc', 'sentiment', 'dashboard', 'agent'] as const;

/* ------------------------------ 列表 ------------------------------ */

clueRouter.get(
  '/clues',
  asyncHandler((req, res) => {
    const { page, pageSize } = parsePagination(req);
    const q = queryString(req, 'q')?.toLowerCase();
    const rawStatus = queryString(req, 'status');
    const rawTarget = queryString(req, 'target');
    const rawSourceType = queryString(req, 'sourceType');

    if (rawStatus !== undefined && !(CLUE_STATUSES as readonly string[]).includes(rawStatus)) {
      throw validationError('status 必须为合法线索状态', { field: 'status', value: rawStatus });
    }
    if (rawTarget !== undefined && !CLUE_TARGETS.some((target) => target.id === rawTarget)) {
      throw validationError('target 必须为 product / brand / market / cs', { field: 'target', value: rawTarget });
    }
    if (rawSourceType !== undefined && !(CLUE_SOURCES as readonly string[]).includes(rawSourceType)) {
      throw validationError('sourceType 必须为 qc / sentiment / dashboard / agent', {
        field: 'sourceType',
        value: rawSourceType,
      });
    }

    const items = getStore()
      .clues.filter((clue) => {
        if (rawStatus !== undefined && clue.status !== rawStatus) {
          return false;
        }
        if (rawTarget !== undefined && clue.target !== rawTarget) {
          return false;
        }
        if (rawSourceType !== undefined && clue.sourceType !== rawSourceType) {
          return false;
        }
        if (q !== undefined) {
          const haystack = [clue.id, clue.title, clue.description, clue.sourceRef.label, clue.owner, clue.createdBy]
            .join(' ')
            .toLowerCase();
          return haystack.includes(q);
        }
        return true;
      })
      .sort((left, right) => {
        const timeDiff = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
        return timeDiff !== 0 ? timeDiff : left.id.localeCompare(right.id);
      });
    sendJson(res, paginate(items, page, pageSize));
  }),
);

/* ------------------------------ 创建 ------------------------------ */

clueRouter.post(
  '/clues',
  asyncHandler(async (req, res) => {
    const body = parseBody(createSchema, req);
    const clue = await mutateStore((store) => {
      const createdBy = body.createdBy ?? '沈言';
      const target = body.target as ClueTarget;
      const now = realNow();
      const id = nextSequentialId('clue-', store.clues.map((item) => item.id));

      // 预警转线索：同一预警同一目标仅允许一条（FR-SEN-007）。
      const sourceAlert =
        body.sourceRef.type === 'alert' ? store.alerts.find((alert) => alert.id === body.sourceRef.id) : undefined;
      if (sourceAlert !== undefined) {
        const existing = store.clues.find(
          (candidate) => sourceAlert.linkedClueIds.includes(candidate.id) && candidate.target === target,
        );
        if (existing !== undefined) {
          throw conflict('该预警已生成同目标线索', { alertId: sourceAlert.id, clueId: existing.id, target });
        }
      }

      const created: Clue = {
        id,
        title: body.title,
        description: body.description,
        sourceType: body.sourceType,
        sourceRef: {
          type: body.sourceRef.type,
          id: body.sourceRef.id,
          label: body.sourceRef.label,
        },
        target,
        priority: body.priority,
        status: 'draft',
        owner: clueOwner(target),
        createdBy,
        evidence: body.evidence ?? [],
        outcome: null,
        timeline: [
          {
            at: now,
            by: createdBy,
            type: 'created',
            note: `创建线索（来源：${body.sourceRef.label}）`,
            from: null,
            to: 'draft',
          },
        ],
        createdAt: now,
        updatedAt: now,
        closedAt: null,
      };
      store.clues.push(created);
      if (sourceAlert !== undefined) {
        sourceAlert.linkedClueIds.push(id);
      }
      return created;
    });
    sendJson(res, clue);
  }),
);

/* ------------------------------ 详情 ------------------------------ */

clueRouter.get(
  '/clues/:id',
  asyncHandler((req, res) => {
    const clueId = String(req.params.id);
    const clue = getStore().clues.find((item) => item.id === clueId);
    if (clue === undefined) {
      throw notFound(`线索不存在：${clueId}`);
    }
    sendJson(res, clue);
  }),
);

/* ------------------------------ 状态流转 ------------------------------ */

clueRouter.post(
  '/clues/:id/actions',
  asyncHandler(async (req, res) => {
    const body = parseBody(actionSchema, req);
    const clueId = String(req.params.id);
    const updated = await mutateStore((store) => {
      const clue = store.clues.find((item) => item.id === clueId);
      if (clue === undefined) {
        throw notFound(`线索不存在：${clueId}`);
      }
      const from = clue.status;
      const by = body.by ?? clue.owner ?? '沈言';
      const now = realNow();

      const transition = (to: Clue['status'], type: Clue['timeline'][number]['type'], note: string | null): void => {
        clue.status = to;
        clue.updatedAt = now;
        clue.timeline.push({ at: now, by, type, note, from, to });
      };

      switch (body.type) {
        case 'route': {
          if (from !== 'draft') {
            throw conflict('route 仅允许从 draft 发起', { from, action: body.type });
          }
          if (body.owner === undefined || body.owner.trim().length === 0) {
            throw validationError('route 必须提供 owner', { field: 'owner' });
          }
          clue.owner = body.owner;
          transition('routed', 'routed', body.note ?? `提交给 ${body.owner}`);
          break;
        }
        case 'accept': {
          if (from !== 'routed') {
            throw conflict('accept 仅允许从 routed 发起', { from, action: body.type });
          }
          if (body.owner !== undefined && body.owner.trim().length > 0) {
            clue.owner = body.owner;
          }
          transition('accepted', 'accepted', body.note ?? `由 ${clue.owner} 接收`);
          break;
        }
        case 'reject': {
          if (from !== 'routed') {
            throw conflict('reject 仅允许从 routed 发起', { from, action: body.type });
          }
          if (body.note === undefined || body.note.trim().length === 0) {
            throw validationError('reject 必须提供 note', { field: 'note' });
          }
          transition('rejected', 'rejected', body.note);
          break;
        }
        case 'close': {
          if (from !== 'accepted' && from !== 'rejected') {
            throw conflict('close 仅允许从 accepted / rejected 发起', { from, action: body.type });
          }
          if (body.outcome === undefined || body.outcome.trim().length === 0) {
            throw validationError('close 必须提供 outcome', { field: 'outcome' });
          }
          clue.outcome = body.outcome;
          clue.closedAt = now;
          transition('closed', 'closed', body.outcome);
          break;
        }
        case 'comment': {
          if (body.note === undefined || body.note.trim().length === 0) {
            throw validationError('comment 必须提供 note', { field: 'note' });
          }
          clue.updatedAt = now;
          clue.timeline.push({ at: now, by, type: 'commented', note: body.note, from, to: from });
          break;
        }
      }
      return clue;
    });
    sendJson(res, updated);
  }),
);

/** 对外复用：目标团队负责人。 */
export function ownerForTarget(target: ClueTarget): string {
  return clueOwner(target);
}
