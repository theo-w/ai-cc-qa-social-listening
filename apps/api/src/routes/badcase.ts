/**
 * badcase 路由：列表、统计、详情、状态流转（FR-BC-001..006）。
 */
import { Router } from 'express';
import { z } from 'zod';
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
import { buildBadcaseStats, isBadcaseOverdue } from '../stats.js';
import { getStore, mutateStore } from '../store.js';
import type { Badcase, BadcaseListItem, Severity } from '../types.js';
import { realNow } from '../util/time.js';

export const badcaseRouter: Router = Router();

const actionSchema = z.object({
  type: z.enum(['assign', 'progress', 'verify', 'close', 'reopen', 'comment']),
  owner: z.string().min(1).max(40).optional(),
  note: z.string().max(2000).optional(),
  proof: z.string().max(2000).optional(),
  by: z.string().min(1).max(40).optional(),
});

const BADCASE_STATUSES = ['open', 'in_progress', 'pending_verify', 'closed'] as const;
const BADCASE_CATEGORIES = ['knowledge', 'script', 'process', 'system'] as const;
const SEVERITIES: readonly Severity[] = ['low', 'medium', 'high'];

function toListItem(badcase: Badcase, agentName: string, now: string): BadcaseListItem {
  return {
    id: badcase.id,
    code: badcase.code,
    title: badcase.title,
    category: badcase.category,
    owner: badcase.owner,
    status: badcase.status,
    severity: badcase.severity,
    dueAt: badcase.dueAt,
    overdue: isBadcaseOverdue(badcase, now),
    recurrence: badcase.recurrence,
    conversationId: badcase.conversationId,
    agentName,
    createdAt: badcase.createdAt,
    updatedAt: badcase.updatedAt,
  };
}

/* ------------------------------ 列表 ------------------------------ */

badcaseRouter.get(
  '/badcases',
  asyncHandler((req, res) => {
    const { page, pageSize } = parsePagination(req);
    const q = queryString(req, 'q')?.toLowerCase();
    const rawStatus = queryString(req, 'status');
    const rawCategory = queryString(req, 'category');
    const owner = queryString(req, 'owner');

    if (rawStatus !== undefined && !(BADCASE_STATUSES as readonly string[]).includes(rawStatus)) {
      throw validationError('status 必须为合法 badcase 状态', { field: 'status', value: rawStatus });
    }
    if (rawCategory !== undefined && !(BADCASE_CATEGORIES as readonly string[]).includes(rawCategory)) {
      throw validationError('category 必须为 knowledge / script / process / system', {
        field: 'category',
        value: rawCategory,
      });
    }

    const store = getStore();
    const now = realNow();
    const conversationById = new Map(store.conversations.map((conversation) => [conversation.id, conversation]));
    const items: BadcaseListItem[] = [];
    for (const badcase of store.badcases) {
      const conversation = conversationById.get(badcase.conversationId);
      const agentName = conversation?.agent.name ?? '未知坐席';
      if (rawStatus !== undefined && badcase.status !== rawStatus) {
        continue;
      }
      if (rawCategory !== undefined && badcase.category !== rawCategory) {
        continue;
      }
      if (owner !== undefined && badcase.owner !== owner) {
        continue;
      }
      if (q !== undefined) {
        const haystack = [badcase.id, badcase.code, badcase.title, badcase.owner, badcase.rootCause, agentName]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) {
          continue;
        }
      }
      items.push(toListItem(badcase, agentName, now));
    }
    items.sort((left, right) => {
      const timeDiff = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
      return timeDiff !== 0 ? timeDiff : left.id.localeCompare(right.id);
    });
    sendJson(res, paginate(items, page, pageSize));
  }),
);

badcaseRouter.get(
  '/badcases/stats',
  asyncHandler((_req, res) => {
    sendJson(res, buildBadcaseStats(getStore()));
  }),
);

/* ------------------------------ 详情 ------------------------------ */

badcaseRouter.get(
  '/badcases/:id',
  asyncHandler((req, res) => {
    const badcaseId = String(req.params.id);
    const badcase = getStore().badcases.find((item) => item.id === badcaseId);
    if (badcase === undefined) {
      throw notFound(`badcase 不存在：${badcaseId}`);
    }
    sendJson(res, badcase);
  }),
);

/* ------------------------------ 状态流转 ------------------------------ */

badcaseRouter.post(
  '/badcases/:id/actions',
  asyncHandler(async (req, res) => {
    const body = parseBody(actionSchema, req);
    const badcaseId = String(req.params.id);
    const updated = await mutateStore((store) => {
      const badcase = store.badcases.find((item) => item.id === badcaseId);
      if (badcase === undefined) {
        throw notFound(`badcase 不存在：${badcaseId}`);
      }
      const from = badcase.status;
      const by = body.by ?? '陆川';
      const now = realNow();

      const advance = (to: Badcase['status'], type: Badcase['timeline'][number]['type'], note: string | null): void => {
        badcase.status = to;
        badcase.updatedAt = now;
        badcase.timeline.push({ at: now, by, type, note, from, to });
      };

      switch (body.type) {
        case 'assign': {
          if (from !== 'open' && from !== 'in_progress') {
            throw conflict('assign 仅允许从 open / in_progress 发起', { from, action: body.type });
          }
          if (body.owner === undefined) {
            throw validationError('assign 必须提供 owner', { field: 'owner' });
          }
          badcase.owner = body.owner;
          advance('in_progress', 'assigned', `分派给 ${body.owner}`);
          break;
        }
        case 'progress': {
          if (from !== 'open' && from !== 'in_progress') {
            throw conflict('progress 仅允许从 open / in_progress 发起', { from, action: body.type });
          }
          if (body.note === undefined || body.note.trim().length === 0) {
            throw validationError('progress 必须提供 note', { field: 'note' });
          }
          advance('in_progress', 'progressed', body.note);
          break;
        }
        case 'verify': {
          if (from !== 'in_progress') {
            throw conflict('verify 仅允许从 in_progress 发起', { from, action: body.type });
          }
          if (body.note === undefined || body.note.trim().length === 0) {
            throw validationError('verify 必须提供 note', { field: 'note' });
          }
          advance('pending_verify', 'verified', body.note);
          break;
        }
        case 'close': {
          if (from !== 'pending_verify') {
            throw conflict('close 仅允许从 pending_verify 发起', { from, action: body.type });
          }
          if (body.proof === undefined || body.proof.trim().length === 0) {
            throw validationError('close 必须提供 proof', { field: 'proof' });
          }
          badcase.closedAt = now;
          badcase.proof = body.proof;
          advance('closed', 'closed', body.proof);
          break;
        }
        case 'reopen': {
          if (from !== 'closed') {
            throw conflict('reopen 仅允许从 closed 发起', { from, action: body.type });
          }
          if (body.note === undefined || body.note.trim().length === 0) {
            throw validationError('reopen 必须提供 note', { field: 'note' });
          }
          badcase.closedAt = null;
          advance('in_progress', 'reopened', body.note);
          break;
        }
        case 'comment': {
          if (body.note === undefined || body.note.trim().length === 0) {
            throw validationError('comment 必须提供 note', { field: 'note' });
          }
          badcase.updatedAt = now;
          badcase.timeline.push({ at: now, by, type: 'commented', note: body.note, from, to: from });
          break;
        }
      }
      return badcase;
    });
    sendJson(res, updated);
  }),
);

/** 供其他模块复用：严重级别顺序。 */
export const SEVERITY_ORDER = SEVERITIES;
