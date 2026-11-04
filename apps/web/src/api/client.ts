/**
 * API 客户端：唯一网络出入口。
 * - 统一错误模型 ApiError（code/message/details/status），供页面做 409/422 差异化提示。
 * - 统一超时与网络错误中文提示。
 * - 不缓存、不 mock；后端不可用时由页面展示错误态。
 */
import type {
  AlertActionRequest,
  AlertDetail,
  AlertList,
  AlertListQuery,
  Badcase,
  BadcaseActionRequest,
  BadcaseCreateRequest,
  BadcaseList,
  BadcaseListQuery,
  BadcaseStats,
  Clue,
  ClueActionRequest,
  ClueCreateRequest,
  ClueList,
  ClueListQuery,
  CommentList,
  CommentListQuery,
  ConversationDetail,
  ConversationList,
  DashboardAnomaly,
  DashboardSummary,
  EvalDataset,
  EvalDatasetKey,
  EvalRun,
  EvalRunSummary,
  Health,
  KnowledgeCreateRequest,
  KnowledgeDetail,
  KnowledgeEntry,
  KnowledgeGap,
  KnowledgeListItem,
  KnowledgeListQuery,
  KnowledgeMutationResult,
  KnowledgeRecheck,
  KnowledgeRevisionRequest,
  KnowledgeStats,
  KnowledgeSuggestionRequest,
  Meta,
  QcListQuery,
  QcStats,
  Range,
  ResetResult,
  ReviewRequest,
  ReviewResult,
  SentimentAlert,
  SentimentStats,
  TrendsResponse,
} from '../types';

const API_BASE = '/api';
const DEFAULT_TIMEOUT_MS = 15000;

/* ---------------------------------- 错误模型 ---------------------------------- */

export interface ApiErrorInit {
  code: string;
  message: string;
  status: number;
  details?: Record<string, unknown> | null;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, unknown> | null;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = 'ApiError';
    this.code = init.code;
    this.status = init.status;
    this.details = init.details ?? null;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return '请求失败，请稍后重试';
}

/** 409 / 422 等业务错误常带 details，取其中可展示字段。 */
export function errorDetailText(error: unknown, key: string): string {
  if (!(error instanceof ApiError) || !error.details) return '';
  const value = error.details[key];
  return typeof value === 'string' ? value : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

interface ParsedError {
  code: string;
  message: string;
  details: Record<string, unknown> | null;
}

async function parseErrorResponse(response: Response): Promise<ParsedError> {
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && isRecord(body.error) && typeof body.error.message === 'string') {
      const code = typeof body.error.code === 'string' ? body.error.code : 'INTERNAL';
      const details = isRecord(body.error.details) ? body.error.details : null;
      return { code, message: body.error.message, details };
    }
  } catch {
    /* 非 JSON 错误体按 HTTP 状态兜底 */
  }
  return {
    code: 'INTERNAL',
    message: `请求失败（HTTP ${response.status}）`,
    details: null,
  };
}

/* ---------------------------------- 请求底座 ---------------------------------- */

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  timeoutMs?: number;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const parsed = await parseErrorResponse(response);
      throw new ApiError({
        code: parsed.code,
        message: parsed.message,
        status: response.status,
        details: parsed.details,
      });
    }
    if (response.status === 204) return undefined as T;
    const payload: unknown = await response.json();
    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError({ code: 'TIMEOUT', message: '请求超时，请重试', status: 0 });
    }
    throw new ApiError({
      code: 'NETWORK',
      message: '无法连接后端服务，请确认 127.0.0.1:8787 已启动',
      status: 0,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

/* ---------------------------------- 查询串 ---------------------------------- */

function buildQuery(source: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string') {
      if (value === '') continue;
      search.set(key, value);
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) continue;
      search.set(key, String(value));
    } else if (typeof value === 'boolean') {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

/* ---------------------------------- 基础 ---------------------------------- */

export function fetchHealth(): Promise<Health> {
  return request<Health>('/health');
}

export function fetchMeta(): Promise<Meta> {
  return request<Meta>('/meta');
}

export function resetDemoData(): Promise<ResetResult> {
  return request<ResetResult>('/admin/reset', { method: 'POST' });
}

/* ---------------------------------- 看板 ---------------------------------- */

export function fetchDashboardSummary(range: Range): Promise<DashboardSummary> {
  return request<DashboardSummary>(`/dashboard/summary${buildQuery({ range })}`);
}

export function fetchDashboardTrends(range: Range): Promise<TrendsResponse> {
  return request<TrendsResponse>(`/dashboard/trends${buildQuery({ range })}`);
}

export async function fetchDashboardAnomalies(): Promise<DashboardAnomaly[]> {
  const result = await request<{ items: DashboardAnomaly[] }>('/dashboard/anomalies');
  return result.items;
}

/* ---------------------------------- 质检 ---------------------------------- */

export function fetchQcStats(range: Range): Promise<QcStats> {
  return request<QcStats>(`/qc/stats${buildQuery({ range })}`);
}

export function fetchQcConversations(query: QcListQuery): Promise<ConversationList> {
  return request<ConversationList>(`/qc/conversations${buildQuery(query)}`);
}

export function fetchConversation(conversationId: string): Promise<ConversationDetail> {
  return request<ConversationDetail>(`/qc/conversations/${encodeURIComponent(conversationId)}`);
}

export function submitReview(conversationId: string, body: ReviewRequest): Promise<ReviewResult> {
  return request<ReviewResult>(`/qc/conversations/${encodeURIComponent(conversationId)}/reviews`, {
    method: 'POST',
    body,
  });
}

export function createBadcase(conversationId: string, body: BadcaseCreateRequest): Promise<Badcase> {
  return request<Badcase>(`/qc/conversations/${encodeURIComponent(conversationId)}/badcases`, {
    method: 'POST',
    body,
  });
}

/* ---------------------------------- 知识库 ---------------------------------- */

export function fetchKnowledgeList(query: KnowledgeListQuery): Promise<{ items: KnowledgeListItem[]; page: number; pageSize: number; total: number }> {
  return request<{ items: KnowledgeListItem[]; page: number; pageSize: number; total: number }>(
    `/knowledge${buildQuery(query)}`,
  );
}

export function fetchKnowledgeStats(): Promise<KnowledgeStats> {
  return request<KnowledgeStats>('/knowledge/stats');
}

export function fetchKnowledgeGaps(): Promise<{ items: KnowledgeGap[]; total: number }> {
  return request<{ items: KnowledgeGap[]; total: number }>('/knowledge/gaps');
}

export function fetchKnowledgeDetail(entryId: string): Promise<KnowledgeDetail> {
  return request<KnowledgeDetail>(`/knowledge/${encodeURIComponent(entryId)}`);
}

export function createKnowledge(body: KnowledgeCreateRequest): Promise<KnowledgeEntry> {
  return request<KnowledgeEntry>('/knowledge', { method: 'POST', body });
}

export function reviseKnowledge(entryId: string, body: KnowledgeRevisionRequest): Promise<KnowledgeEntry> {
  return request<KnowledgeEntry>(`/knowledge/${encodeURIComponent(entryId)}/revisions`, { method: 'POST', body });
}

export function publishKnowledge(entryId: string, body: { by?: string; note?: string } = {}): Promise<KnowledgeMutationResult> {
  return request<KnowledgeMutationResult>(`/knowledge/${encodeURIComponent(entryId)}/publish`, { method: 'POST', body });
}

export function offlineKnowledge(entryId: string, body: { by?: string; note?: string } = {}): Promise<KnowledgeMutationResult> {
  return request<KnowledgeMutationResult>(`/knowledge/${encodeURIComponent(entryId)}/offline`, { method: 'POST', body });
}

export function recheckKnowledge(entryId: string): Promise<KnowledgeRecheck> {
  return request<KnowledgeRecheck>(`/knowledge/${encodeURIComponent(entryId)}/recheck`, { method: 'POST' });
}

export function createKnowledgeSuggestion(body: KnowledgeSuggestionRequest): Promise<KnowledgeEntry> {
  return request<KnowledgeEntry>('/knowledge/suggestions', { method: 'POST', body });
}

/* ---------------------------------- badcase ---------------------------------- */

export function fetchBadcaseList(query: BadcaseListQuery): Promise<BadcaseList> {
  return request<BadcaseList>(`/badcases${buildQuery(query)}`);
}

export function fetchBadcaseStats(): Promise<BadcaseStats> {
  return request<BadcaseStats>('/badcases/stats');
}

export function fetchBadcase(badcaseId: string): Promise<Badcase> {
  return request<Badcase>(`/badcases/${encodeURIComponent(badcaseId)}`);
}

export function actOnBadcase(badcaseId: string, body: BadcaseActionRequest): Promise<Badcase> {
  return request<Badcase>(`/badcases/${encodeURIComponent(badcaseId)}/actions`, { method: 'POST', body });
}

/* ---------------------------------- 舆情 ---------------------------------- */

export function fetchSentimentStats(range: Range): Promise<SentimentStats> {
  return request<SentimentStats>(`/sentiment/stats${buildQuery({ range })}`);
}

export function fetchComments(query: CommentListQuery): Promise<CommentList> {
  return request<CommentList>(`/sentiment/comments${buildQuery(query)}`);
}

export function fetchAlerts(query: AlertListQuery): Promise<AlertList> {
  return request<AlertList>(`/sentiment/alerts${buildQuery(query)}`);
}

export function fetchAlert(alertId: string): Promise<AlertDetail> {
  return request<AlertDetail>(`/sentiment/alerts/${encodeURIComponent(alertId)}`);
}

export function actOnAlert(alertId: string, body: AlertActionRequest): Promise<SentimentAlert> {
  return request<SentimentAlert>(`/sentiment/alerts/${encodeURIComponent(alertId)}/actions`, {
    method: 'POST',
    body,
  });
}

/* ---------------------------------- 线索 ---------------------------------- */

export function fetchClues(query: ClueListQuery): Promise<ClueList> {
  return request<ClueList>(`/clues${buildQuery(query)}`);
}

export function fetchClue(clueId: string): Promise<Clue> {
  return request<Clue>(`/clues/${encodeURIComponent(clueId)}`);
}

export function createClue(body: ClueCreateRequest): Promise<Clue> {
  return request<Clue>('/clues', { method: 'POST', body });
}

export function actOnClue(clueId: string, body: ClueActionRequest): Promise<Clue> {
  return request<Clue>(`/clues/${encodeURIComponent(clueId)}/actions`, { method: 'POST', body });
}

/* ---------------------------------- 评测 ---------------------------------- */

export async function fetchEvalDatasets(): Promise<EvalDataset[]> {
  const result = await request<{ items: EvalDataset[] }>('/eval/datasets');
  return result.items;
}

export async function fetchEvalRuns(dataset?: EvalDatasetKey): Promise<EvalRunSummary[]> {
  const result = await request<{ items: EvalRunSummary[] }>(`/eval/runs${buildQuery({ dataset })}`);
  return result.items;
}

export function runEval(dataset: EvalDatasetKey): Promise<EvalRun> {
  return request<EvalRun>('/eval/runs', { method: 'POST', body: { dataset }, timeoutMs: 60000 });
}

export function fetchEvalRun(runId: string): Promise<EvalRun> {
  return request<EvalRun>(`/eval/runs/${encodeURIComponent(runId)}`);
}
