/**
 * HTTP 基础设施：统一错误模型、422 校验、脱敏序列化、分页/查询参数解析。
 *
 * 错误响应统一为 { error: { code, message, details? } }，
 * code ∈ BAD_REQUEST | NOT_FOUND | CONFLICT | VALIDATION_ERROR | INTERNAL（openapi Error）。
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodType } from 'zod';
import { DataLoadError } from './data.js';
import { maskName, maskText } from './util/mask.js';

export type ErrorCode = 'BAD_REQUEST' | 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION_ERROR' | 'INTERNAL';

export class HttpError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | null;

  constructor(status: number, code: ErrorCode, message: string, details?: Record<string, unknown> | null) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details ?? null;
  }
}

export function badRequest(message: string, details?: Record<string, unknown>): HttpError {
  return new HttpError(400, 'BAD_REQUEST', message, details);
}

export function notFound(message: string, details?: Record<string, unknown>): HttpError {
  return new HttpError(404, 'NOT_FOUND', message, details);
}

export function conflict(message: string, details?: Record<string, unknown>): HttpError {
  return new HttpError(409, 'CONFLICT', message, details);
}

export function validationError(message: string, details?: Record<string, unknown>): HttpError {
  return new HttpError(422, 'VALIDATION_ERROR', message, details);
}

/** 递归脱敏：text / name 字段统一掩码（幂等，不会破坏正常中文与已掩码内容）。 */
function sanitizeDeep(value: unknown, key?: string): unknown {
  if (typeof value === 'string') {
    if (key === 'text') {
      return maskText(value);
    }
    if (key === 'name') {
      return maskName(value);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDeep(item, key));
  }
  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      result[childKey] = sanitizeDeep(childValue, childKey);
    }
    return result;
  }
  return value;
}

/** 统一 JSON 输出（自动脱敏）。 */
export function sendJson(res: Response, data: unknown, status = 200): void {
  res.status(status).json(sanitizeDeep(data));
}

/** 包装 async 路由处理器，把 rejection 交给统一错误中间件。 */
export function asyncHandler(handler: (req: Request, res: Response) => Promise<void> | void): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res)).catch(next);
  };
}

/** 解析并校验请求体（ZodError 直接映射为 422）。 */
export function parseBody<T>(schema: ZodType<T>, req: Request): T {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    throw validationError('请求参数校验失败', issueDetails(result.error));
  }
  return result.data;
}

/** zod 错误的统一 details：field 为首个错误的顶层字段，issues 保留完整路径（如 finalTags.0）。 */
export function issueDetails(error: ZodError): Record<string, unknown> {
  const firstIssue = error.issues[0];
  return {
    field: firstIssue === undefined ? null : String(firstIssue.path[0] ?? '(root)'),
    issues: formatIssues(error),
  };
}

export function formatIssues(error: ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

/** 读取查询参数（字符串，忽略数组/空串）。 */
export function queryString(req: Request, name: string): string | undefined {
  const value = req.query[name];
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return undefined;
}

/** 分页参数：page ≥1，pageSize 1..100，默认 1/20（openapi Page/PageSize）。 */
export function parsePagination(req: Request): { page: number; pageSize: number } {
  const rawPage = queryString(req, 'page');
  const rawPageSize = queryString(req, 'pageSize');
  const page = rawPage === undefined ? 1 : Number(rawPage);
  const pageSize = rawPageSize === undefined ? 20 : Number(rawPageSize);
  if (!Number.isInteger(page) || page < 1) {
    throw validationError('page 必须为 ≥1 的整数', { field: 'page', value: rawPage ?? null });
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw validationError('pageSize 必须为 1..100 的整数', { field: 'pageSize', value: rawPageSize ?? null });
  }
  return { page, pageSize };
}

export function paginate<T>(items: readonly T[], page: number, pageSize: number): { items: T[]; page: number; pageSize: number; total: number } {
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page,
    pageSize,
    total: items.length,
  };
}

/** 404 兜底。 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `接口不存在：${req.method} ${req.path}`,
      details: null,
    },
  });
}

/** express.json() 抛出的解析错误（JSON 语法错误 / 体积超限）。 */
interface BodyParserError {
  type: string;
  status?: number;
  message?: string;
}

function bodyParserError(error: unknown): BodyParserError | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const candidate = error as { type?: unknown };
  if (candidate.type === 'entity.parse.failed' || candidate.type === 'entity.too.large') {
    return error as BodyParserError;
  }
  return null;
}

/* eslint-disable @typescript-eslint/no-unused-vars -- Express 错误中间件必须保留 4 个参数 */
export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const parserError = bodyParserError(error);
  if (parserError !== null) {
    res.status(400).json({
      error: {
        code: 'BAD_REQUEST',
        message:
          parserError.type === 'entity.too.large' ? '请求体超过 2MB 限制' : '请求体不是合法 JSON',
        details: null,
      },
    });
    return;
  }
  if (res.headersSent) {
    return;
  }
  if (error instanceof HttpError) {
    res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    });
    return;
  }
  if (error instanceof ZodError) {
    res.status(422).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: '请求参数校验失败',
        details: issueDetails(error),
      },
    });
    return;
  }
  if (error instanceof DataLoadError) {
    // 数据缺失属于部署/环境问题：返回 500 但不暴露堆栈。
    res.status(500).json({
      error: {
        code: 'INTERNAL',
        message: '原始数据集不可用，请确认 data/ 已生成并重启服务。',
        details: null,
      },
    });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error('[qcc-api] 未处理异常:', message);
  res.status(500).json({
    error: {
      code: 'INTERNAL',
      message: '服务内部错误',
      details: null,
    },
  });
}
