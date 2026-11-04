/**
 * 质检路由：统计、会话列表/详情、人工复核、转 badcase（FR-QC-001..010 / FR-BC-001）。
 */
import { Router } from 'express';
import { z } from 'zod';
import { MODEL_VERSION, REVIEW_CONFIDENCE_THRESHOLD } from '../config.js';
import {
  badcaseOwner,
  badcaseSlaHours,
  categoryForTag,
  isTagCode,
  maxSeverity,
  TAG_MAP,
} from '../engine/taxonomy.js';
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
import { buildQcStats } from '../stats.js';
import { getStore, mutateStore } from '../store.js';
import type {
  Badcase,
  BadcaseCreateBody,
  Conversation,
  ConversationListItem,
  ConversationMessage,
  QcResult,
  QcTag,
  ReviewTask,
  TagCode,
  Verdict,
} from '../types.js';
import { nextSequentialId } from '../util/ids.js';
import { addHours, dateKey, demoNow, realNow } from '../util/time.js';

export const qcRouter: Router = Router();

const tagCodeSchema = z.enum(['attitude', 'forbidden', 'off_topic', 'wrong_knowledge', 'timeout', 'escalation']);
const reviewSchema = z.object({
  decision: z.enum(['confirm', 'overturn', 'amend']),
  finalTags: z.array(tagCodeSchema).max(6).optional(),
  note: z.string().max(2000).optional(),
  reviewer: z.string().min(1).max(40).optional(),
});
const badcaseCreateSchema = z.object({
  category: z.enum(['knowledge', 'script', 'process', 'system']),
  owner: z.string().min(1).max(40).optional(),
  slaHours: z.union([z.literal(24), z.literal(48), z.literal(72)]).optional(),
  title: z.string().max(200).optional(),
  rootCause: z.string().max(1000).optional(),
});

function badcaseSeverity(tags: readonly QcTag[]): 'low' | 'medium' | 'high' {
  if (tags.length === 0) {
    return 'medium';
  }
  return maxSeverity(tags.map((tag) => tag.severity));
}

/** 会话列表项（含 FR-QC-002 要求的扩展字段 confidence / recommendedReason）。 */
function toListItem(
  conversation: Conversation,
  qcResult: QcResult,
  review: ReviewTask | undefined,
): ConversationListItem {
  return {
    id: conversation.id,
    channel: conversation.channel,
    product: conversation.product,
    agentName: conversation.agent.name,
    customerName: conversation.customer.name,
    startedAt: conversation.startedAt,
    durationSec: conversation.durationSec,
    messageCount: conversation.messages.length,
    score: qcResult.score,
    verdict: qcResult.verdict,
    needsReview: qcResult.needsReview,
    emotion: qcResult.emotion,
    summary: qcResult.summary,
    tags: qcResult.tags.map((tag) => ({ code: tag.code, name: tag.name, severity: tag.severity })),
    confidence: qcResult.confidence,
    recommendedReason: qcResult.needsReview
      ? `模型置信度 ${qcResult.confidence.toFixed(2)} 低于复核阈值 ${REVIEW_CONFIDENCE_THRESHOLD.toFixed(2)}${
          review !== undefined ? '（已有复核记录）' : ''
        }，建议人工复核`
      : null,
  };
}

/** 消息补全派生字段 gapSec（相对上一条消息的间隔）。 */
function withGap(messages: readonly ConversationMessage[]): ConversationMessage[] {
  const sorted = [...messages].sort((left, right) => left.seq - right.seq);
  return sorted.map((message, index) => {
    const previous = sorted[index - 1];
    return {
      ...message,
      gapSec: previous === undefined ? null : message.atSec - previous.atSec,
    };
  });
}

/** 更新质检结果的标签集合（复核流转用）。 */
function tagsFromCodes(codes: readonly TagCode[], current: readonly QcTag[]): QcTag[] {
  return codes.map(
    (code) =>
      current.find((tag) => tag.code === code) ?? {
        code,
        name: TAG_MAP[code].name,
        severity: TAG_MAP[code].severity,
        confidence: 1,
        evidence: [],
        ruleId: `${TAG_MAP[code].ruleId}-AMEND`,
      },
  );
}

/** 按标签权重重算分数（与引擎口径一致：clamp(100-Σweight, 0, 100)）。 */
function scoreFromTags(tags: readonly QcTag[]): number {
  const deducted = tags.reduce((sum, tag) => sum + TAG_MAP[tag.code].weight, 0);
  return Math.max(0, Math.min(100, 100 - deducted));
}

/** 主标签（按权重、严重级别、字典序，和评测器一致）。 */
function primaryTagOf(qcResult: QcResult): string | null {
  if (qcResult.tags.length === 0) {
    return null;
  }
  const sorted = [...qcResult.tags].sort((left, right) => {
    const weightDiff = TAG_MAP[right.code].weight - TAG_MAP[left.code].weight;
    if (weightDiff !== 0) {
      return weightDiff;
    }
    return left.code < right.code ? -1 : left.code > right.code ? 1 : 0;
  });
  return sorted[0]?.code ?? null;
}

/* ------------------------------ 统计 ------------------------------ */

qcRouter.get(
  '/qc/stats',
  asyncHandler((_req, res) => {
    sendJson(res, buildQcStats(getStore()));
  }),
);

/* ------------------------------ 会话列表 ------------------------------ */

const VERDICTS = ['pass', 'violation'] as const;
const REVIEW_FILTERS = ['pending', 'done', 'none'] as const;
const CHANNELS = ['online', 'ticket', 'phone'] as const;
const SORTS = ['score_asc', 'score_desc', 'time_desc', 'time_asc'] as const;

qcRouter.get(
  '/qc/conversations',
  asyncHandler((req, res) => {
    const { page, pageSize } = parsePagination(req);
    const q = queryString(req, 'q')?.toLowerCase();
    const rawVerdict = queryString(req, 'verdict');
    const rawTag = queryString(req, 'tag');
    const rawReview = queryString(req, 'review');
    const rawChannel = queryString(req, 'channel');
    const rawSort = queryString(req, 'sort');

    if (rawVerdict !== undefined && !(VERDICTS as readonly string[]).includes(rawVerdict)) {
      throw validationError('verdict 必须为 pass 或 violation', { field: 'verdict', value: rawVerdict });
    }
    if (rawTag !== undefined && !isTagCode(rawTag)) {
      throw validationError('tag 必须为合法质检标签', { field: 'tag', value: rawTag });
    }
    if (rawReview !== undefined && !(REVIEW_FILTERS as readonly string[]).includes(rawReview)) {
      throw validationError('review 必须为 pending / done / none', { field: 'review', value: rawReview });
    }
    if (rawChannel !== undefined && !(CHANNELS as readonly string[]).includes(rawChannel)) {
      throw validationError('channel 必须为 online / ticket / phone', { field: 'channel', value: rawChannel });
    }
    const sort = rawSort ?? 'time_desc';
    if (!(SORTS as readonly string[]).includes(sort)) {
      throw validationError('sort 必须为 score_asc / score_desc / time_desc / time_asc', { field: 'sort', value: sort });
    }

    const store = getStore();
    const qcByConversation = new Map(store.qcResults.map((result) => [result.conversationId, result]));
    const reviewsByConversation = new Map<string, ReviewTask[]>();
    for (const task of store.reviewTasks) {
      const list = reviewsByConversation.get(task.conversationId) ?? [];
      list.push(task);
      reviewsByConversation.set(task.conversationId, list);
    }

    const items: ConversationListItem[] = [];
    for (const conversation of store.conversations) {
      const qcResult = qcByConversation.get(conversation.id);
      if (qcResult === undefined) {
        continue;
      }
      const reviews = reviewsByConversation.get(conversation.id) ?? [];
      const latestReview = [...reviews].sort((left, right) => {
        const timeDiff = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
        return timeDiff !== 0 ? timeDiff : right.id.localeCompare(left.id);
      })[0];
      const hasPending = reviews.some((task) => task.status === 'pending');
      const hasDone = reviews.some((task) => task.status === 'done');

      if (rawVerdict !== undefined && qcResult.verdict !== rawVerdict) {
        continue;
      }
      if (rawTag !== undefined && !qcResult.tags.some((tag) => tag.code === rawTag)) {
        continue;
      }
      if (rawReview === 'pending' && !(hasPending && !hasDone)) {
        continue;
      }
      if (rawReview === 'done' && !hasDone) {
        continue;
      }
      if (rawReview === 'none' && reviews.length > 0) {
        continue;
      }
      if (rawChannel !== undefined && conversation.channel !== rawChannel) {
        continue;
      }
      if (q !== undefined) {
        const haystack = [
          conversation.id,
          conversation.product,
          conversation.agent.name,
          conversation.customer.name,
          qcResult.summary,
          ...qcResult.tags.map((tag) => tag.name),
          ...conversation.messages.map((message) => message.text),
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) {
          continue;
        }
      }
      items.push(toListItem(conversation, qcResult, latestReview));
    }

    items.sort((left, right) => {
      switch (sort) {
        case 'score_asc': {
          if (left.score !== right.score) {
            return left.score - right.score;
          }
          break;
        }
        case 'score_desc': {
          if (left.score !== right.score) {
            return right.score - left.score;
          }
          break;
        }
        case 'time_asc': {
          const diff = new Date(left.startedAt).getTime() - new Date(right.startedAt).getTime();
          if (diff !== 0) {
            return diff;
          }
          break;
        }
        case 'time_desc':
        default: {
          const diff = new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime();
          if (diff !== 0) {
            return diff;
          }
          break;
        }
      }
      return left.id.localeCompare(right.id);
    });

    sendJson(res, paginate(items, page, pageSize));
  }),
);

/* ------------------------------ 会话详情 ------------------------------ */

qcRouter.get(
  '/qc/conversations/:id',
  asyncHandler((req, res) => {
    const conversationId = String(req.params.id);
    const store = getStore();
    const conversation = store.conversations.find((item) => item.id === conversationId);
    const qcResult = store.qcResults.find((item) => item.conversationId === conversationId);
    if (conversation === undefined || qcResult === undefined) {
      throw notFound(`会话不存在：${conversationId}`);
    }
    const reviews = store.reviewTasks
      .filter((task) => task.conversationId === conversationId)
      .sort((left, right) => {
        const timeDiff = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
        return timeDiff !== 0 ? timeDiff : right.id.localeCompare(left.id);
      });
    const badcases = store.badcases
      .filter((badcase) => badcase.conversationId === conversationId)
      .sort((left, right) => {
        const timeDiff = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
        return timeDiff !== 0 ? timeDiff : right.id.localeCompare(left.id);
      });
    sendJson(res, {
      conversation: { ...conversation, messages: withGap(conversation.messages) },
      qcResult,
      review: reviews[0] ?? null,
      badcase: badcases[0] ?? null,
    });
  }),
);

/* ------------------------------ 人工复核 ------------------------------ */

qcRouter.post(
  '/qc/conversations/:id/reviews',
  asyncHandler(async (req, res) => {
    const body = parseBody(reviewSchema, req);
    const conversationId = String(req.params.id);
    const result = await mutateStore((store) => {
      const conversation = store.conversations.find((item) => item.id === conversationId);
      const qcResult = store.qcResults.find((item) => item.conversationId === conversationId);
      if (conversation === undefined || qcResult === undefined) {
        throw notFound(`会话不存在：${conversationId}`);
      }
      const existing = store.reviewTasks.find((task) => task.conversationId === conversationId && task.status === 'done');
      if (existing !== undefined) {
        throw conflict('该会话已存在复核记录，复核为终态不可重复提交', {
          reviewId: existing.id,
          status: existing.status,
        });
      }

      const requestedTags = body.finalTags ?? [];
      if (body.decision === 'amend' && requestedTags.length === 0) {
        throw validationError('amend 必须提供非空 finalTags', { field: 'finalTags' });
      }
      if (body.decision === 'overturn' && requestedTags.length > 0) {
        throw validationError('overturn 的 finalTags 必须为空数组', { field: 'finalTags' });
      }

      const now = realNow();
      const reviewer = body.reviewer ?? '沈言';
      const reviewId = nextSequentialId('rvw-', store.reviewTasks.map((task) => task.id));

      let finalVerdict: Verdict;
      let finalTags: string[];
      if (body.decision === 'confirm') {
        finalVerdict = qcResult.verdict;
        finalTags = qcResult.tags.map((tag) => tag.code);
      } else if (body.decision === 'overturn') {
        finalVerdict = qcResult.verdict === 'pass' ? 'violation' : 'pass';
        finalTags = [];
        qcResult.tags = [];
        qcResult.score = 100;
      } else {
        finalTags = [...new Set(requestedTags)];
        const tags = tagsFromCodes(finalTags as TagCode[], qcResult.tags);
        finalVerdict = tags.length > 0 ? 'violation' : 'pass';
        qcResult.tags = tags;
        qcResult.score = scoreFromTags(tags);
      }

      qcResult.verdict = finalVerdict;
      qcResult.needsReview = false;
      qcResult.latestReviewId = reviewId;
      qcResult.summary = `${qcResult.summary}（人工${body.decision === 'confirm' ? '确认' : body.decision === 'overturn' ? '改判' : '修正标签'}）`;

      const review: ReviewTask = {
        id: reviewId,
        qcResultId: qcResult.id,
        conversationId,
        status: 'done',
        assignee: reviewer,
        decision: body.decision,
        finalVerdict,
        finalTags,
        note: body.note ?? '',
        createdAt: now,
        reviewedAt: now,
      };
      store.reviewTasks.push(review);
      return { review, qcResult };
    });
    sendJson(res, result);
  }),
);

/* ------------------------------ 转 badcase ------------------------------ */

qcRouter.post(
  '/qc/conversations/:id/badcases',
  asyncHandler(async (req, res) => {
    const body = parseBody(badcaseCreateSchema, req) as BadcaseCreateBody;
    const conversationId = String(req.params.id);
    const badcase = await mutateStore((store) => {
      const conversation = store.conversations.find((item) => item.id === conversationId);
      const qcResult = store.qcResults.find((item) => item.conversationId === conversationId);
      if (conversation === undefined || qcResult === undefined) {
        throw notFound(`会话不存在：${conversationId}`);
      }
      const existing = store.badcases.find(
        (item) => item.conversationId === conversationId && item.status !== 'closed',
      );
      if (existing !== undefined) {
        throw conflict('该会话已存在未关闭的 badcase', { badcaseId: existing.id, code: existing.code });
      }

      const now = realNow();
      const slaHours = body.slaHours ?? badcaseSlaHours(body.category);
      const owner = body.owner ?? badcaseOwner(body.category);
      const primaryTag = primaryTagOf(qcResult);
      const primaryTagName = primaryTag === null ? '会话风险' : TAG_MAP[primaryTag as TagCode].name;
      const title = body.title ?? `${conversation.id} · ${primaryTagName}`;
      const evidence = qcResult.tags.flatMap((tag) => tag.evidence).slice(0, 5);
      const id = nextSequentialId('bc-', store.badcases.map((item) => item.id));
      const year = new Date(demoNow()).getFullYear();
      const code = `BC-${year}-${id.slice('bc-'.length)}`;
      const severity = badcaseSeverity(qcResult.tags);

      // 复发判定：同坐席、14 天内、同主标签，已有已关闭 badcase（FR-BC-004）。
      const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
      const recurrenceOf =
        primaryTag === null
          ? null
          : (store.badcases
              .filter((item) => item.status === 'closed')
              .filter((item) => {
                const sourceConversation = store.conversations.find(
                  (candidate) => candidate.id === item.conversationId,
                );
                const sourceResult = store.qcResults.find(
                  (candidate) => candidate.conversationId === item.conversationId,
                );
                if (sourceConversation === undefined || sourceResult === undefined) {
                  return false;
                }
                if (sourceConversation.agent.id !== conversation.agent.id) {
                  return false;
                }
                if (primaryTagOf(sourceResult) !== primaryTag) {
                  return false;
                }
                const diff = new Date(now).getTime() - new Date(item.createdAt).getTime();
                return diff >= 0 && diff <= fourteenDaysMs;
              })
              .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0]?.id ?? null);

      const created: Badcase = {
        id,
        code,
        conversationId,
        qcResultId: qcResult.id,
        title,
        category: body.category,
        rootCause: body.rootCause ?? '',
        owner,
        creator: '沈言',
        severity,
        slaHours,
        dueAt: addHours(now, slaHours),
        status: 'open',
        recurrence: recurrenceOf !== null,
        recurrenceOf,
        evidence,
        closedAt: null,
        proof: null,
        timeline: [
          {
            at: now,
            by: '沈言',
            type: 'created',
            note: `从会话 ${conversation.id} 转 badcase（${primaryTagName}）`,
            from: null,
            to: 'open',
          },
        ],
        createdAt: now,
        updatedAt: now,
      };
      store.badcases.push(created);
      return created;
    });
    sendJson(res, badcase);
  }),
);

/** 供其他模块复用：按标签推荐归因类别。 */
export function suggestCategory(tag: TagCode): 'knowledge' | 'script' | 'process' | 'system' {
  return categoryForTag(tag);
}

/** 供其他模块复用：模型版本。 */
export const QC_MODEL_VERSION = MODEL_VERSION;
