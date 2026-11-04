/**
 * 舆情路由：统计、评论列表、预警列表/详情/状态流转（FR-SEN-001..007）。
 */
import { Router } from 'express';
import { z } from 'zod';
import { TOPICS } from '../engine/taxonomy.js';
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
import { buildSentimentStats, isAlertOverdue } from '../stats.js';
import { getStore, mutateStore } from '../store.js';
import type { AlertListItem, SentimentAlert } from '../types.js';
import { realNow } from '../util/time.js';

export const sentimentRouter: Router = Router();

const actionSchema = z.object({
  type: z.enum(['acknowledge', 'respond', 'escalate', 'resolve', 'comment']),
  note: z.string().max(2000).optional(),
  by: z.string().min(1).max(40).optional(),
});

const SOURCE_IDS = ['steam', 'taptap', 'googleplay', 'community', 'ticket'] as const;
const SENTIMENTS = ['positive', 'neutral', 'negative'] as const;
const SEVERITIES = ['p0', 'p1', 'p2', 'none'] as const;
const ALERT_LEVELS = ['P0', 'P1', 'P2'] as const;
const ALERT_STATUSES = ['new', 'acknowledged', 'responding', 'escalated', 'resolved'] as const;

function toAlertListItem(alert: SentimentAlert, now: string): AlertListItem {
  return {
    id: alert.id,
    level: alert.level,
    topic: alert.topic,
    title: alert.title,
    status: alert.status,
    owner: alert.owner,
    createdAt: alert.createdAt,
    firstResponseAt: alert.firstResponseAt,
    slaDueAt: alert.slaDueAt,
    overdue: isAlertOverdue(alert, now),
    commentCount: alert.commentIds.length,
  };
}

/* ------------------------------ 统计 ------------------------------ */

sentimentRouter.get(
  '/sentiment/stats',
  asyncHandler((_req, res) => {
    sendJson(res, buildSentimentStats(getStore()));
  }),
);

/* ------------------------------ 评论列表 ------------------------------ */

sentimentRouter.get(
  '/sentiment/comments',
  asyncHandler((req, res) => {
    const { page, pageSize } = parsePagination(req);
    const q = queryString(req, 'q')?.toLowerCase();
    const rawSource = queryString(req, 'source');
    const rawSentiment = queryString(req, 'sentiment');
    const rawTopic = queryString(req, 'topic');
    const rawSeverity = queryString(req, 'severity');

    if (rawSource !== undefined && !(SOURCE_IDS as readonly string[]).includes(rawSource)) {
      throw validationError('source 必须为合法评论来源', { field: 'source', value: rawSource });
    }
    if (rawSentiment !== undefined && !(SENTIMENTS as readonly string[]).includes(rawSentiment)) {
      throw validationError('sentiment 必须为 positive / neutral / negative', {
        field: 'sentiment',
        value: rawSentiment,
      });
    }
    if (rawTopic !== undefined && !TOPICS.includes(rawTopic)) {
      throw validationError('topic 必须为合法舆情主题', { field: 'topic', value: rawTopic });
    }
    if (rawSeverity !== undefined && !(SEVERITIES as readonly string[]).includes(rawSeverity)) {
      throw validationError('severity 必须为 p0 / p1 / p2 / none', { field: 'severity', value: rawSeverity });
    }

    const comments = getStore().comments.filter((comment) => {
      if (rawSource !== undefined && comment.source !== rawSource) {
        return false;
      }
      if (rawSentiment !== undefined && comment.sentiment !== rawSentiment) {
        return false;
      }
      if (rawTopic !== undefined && comment.primaryTopic !== rawTopic) {
        return false;
      }
      if (rawSeverity !== undefined && comment.severity !== rawSeverity) {
        return false;
      }
      if (q !== undefined) {
        const haystack = [comment.id, comment.brand, comment.author, comment.text, ...comment.topics]
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      }
      return true;
    });
    comments.sort((left, right) => {
      const timeDiff = new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime();
      return timeDiff !== 0 ? timeDiff : left.id.localeCompare(right.id);
    });
    sendJson(res, paginate(comments, page, pageSize));
  }),
);

/* ------------------------------ 预警列表 ------------------------------ */

sentimentRouter.get(
  '/sentiment/alerts',
  asyncHandler((req, res) => {
    const { page, pageSize } = parsePagination(req);
    const q = queryString(req, 'q')?.toLowerCase();
    const rawLevel = queryString(req, 'level');
    const rawStatus = queryString(req, 'status');

    if (rawLevel !== undefined && !(ALERT_LEVELS as readonly string[]).includes(rawLevel)) {
      throw validationError('level 必须为 P0 / P1 / P2', { field: 'level', value: rawLevel });
    }
    if (rawStatus !== undefined && !(ALERT_STATUSES as readonly string[]).includes(rawStatus)) {
      throw validationError('status 必须为合法预警状态', { field: 'status', value: rawStatus });
    }

    const now = realNow();
    const items = getStore()
      .alerts.filter((alert) => {
        if (rawLevel !== undefined && alert.level !== rawLevel) {
          return false;
        }
        if (rawStatus !== undefined && alert.status !== rawStatus) {
          return false;
        }
        if (q !== undefined) {
          const haystack = [alert.id, alert.title, alert.topic, alert.summary, alert.owner]
            .join(' ')
            .toLowerCase();
          return haystack.includes(q);
        }
        return true;
      })
      .sort((left, right) => {
        const timeDiff = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
        return timeDiff !== 0 ? timeDiff : left.id.localeCompare(right.id);
      })
      .map((alert) => toAlertListItem(alert, now));
    sendJson(res, paginate(items, page, pageSize));
  }),
);

/* ------------------------------ 预警详情 ------------------------------ */

sentimentRouter.get(
  '/sentiment/alerts/:id',
  asyncHandler((req, res) => {
    const alertId = String(req.params.id);
    const store = getStore();
    const alert = store.alerts.find((item) => item.id === alertId);
    if (alert === undefined) {
      throw notFound(`预警不存在：${alertId}`);
    }
    const commentIds = new Set(alert.commentIds);
    const linkedClueIds = new Set(alert.linkedClueIds);
    sendJson(res, {
      alert,
      comments: store.comments
        .filter((comment) => commentIds.has(comment.id))
        .sort((left, right) => left.id.localeCompare(right.id)),
      linkedClues: store.clues
        .filter((clue) => linkedClueIds.has(clue.id))
        .sort((left, right) => left.id.localeCompare(right.id)),
    });
  }),
);

/* ------------------------------ 状态流转 ------------------------------ */

sentimentRouter.post(
  '/sentiment/alerts/:id/actions',
  asyncHandler(async (req, res) => {
    const body = parseBody(actionSchema, req);
    const alertId = String(req.params.id);
    const updated = await mutateStore((store) => {
      const alert = store.alerts.find((item) => item.id === alertId);
      if (alert === undefined) {
        throw notFound(`预警不存在：${alertId}`);
      }
      const from = alert.status;
      const by = body.by ?? alert.owner;
      const now = realNow();

      const note = body.note ?? null;
      const transition = (
        to: SentimentAlert['status'],
        type: SentimentAlert['timeline'][number]['type'],
        maybeNote: string | null,
      ): void => {
        alert.status = to;
        alert.timeline.push({ at: now, by, type, note: maybeNote, from, to });
      };

      switch (body.type) {
        case 'acknowledge': {
          if (from !== 'new') {
            throw conflict('acknowledge 仅允许从 new 发起', { from, action: body.type });
          }
          if (alert.firstResponseAt === null) {
            alert.firstResponseAt = now;
          }
          transition('acknowledged', 'acknowledged', note);
          break;
        }
        case 'respond': {
          if (from !== 'acknowledged') {
            throw conflict('respond 仅允许从 acknowledged 发起', { from, action: body.type });
          }
          if (alert.firstResponseAt === null) {
            alert.firstResponseAt = now;
          }
          transition('responding', 'responded', note);
          break;
        }
        case 'escalate': {
          if (from !== 'new' && from !== 'acknowledged' && from !== 'responding') {
            throw conflict('escalate 仅允许从 new / acknowledged / responding 发起', {
              from,
              action: body.type,
            });
          }
          if (alert.firstResponseAt === null) {
            alert.firstResponseAt = now;
          }
          transition('escalated', 'escalated', note);
          break;
        }
        case 'resolve': {
          if (from !== 'responding' && from !== 'escalated') {
            throw conflict('resolve 仅允许从 responding / escalated 发起', { from, action: body.type });
          }
          if (body.note === undefined || body.note.trim().length === 0) {
            throw validationError('resolve 必须提供 note', { field: 'note' });
          }
          alert.resolvedAt = now;
          transition('resolved', 'resolved', body.note);
          break;
        }
        case 'comment': {
          if (body.note === undefined || body.note.trim().length === 0) {
            throw validationError('comment 必须提供 note', { field: 'note' });
          }
          alert.timeline.push({ at: now, by, type: 'commented', note: body.note, from, to: from });
          break;
        }
      }
      return alert;
    });
    sendJson(res, updated);
  }),
);
