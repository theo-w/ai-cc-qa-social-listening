/**
 * 知识库路由（009 / API-KB-01..10）。
 *
 * 关键点：
 * - 静态路径（stats/gaps/suggestions）必须注册在 `/:id` 之前；
 * - 发布/下线后自动复测，复测只更新未完成人工复核的会话；
 * - suggestions 幂等：同一会话/badcase 已有草稿或关联条目时直接返回。
 */
import { Router } from 'express';
import { z } from 'zod';
import { OWNER_NAMES } from '../engine/taxonomy.js';
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
import {
  badcaseLinkedToEntry,
  buildKnowledgeDetail,
  buildKnowledgeGaps,
  buildKnowledgeListItems,
  buildKnowledgeStats,
  canPublishEntry,
  inferKnowledgeCategory,
  knowledgeById,
  recheckKnowledge,
} from '../knowledge.js';
import { getStore, mutateStore } from '../store.js';
import type {
  KnowledgeCategory,
  KnowledgeEntry,
  KnowledgeFact,
  KnowledgeRevision,
  KnowledgeSource,
  KnowledgeSourceRef,
  KnowledgeStatus,
  StoreData,
} from '../types.js';
import { nextSequentialId } from '../util/ids.js';
import { realNow } from '../util/time.js';

export const knowledgeRouter: Router = Router();

const KNOWLEDGE_OWNER = OWNER_NAMES.knowledge;

const categorySchema = z.enum(['refund', 'recharge', 'activity', 'version', 'account', 'other']);
const statusSchema = z.enum(['draft', 'published', 'offline']);
const sourceSchema = z.enum(['official', 'qc_badcase', 'manual']);
const compareSchema = z.enum(['number', 'duration_minutes', 'date', 'text']);

const factSchema = z.object({
  key: z.string().min(1).max(80),
  label: z.string().min(1).max(120),
  expected: z.string().min(1).max(300),
  compare: compareSchema,
  expectedNumber: z.number().nullable().optional(),
  expectedMinutes: z.number().nullable().optional(),
  expectedMonth: z.number().int().min(1).max(12).nullable().optional(),
  expectedDay: z.number().int().min(1).max(31).nullable().optional(),
  unit: z.string().max(20).nullable().optional(),
  claimPatterns: z.array(z.string().min(1).max(500)).max(20).default([]),
  violationPatterns: z.array(z.string().min(1).max(500)).max(20).default([]),
  note: z.string().max(1000).nullable().optional(),
});

const sourceRefSchema = z.object({
  type: z.enum(['conversation', 'badcase', 'manual']),
  id: z.string().min(1).max(80),
  label: z.string().max(200),
});

const createSchema = z.object({
  title: z.string().min(1).max(200),
  category: categorySchema,
  content: z.string().min(1).max(4000),
  facts: z.array(factSchema).max(20).optional(),
  keywords: z.array(z.string().min(1).max(50)).max(20).optional(),
  owner: z.string().min(1).max(40).optional(),
  source: sourceSchema.optional(),
  sourceRef: sourceRefSchema.nullable().optional(),
  linkedBadcaseIds: z.array(z.string()).max(50).optional(),
});

const revisionSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  category: categorySchema.optional(),
  content: z.string().min(1).max(4000),
  facts: z.array(factSchema).max(20).optional(),
  keywords: z.array(z.string().min(1).max(50)).max(20).optional(),
  note: z.string().max(1000).optional(),
  by: z.string().min(1).max(40).optional(),
});

const actionSchema = z.object({
  by: z.string().min(1).max(40).optional(),
  note: z.string().max(1000).optional(),
});

const suggestionSchema = z
  .object({
    conversationId: z.string().min(1).max(80).optional(),
    badcaseId: z.string().min(1).max(80).optional(),
  })
  .refine((body) => body.conversationId !== undefined || body.badcaseId !== undefined, {
    message: 'conversationId 与 badcaseId 至少提供一个',
    path: ['conversationId'],
  });

type CreateInput = {
  title: string;
  category: KnowledgeCategory;
  content: string;
  facts?: FactPayload[];
  keywords?: string[];
  owner?: string;
  source?: KnowledgeSource;
  sourceRef?: KnowledgeSourceRef | null;
  linkedBadcaseIds?: string[];
};

/** 请求体中的事实：正则数组在 Zod 默认值后可能仍被推断为可选，这里统一按可选处理。 */
interface FactPayload {
  key: string;
  label: string;
  expected: string;
  compare: KnowledgeFact['compare'];
  expectedNumber?: number | null;
  expectedMinutes?: number | null;
  expectedMonth?: number | null;
  expectedDay?: number | null;
  unit?: string | null;
  claimPatterns?: string[];
  violationPatterns?: string[];
  note?: string | null;
}

/** 校验事实中的正则可编译；不可编译返回 422（防止引擎运行时静默失效）。 */
function validateFacts(facts: readonly FactPayload[] | undefined): void {
  for (const fact of facts ?? []) {
    for (const source of [...(fact.claimPatterns ?? []), ...(fact.violationPatterns ?? [])]) {
      try {
        new RegExp(source);
      } catch {
        throw validationError(`事实「${fact.label}」的识别正则非法：${source}`, {
          field: 'facts',
          pattern: source,
        });
      }
    }
  }
}

function normalizeFacts(facts: readonly FactPayload[] | undefined): KnowledgeFact[] {
  return (facts ?? []).map((fact) => ({
    key: fact.key,
    label: fact.label,
    expected: fact.expected,
    compare: fact.compare,
    expectedNumber: fact.expectedNumber ?? null,
    expectedMinutes: fact.expectedMinutes ?? null,
    expectedMonth: fact.expectedMonth ?? null,
    expectedDay: fact.expectedDay ?? null,
    unit: fact.unit ?? null,
    claimPatterns: [...(fact.claimPatterns ?? [])],
    violationPatterns: [...(fact.violationPatterns ?? [])],
    note: fact.note ?? null,
  }));
}

function nextCode(entries: readonly KnowledgeEntry[]): string {
  let max = 1000;
  for (const entry of entries) {
    const matched = /^KB-(\d+)$/.exec(entry.code);
    const value = matched?.[1] === undefined ? Number.NaN : Number(matched[1]);
    if (Number.isInteger(value) && value > max) {
      max = value;
    }
  }
  return `KB-${max + 1}`;
}

function makeEntry(input: CreateInput, store: StoreData, now: string): KnowledgeEntry {
  const owner = input.owner ?? KNOWLEDGE_OWNER;
  const facts = normalizeFacts(input.facts);
  const revision: KnowledgeRevision = {
    version: 1,
    status: 'draft',
    content: input.content,
    facts,
    note: '新建草稿',
    by: owner,
    at: now,
  };
  return {
    id: nextSequentialId('kb-', store.knowledgeEntries.map((entry) => entry.id)),
    code: nextCode(store.knowledgeEntries),
    title: input.title,
    category: input.category,
    status: 'draft',
    version: 1,
    content: input.content,
    facts,
    keywords: [...(input.keywords ?? [])],
    owner,
    source: input.source ?? 'manual',
    sourceRef: input.sourceRef ?? null,
    linkedBadcaseIds: [...(input.linkedBadcaseIds ?? [])],
    revisions: [revision],
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
  };
}

/* ------------------------------ 列表 / 统计 / 缺口 ------------------------------ */

knowledgeRouter.get(
  '/knowledge/stats',
  asyncHandler((_req, res) => {
    sendJson(res, buildKnowledgeStats(getStore()));
  }),
);

knowledgeRouter.get(
  '/knowledge/gaps',
  asyncHandler((_req, res) => {
    const gaps = buildKnowledgeGaps(getStore());
    sendJson(res, { items: gaps, total: gaps.length });
  }),
);

knowledgeRouter.get(
  '/knowledge',
  asyncHandler((req, res) => {
    const { page, pageSize } = parsePagination(req);
    const q = queryString(req, 'q')?.toLowerCase();
    const rawStatus = queryString(req, 'status');
    const rawCategory = queryString(req, 'category');
    const rawSource = queryString(req, 'source');
    const badcaseId = queryString(req, 'badcaseId');

    if (rawStatus !== undefined && !(statusSchema.options as readonly string[]).includes(rawStatus)) {
      throw validationError('status 必须为 draft / published / offline', { field: 'status', value: rawStatus });
    }
    if (rawCategory !== undefined && !(categorySchema.options as readonly string[]).includes(rawCategory)) {
      throw validationError('category 取值非法', { field: 'category', value: rawCategory });
    }
    if (rawSource !== undefined && !(sourceSchema.options as readonly string[]).includes(rawSource)) {
      throw validationError('source 取值非法', { field: 'source', value: rawSource });
    }

    const store = getStore();
    let entries = store.knowledgeEntries;
    if (badcaseId !== undefined) {
      const badcase = store.badcases.find((item) => item.id === badcaseId);
      if (badcase === undefined) {
        throw notFound(`badcase 不存在：${badcaseId}`);
      }
      entries = entries.filter((entry) => badcaseLinkedToEntry(store, badcase, entry));
    }
    if (rawStatus !== undefined) {
      entries = entries.filter((entry) => entry.status === (rawStatus as KnowledgeStatus));
    }
    if (rawCategory !== undefined) {
      entries = entries.filter((entry) => entry.category === (rawCategory as KnowledgeCategory));
    }
    if (rawSource !== undefined) {
      entries = entries.filter((entry) => entry.source === (rawSource as KnowledgeSource));
    }
    if (q !== undefined) {
      entries = entries.filter((entry) =>
        [entry.code, entry.title, entry.content, ...entry.keywords].join(' ').toLowerCase().includes(q),
      );
    }

    const items = buildKnowledgeListItems({ ...store, knowledgeEntries: entries }).sort((left, right) => {
      const timeDiff = new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      return timeDiff !== 0 ? timeDiff : left.code.localeCompare(right.code);
    });
    sendJson(res, paginate(items, page, pageSize));
  }),
);

/* ------------------------------ 草稿生成（幂等） ------------------------------ */

knowledgeRouter.post(
  '/knowledge/suggestions',
  asyncHandler(async (req, res) => {
    const body = parseBody(suggestionSchema, req);
    const created = await mutateStore((store) => {
      const now = realNow();
      let sourceRef: KnowledgeSourceRef;
      let quote = '';
      let note = '';
      let conversationId: string;
      let badcaseId: string | undefined;
      let existingEntryId: string | undefined;

      if (body.badcaseId !== undefined) {
        const badcase = store.badcases.find((item) => item.id === body.badcaseId);
        if (badcase === undefined) {
          throw notFound(`badcase 不存在：${body.badcaseId}`);
        }
        if (badcase.category !== 'knowledge') {
          throw validationError('仅知识类 badcase 可生成知识完善草稿', { field: 'badcaseId', value: badcase.id });
        }
        conversationId = badcase.conversationId;
        badcaseId = badcase.id;
        sourceRef = { type: 'badcase', id: badcase.id, label: badcase.code };
        quote = badcase.evidence[0]?.quote ?? badcase.rootCause;
        note = badcase.title;
        const linked = store.knowledgeEntries.find((entry) =>
          badcaseLinkedToEntry(store, badcase, entry),
        );
        existingEntryId = linked?.id;
      } else {
        conversationId = body.conversationId as string;
        const conversation = store.conversations.find((item) => item.id === conversationId);
        const result = store.qcResults.find((item) => item.conversationId === conversationId);
        if (conversation === undefined || result === undefined) {
          throw notFound(`会话不存在：${conversationId}`);
        }
        const tag = result.tags.find((item) => item.code === 'wrong_knowledge');
        if (tag === undefined) {
          throw validationError('该会话没有知识错误命中，无法生成知识草稿', {
            field: 'conversationId',
            value: conversationId,
          });
        }
        if (tag.knowledge) {
          existingEntryId = tag.knowledge.entryId;
        } else {
          const linked = store.knowledgeEntries.find(
            (entry) =>
              entry.sourceRef?.type === 'conversation' && entry.sourceRef.id === conversationId,
          );
          existingEntryId = linked?.id;
        }
        quote = tag.evidence[0]?.quote ?? '';
        note = tag.evidence[0]?.note ?? '知识错误命中未关联知识条目';
        sourceRef = { type: 'conversation', id: conversationId, label: conversationId };
      }

      if (existingEntryId !== undefined) {
        const existing = knowledgeById(store, existingEntryId);
        if (existing !== undefined) {
          return existing;
        }
      }

      const category = inferKnowledgeCategory(`${quote} ${note}`);
      const title = `知识完善：${note.slice(0, 80)}`;
      const fact: KnowledgeFact = {
        key: 'custom_fact_1',
        label: note.slice(0, 120) || '待补充事实',
        expected: '待补充（请核对官方口径）',
        compare: 'text',
        expectedNumber: null,
        expectedMinutes: null,
        expectedMonth: null,
        expectedDay: null,
        unit: null,
        claimPatterns: [],
        violationPatterns: [],
        note: `来源 ${conversationId}${badcaseId ? ` / ${badcaseId}` : ''}；原文：${quote}`,
      };
      const entry = makeEntry(
        {
          title,
          category,
          content: `由质检发现的知识缺口生成，请补充标准口径后发布。\n证据：${quote || '（无原文）'}\n说明：${note}`,
          facts: [
            {
              key: fact.key,
              label: fact.label,
              expected: fact.expected,
              compare: 'text',
              claimPatterns: [],
              violationPatterns: [],
              note: fact.note ?? undefined,
            },
          ],
          owner: KNOWLEDGE_OWNER,
          source: 'qc_badcase',
          sourceRef,
          linkedBadcaseIds: badcaseId === undefined ? [] : [badcaseId],
        },
        store,
        now,
      );
      store.knowledgeEntries.push(entry);
      return entry;
    });
    sendJson(res, created);
  }),
);

/* ------------------------------ 详情 / 创建 / 修订 ------------------------------ */

knowledgeRouter.get(
  '/knowledge/:id',
  asyncHandler((req, res) => {
    const store = getStore();
    const entry = knowledgeById(store, String(req.params.id));
    if (entry === undefined) {
      throw notFound(`知识条目不存在：${String(req.params.id)}`);
    }
    sendJson(res, buildKnowledgeDetail(store, entry));
  }),
);

knowledgeRouter.post(
  '/knowledge',
  asyncHandler(async (req, res) => {
    const body = parseBody(createSchema, req);
    validateFacts(body.facts);
    const entry = await mutateStore((store) => {
      const created = makeEntry(body, store, realNow());
      store.knowledgeEntries.push(created);
      return created;
    });
    sendJson(res, entry);
  }),
);

knowledgeRouter.post(
  '/knowledge/:id/revisions',
  asyncHandler(async (req, res) => {
    const body = parseBody(revisionSchema, req);
    validateFacts(body.facts);
    const entry = await mutateStore((store) => {
      const target = knowledgeById(store, String(req.params.id));
      if (target === undefined) {
        throw notFound(`知识条目不存在：${String(req.params.id)}`);
      }
      const now = realNow();
      const by = body.by ?? target.owner ?? KNOWLEDGE_OWNER;
      const facts = body.facts === undefined ? target.facts : normalizeFacts(body.facts);

      if (target.status === 'draft') {
        // 草稿修订：直接替换当前版本，不增加版本号。
        target.title = body.title ?? target.title;
        target.category = body.category ?? target.category;
        target.content = body.content;
        target.facts = facts;
        target.keywords = body.keywords === undefined ? target.keywords : [...body.keywords];
        const current = target.revisions[target.revisions.length - 1];
        if (current !== undefined) {
          current.content = body.content;
          current.facts = facts;
          current.note = body.note ?? current.note;
          current.by = by;
          current.at = now;
        }
        target.updatedAt = now;
        return target;
      }

      // 已发布/已下线修订：版本 +1，回到 draft，旧版本留档。
      const version = target.version + 1;
      const revision: KnowledgeRevision = {
        version,
        status: 'draft',
        content: body.content,
        facts,
        note: body.note ?? '修订草稿',
        by,
        at: now,
      };
      target.title = body.title ?? target.title;
      target.category = body.category ?? target.category;
      target.version = version;
      target.status = 'draft';
      target.content = body.content;
      target.facts = facts;
      target.keywords = body.keywords === undefined ? target.keywords : [...body.keywords];
      target.revisions.push(revision);
      target.updatedAt = now;
      return target;
    });
    sendJson(res, entry);
  }),
);

/* ------------------------------ 发布 / 下线 / 复测 ------------------------------ */

knowledgeRouter.post(
  '/knowledge/:id/publish',
  asyncHandler(async (req, res) => {
    const body = parseBody(actionSchema, req);
    const result = await mutateStore((store) => {
      const entry = knowledgeById(store, String(req.params.id));
      if (entry === undefined) {
        throw notFound(`知识条目不存在：${String(req.params.id)}`);
      }
      if (entry.status === 'published') {
        throw conflict('知识条目已发布，如需修改请先创建修订', { entryId: entry.id, status: entry.status });
      }
      if (!canPublishEntry(entry)) {
        throw validationError('发布前请至少补充 1 条可校验事实（识别正则或直接违规正则）', {
          field: 'facts',
          entryId: entry.id,
        });
      }
      const now = realNow();
      entry.status = 'published';
      const last = entry.revisions[entry.revisions.length - 1];
      if (last !== undefined) {
        last.status = 'published';
        if (body.note && body.note.trim() !== '') {
          last.note = body.note;
        }
      }
      entry.publishedAt = now;
      entry.updatedAt = now;
      const recheck = recheckKnowledge(store, now);
      return { entry, recheck };
    });
    sendJson(res, result);
  }),
);

knowledgeRouter.post(
  '/knowledge/:id/offline',
  asyncHandler(async (req, res) => {
    const body = parseBody(actionSchema, req);
    const result = await mutateStore((store) => {
      const entry = knowledgeById(store, String(req.params.id));
      if (entry === undefined) {
        throw notFound(`知识条目不存在：${String(req.params.id)}`);
      }
      if (entry.status !== 'published') {
        throw conflict('仅已发布条目可下线', { entryId: entry.id, status: entry.status });
      }
      const now = realNow();
      entry.status = 'offline';
      const last = entry.revisions[entry.revisions.length - 1];
      if (last !== undefined) {
        last.status = 'offline';
        if (body.note && body.note.trim() !== '') {
          last.note = body.note;
        }
      }
      entry.updatedAt = now;
      const recheck = recheckKnowledge(store, now);
      return { entry, recheck };
    });
    sendJson(res, result);
  }),
);

knowledgeRouter.post(
  '/knowledge/:id/recheck',
  asyncHandler(async (req, res) => {
    const result = await mutateStore((store) => {
      const entry = knowledgeById(store, String(req.params.id));
      if (entry === undefined) {
        throw notFound(`知识条目不存在：${String(req.params.id)}`);
      }
      return recheckKnowledge(store, realNow());
    });
    sendJson(res, result);
  }),
);
