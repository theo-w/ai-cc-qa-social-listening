/**
 * 知识库服务（009）：种子投影、质检统计、缺口、详情、复测。
 *
 * 设计约束：
 * - 纯函数优先：除 recheckKnowledge 会按传入的 now 修改 store 外，其余只读；
 * - 确定性：复测使用传入时间，不使用 Date.now()；
 * - 人工复核优先：复测不覆盖已完成复核（done）的会话。
 */
import { analyzeQc } from './engine/qc.js';
import { publishedKnowledge } from './engine/knowledge.js';
import { OWNER_NAMES, TAG_MAP } from './engine/taxonomy.js';
import { REVIEW_CONFIDENCE_THRESHOLD } from './config.js';
import type {
  Badcase,
  KnowledgeCategory,
  KnowledgeDetail,
  KnowledgeEntry,
  KnowledgeFact,
  KnowledgeGap,
  KnowledgeHit,
  KnowledgeListItem,
  KnowledgeRecheck,
  KnowledgeRecheckStats,
  KnowledgeRef,
  KnowledgeSeedEntry,
  KnowledgeStats,
  QcTag,
  ReviewTask,
  StoreData,
} from './types.js';
import { nextSequentialId } from './util/ids.js';
import { ratio } from './util/time.js';

const KNOWLEDGE_OWNER = OWNER_NAMES.knowledge;

function cloneFacts(facts: readonly KnowledgeFact[]): KnowledgeFact[] {
  return facts.map((fact) => ({
    ...fact,
    claimPatterns: [...fact.claimPatterns],
    violationPatterns: [...fact.violationPatterns],
  }));
}

/** 把 data/knowledge/entries.json 的种子投影为运行态知识条目。 */
export function buildKnowledgeEntries(seedEntries: readonly KnowledgeSeedEntry[]): KnowledgeEntry[] {
  return seedEntries.map((seed, index) => {
    const revisions = [...seed.revisions]
      .sort((left, right) => left.version - right.version)
      .map((revision) => ({ ...revision, facts: cloneFacts(revision.facts) }));
    const first = revisions[0] ?? {
      version: 1,
      status: 'draft' as const,
      content: '待补充标准口径',
      facts: [],
      note: '自动补全的空草稿',
      by: seed.owner || KNOWLEDGE_OWNER,
      at: '2026-11-03T10:00:00+08:00',
    };
    const current = revisions[revisions.length - 1] ?? first;
    const lastPublished = [...revisions].reverse().find((revision) => revision.status === 'published');
    return {
      id: `kb-${String(index + 1).padStart(4, '0')}`,
      code: seed.code,
      title: seed.title,
      category: seed.category,
      status: current.status,
      version: current.version,
      content: current.content,
      facts: cloneFacts(current.facts),
      keywords: [...seed.keywords],
      owner: seed.owner || KNOWLEDGE_OWNER,
      source: seed.source,
      sourceRef: seed.sourceRef ? { ...seed.sourceRef } : null,
      linkedBadcaseIds: [...seed.linkedBadcaseIds],
      revisions,
      createdAt: first.at,
      updatedAt: current.at,
      publishedAt: lastPublished?.at ?? null,
      seedKey: seed.key,
    } satisfies KnowledgeEntry;
  });
}

/** 索引：id → 条目。 */
export function knowledgeById(store: StoreData, id: string): KnowledgeEntry | undefined {
  return store.knowledgeEntries.find((entry) => entry.id === id);
}

/** 知识错误标签的引用是否指向某条目。 */
function tagReferencesEntry(tag: QcTag, entryId: string): boolean {
  return tag.code === 'wrong_knowledge' && tag.knowledge?.entryId === entryId;
}

/** 某条目的知识错误命中会话/标签数。 */
export function knowledgeHitCounts(
  store: StoreData,
  entryId: string,
): { hits: number; conversations: number } {
  let hits = 0;
  const conversations = new Set<string>();
  for (const result of store.qcResults) {
    for (const tag of result.tags) {
      if (tagReferencesEntry(tag, entryId)) {
        hits += 1;
        conversations.add(result.conversationId);
      }
    }
  }
  return { hits, conversations: conversations.size };
}

/** badcase 是否已关联到某条目（多种关联方式取并集）。 */
export function badcaseLinkedToEntry(store: StoreData, badcase: Badcase, entry: KnowledgeEntry): boolean {
  if (entry.linkedBadcaseIds.includes(badcase.id)) {
    return true;
  }
  if (entry.sourceRef?.type === 'badcase' && entry.sourceRef.id === badcase.id) {
    return true;
  }
  if (entry.sourceRef?.type === 'conversation' && entry.sourceRef.id === badcase.conversationId) {
    return true;
  }
  const result = store.qcResults.find((candidate) => candidate.conversationId === badcase.conversationId);
  if (result !== undefined) {
    return result.tags.some((tag) => tagReferencesEntry(tag, entry.id));
  }
  return false;
}

/** 已关联知识条目的 badcase id 集合（缺口计算用）。 */
function linkedBadcaseIds(store: StoreData): Set<string> {
  const linked = new Set<string>();
  for (const entry of store.knowledgeEntries) {
    for (const id of entry.linkedBadcaseIds) {
      linked.add(id);
    }
    if (entry.sourceRef?.type === 'badcase') {
      linked.add(entry.sourceRef.id);
    }
    if (entry.sourceRef?.type === 'conversation') {
      for (const badcase of store.badcases) {
        if (badcase.conversationId === entry.sourceRef.id) {
          linked.add(badcase.id);
        }
      }
    }
  }
  for (const result of store.qcResults) {
    if (!result.tags.some((tag) => tag.code === 'wrong_knowledge' && tag.knowledge)) {
      continue;
    }
    for (const badcase of store.badcases) {
      if (badcase.conversationId === result.conversationId) {
        linked.add(badcase.id);
      }
    }
  }
  return linked;
}

/** 按原话推断知识分类（缺口/草稿预填用，确定性）。 */
export function inferKnowledgeCategory(text: string): KnowledgeCategory {
  if (/(退款|退钱|退到|手续费|原路退回)/.test(text)) {
    return 'refund';
  }
  if (/(充值|返利|返现|订单|支付|钻石|氪)/.test(text)) {
    return 'recharge';
  }
  if (/(活动|抽卡|奖励|签到|抽奖|礼包)/.test(text)) {
    return 'activity';
  }
  if (/(版本|上线|更新|维护|公告|赛季)/.test(text)) {
    return 'version';
  }
  if (/(封号|封禁|误封|账号|申诉|解封|盗号)/.test(text)) {
    return 'account';
  }
  return 'other';
}

/** 知识缺口：未关联的质检命中（按规则聚合）+ 未关联的知识类 badcase。 */
export function buildKnowledgeGaps(store: StoreData): KnowledgeGap[] {
  const gaps: KnowledgeGap[] = [];
  interface RuleGroup {
    ruleId: string;
    count: number;
    sample: KnowledgeGap['sample'];
  }
  const byRule = new Map<string, RuleGroup>();
  for (const result of store.qcResults) {
    const conversation = store.conversations.find((item) => item.id === result.conversationId);
    for (const tag of result.tags) {
      if (tag.code !== 'wrong_knowledge' || tag.knowledge) {
        continue;
      }
      const evidence = tag.evidence[0];
      const key = tag.ruleId;
      const existing = byRule.get(key);
      if (existing === undefined) {
        byRule.set(key, {
          ruleId: key,
          count: 1,
          sample: {
            conversationId: result.conversationId,
            seq: evidence?.seq ?? 0,
            quote: evidence?.quote ?? '',
            note: evidence?.note ?? `${conversation?.agent.name ?? ''} 的知识错误命中未关联知识条目`,
          },
        });
      } else {
        existing.count += 1;
      }
    }
  }
  for (const group of [...byRule.values()].sort((left, right) => left.ruleId.localeCompare(right.ruleId))) {
    const note = group.sample.note || '知识错误命中未关联知识条目';
    const category = inferKnowledgeCategory(`${group.sample.quote} ${note}`);
    gaps.push({
      id: `gap-${group.ruleId}`,
      type: 'unlinked_qc_hit',
      ruleId: group.ruleId,
      badcaseId: null,
      title: `知识缺口：${note}`,
      count: group.count,
      category,
      owner: KNOWLEDGE_OWNER,
      sample: group.sample,
    });
  }

  const linked = linkedBadcaseIds(store);
  for (const badcase of store.badcases) {
    if (badcase.category !== 'knowledge' || linked.has(badcase.id)) {
      continue;
    }
    const evidence = badcase.evidence[0];
    gaps.push({
      id: `gap-${badcase.id}`,
      type: 'unlinked_badcase',
      ruleId: null,
      badcaseId: badcase.id,
      title: `知识类 badcase ${badcase.code} 未关联知识条目`,
      count: 1,
      category: inferKnowledgeCategory(`${badcase.title} ${badcase.rootCause} ${evidence?.quote ?? ''}`),
      owner: badcase.owner,
      sample: {
        conversationId: badcase.conversationId,
        seq: evidence?.seq ?? 0,
        quote: evidence?.quote ?? '',
        note: badcase.title,
      },
    });
  }
  return gaps;
}

/** 知识库统计。 */
export function buildKnowledgeStats(store: StoreData): KnowledgeStats {
  const counts = { draft: 0, published: 0, offline: 0 };
  const byCategory = new Map<string, number>();
  for (const entry of store.knowledgeEntries) {
    counts[entry.status] += 1;
    byCategory.set(entry.category, (byCategory.get(entry.category) ?? 0) + 1);
  }

  let knowledgeTags = 0;
  let linkedTags = 0;
  const conversations = new Set<string>();
  for (const result of store.qcResults) {
    for (const tag of result.tags) {
      if (tag.code !== 'wrong_knowledge') {
        continue;
      }
      knowledgeTags += 1;
      conversations.add(result.conversationId);
      if (tag.knowledge) {
        linkedTags += 1;
      }
    }
  }

  const knowledgeBadcases = store.badcases.filter((badcase) => badcase.category === 'knowledge');
  const linkedBadcases = linkedBadcaseIds(store);
  const linkedKnowledgeBadcases = knowledgeBadcases.filter((badcase) => linkedBadcases.has(badcase.id)).length;
  const gaps = buildKnowledgeGaps(store);

  return {
    total: store.knowledgeEntries.length,
    published: counts.published,
    draft: counts.draft,
    offline: counts.offline,
    byCategory: [...byCategory.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((left, right) => left.category.localeCompare(right.category)),
    hits: {
      knowledgeTags,
      linked: linkedTags,
      unlinked: knowledgeTags - linkedTags,
      conversations: conversations.size,
      linkRate: ratio(linkedTags, knowledgeTags),
    },
    gaps: gaps.length,
    knowledgeBadcases: knowledgeBadcases.length,
    linkedKnowledgeBadcases,
  };
}

/** 列表项（含命中与关联 badcase 数）。 */
export function buildKnowledgeListItems(store: StoreData): KnowledgeListItem[] {
  return store.knowledgeEntries.map((entry) => {
    const hits = knowledgeHitCounts(store, entry.id);
    const linkedBadcases = store.badcases.filter(
      (badcase) => badcase.category === 'knowledge' && badcaseLinkedToEntry(store, badcase, entry),
    ).length;
    return {
      id: entry.id,
      code: entry.code,
      title: entry.title,
      category: entry.category,
      status: entry.status,
      version: entry.version,
      owner: entry.owner,
      source: entry.source,
      knowledgeHits: hits.hits,
      linkedHits: hits.hits,
      linkedBadcases,
      updatedAt: entry.updatedAt,
    };
  });
}

/** 条目详情：条目 + 知识错误证据 + 关联 badcase。 */
export function buildKnowledgeDetail(store: StoreData, entry: KnowledgeEntry): KnowledgeDetail {
  const hits: KnowledgeHit[] = [];
  for (const result of store.qcResults) {
    const conversation = store.conversations.find((item) => item.id === result.conversationId);
    for (const tag of result.tags) {
      if (!tagReferencesEntry(tag, entry.id)) {
        continue;
      }
      for (const evidence of tag.evidence) {
        hits.push({
          conversationId: result.conversationId,
          agentName: conversation?.agent.name ?? '',
          seq: evidence.seq,
          quote: evidence.quote,
          expected: tag.knowledge?.expected ?? '',
          actual: tag.knowledge?.actual ?? '',
        });
      }
    }
  }
  const badcases = store.badcases.filter(
    (badcase) => badcase.category === 'knowledge' && badcaseLinkedToEntry(store, badcase, entry),
  );
  return { entry, hits, badcases };
}

/** 复测前后统计（只统计知识标签与缺口）。 */
function recheckStats(store: StoreData): KnowledgeRecheckStats {
  let knowledgeTags = 0;
  let linked = 0;
  for (const result of store.qcResults) {
    for (const tag of result.tags) {
      if (tag.code !== 'wrong_knowledge') {
        continue;
      }
      knowledgeTags += 1;
      if (tag.knowledge) {
        linked += 1;
      }
    }
  }
  return {
    knowledgeTags,
    linkedKnowledgeTags: linked,
    unlinkedKnowledgeTags: knowledgeTags - linked,
    gaps: buildKnowledgeGaps(store).length,
  };
}

function tagSignature(tags: readonly QcTag[]): string[] {
  return tags
    .map((tag) => {
      const ref = tag.knowledge ? `${tag.knowledge.entryId}/${tag.knowledge.factKey}` : '-';
      return `${tag.code}:${ref}`;
    })
    .sort();
}

/** 维护 pending 复核任务：不再需要的移除，新需要的补建。 */
function maintainReviewTasks(store: StoreData, now: string): void {
  const reviewed = new Set(
    store.reviewTasks.filter((task) => task.status === 'done').map((task) => task.conversationId),
  );
  const resultByConversation = new Map(store.qcResults.map((result) => [result.conversationId, result]));
  store.reviewTasks = store.reviewTasks.filter((task) => {
    if (task.status !== 'pending') {
      return true;
    }
    if (reviewed.has(task.conversationId)) {
      return true;
    }
    return resultByConversation.get(task.conversationId)?.needsReview === true;
  });
  const pendingConversations = new Set(
    store.reviewTasks.filter((task) => task.status === 'pending').map((task) => task.conversationId),
  );
  for (const result of store.qcResults) {
    if (!result.needsReview || reviewed.has(result.conversationId) || pendingConversations.has(result.conversationId)) {
      continue;
    }
    const task: ReviewTask = {
      id: nextSequentialId('rvw-', store.reviewTasks.map((item) => item.id)),
      qcResultId: result.id,
      conversationId: result.conversationId,
      status: 'pending',
      assignee: OWNER_NAMES.qc,
      decision: null,
      finalVerdict: null,
      finalTags: [],
      note: `知识库复测后置信度 ${result.confidence.toFixed(2)} 低于 ${REVIEW_CONFIDENCE_THRESHOLD.toFixed(2)}，自动生成人工复核任务。`,
      createdAt: now,
      reviewedAt: null,
    };
    store.reviewTasks.push(task);
    pendingConversations.add(result.conversationId);
  }
}

/**
 * 知识库复测：对全部未完成人工复核的会话重新执行质检。
 * 返回 before/after 统计与最多 20 条变化明细；直接修改 store。
 */
export function recheckKnowledge(store: StoreData, now: string): KnowledgeRecheck {
  const before = recheckStats(store);
  const reviewed = new Set(
    store.reviewTasks.filter((task) => task.status === 'done').map((task) => task.conversationId),
  );
  const conversationById = new Map(store.conversations.map((conversation) => [conversation.id, conversation]));
  const changes: KnowledgeRecheck['changes'] = [];
  let rechecked = 0;
  let changed = 0;

  for (const result of store.qcResults) {
    if (reviewed.has(result.conversationId)) {
      continue;
    }
    const conversation = conversationById.get(result.conversationId);
    if (conversation === undefined) {
      continue;
    }
    rechecked += 1;
    const analysis = analyzeQc(conversation.messages, store.knowledgeEntries);
    const beforeTags = tagSignature(result.tags);
    const afterTags = tagSignature(analysis.tags);
    if (beforeTags.join('|') === afterTags.join('|')) {
      continue;
    }
    result.score = analysis.score;
    result.verdict = analysis.verdict;
    result.tags = analysis.tags;
    result.summary = analysis.summary;
    result.emotion = analysis.emotion;
    result.confidence = analysis.confidence;
    result.needsReview = analysis.needsReview;
    result.analyzedAt = now;
    changed += 1;
    changes.push({
      conversationId: result.conversationId,
      beforeTags: beforeTags.map((signature) => signature.split(':')[0] ?? signature),
      afterTags: afterTags.map((signature) => signature.split(':')[0] ?? signature),
    });
  }

  maintainReviewTasks(store, now);
  const after = recheckStats(store);
  return {
    rechecked,
    changed,
    before,
    after,
    changes: changes.slice(0, 20),
  };
}

/** 质检标签的知识引用（供路由/前端复用）。 */
export function knowledgeRefOfTag(tag: QcTag): KnowledgeRef | null {
  return tag.code === 'wrong_knowledge' ? (tag.knowledge ?? null) : null;
}

/** 条目是否可用于发布（至少 1 条事实具备 claimPatterns / violationPatterns）。 */
export function canPublishEntry(entry: KnowledgeEntry): boolean {
  return entry.facts.some(
    (fact) =>
      fact.claimPatterns.length > 0 ||
      fact.violationPatterns.length > 0,
  );
}

/** 已发布条目（供复测/评测复用）。 */
export function publishedEntries(store: StoreData): KnowledgeEntry[] {
  return publishedKnowledge(store.knowledgeEntries);
}

/** 供质检摘要使用：知识标签名。 */
export const KNOWLEDGE_TAG_NAME = TAG_MAP.wrong_knowledge.name;
