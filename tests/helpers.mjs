/**
 * QCC Workbench · 测试公共库
 * =============================================================================
 * 仅依赖 Node 24 内置模块与全局 fetch，零第三方依赖。
 *
 * 覆盖能力：
 *  - API 连通性探测（ensureApi）：未启动时输出明确中文提示并 exit 1，绝不静默跳过；
 *  - 请求封装（request/get/post）：断言状态码、JSON 可解析、错误体结构，失败时
 *    统一输出「请求方法/URL/请求体/响应状态/响应体」，便于定位；
 *  - 契约断言工具（assertShape）：声明式校验字段存在性与类型/枚举/可空；
 *  - 数据与计数断言工具：分页列表、ISO 时间、数值区间、字典项等；
 *  - 演示态重置（resetDemoData）与全量列表拉取（listAll）。
 *
 * 环境变量：
 *  - QCC_BASE_URL / BASE_URL：API 根地址，默认 http://127.0.0.1:8787；
 *  - QCC_DATA_DIR：数据集目录，默认 <repo>/data。
 * =============================================================================
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(TESTS_DIR, '..');
export const DATA_DIR = path.resolve(process.env.QCC_DATA_DIR ?? path.join(REPO_ROOT, 'data'));
export const BASE_URL = (process.env.QCC_BASE_URL ?? process.env.BASE_URL ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_BODY_CHARS = 4_000;

/** 契约冻结的 HTTP 状态码 → 错误 code 映射（specs/005-api-contract.md §1.2）。 */
export const ERROR_CODE_BY_STATUS = {
  400: 'BAD_REQUEST',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'VALIDATION_ERROR',
  500: 'INTERNAL',
};

/** 质检标签字典（specs/004-data-model.md §4.1，权重为扣分，见 FR-QC-004/BR-01）。 */
export const QC_TAG_WEIGHTS = {
  attitude: -25,
  forbidden: -30,
  off_topic: -15,
  wrong_knowledge: -25,
  timeout: -10,
  escalation: -20,
};
export const QC_TAG_CODES = Object.keys(QC_TAG_WEIGHTS);

/** 标签严重度排序权重（FR-QC-004：severity 降序，再 confidence 降序）。 */
export const SEVERITY_RANK = { high: 3, medium: 2, low: 1 };

/** 舆情主题字典（specs/004-data-model.md §4.3）。 */
export const TOPIC_DICT = ['版本', '充值', '外挂', '客服', '活动', 'Bug', '其他'];
/** 角色字典（specs/004-data-model.md §4.4）。 */
export const ROLE_DICT = ['qc', 'lead', 'agent', 'brand', 'product', 'algo'];
/** 舆情来源字典。 */
export const SENTIMENT_SOURCES = ['steam', 'taptap', 'googleplay', 'community', 'ticket'];
/** 线索目标字典。 */
export const CLUE_TARGETS = ['product', 'brand', 'market', 'cs'];
/** 责任人路由（specs/004-data-model.md §4.5）。 */
export const OWNER_ROUTING = {
  review: '沈言',
  badcase: { knowledge: '顾清', script: '唐沐', process: '陆川', system: '周野' },
  sentiment: { 外挂: '江岚', 充值: '江岚', 版本: '周野', Bug: '周野', 客服: '陆川', 活动: '陆川', 其他: '陆川' },
  clue: { product: '周野', brand: '江岚', market: '程雨', cs: '陆川' },
};
/** badcase 分类 → 默认 SLA 小时（FR-BC-002 / BR-08）。 */
export const BADCASE_SLA_BY_CATEGORY = { knowledge: 48, script: 48, process: 24, system: 72 };
/** 舆情 SLA 分钟（FR-SEN-003 / BR-08）。 */
export const ALERT_SLA_MINUTES = { P0: 30, P1: 120, P2: 1440 };

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncate(text, max = MAX_BODY_CHARS) {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, max)}…（共 ${value.length} 字符，已截断）` : value;
}

export function formatJson(value) {
  if (value === undefined) return 'undefined';
  try {
    return truncate(JSON.stringify(value, null, 2));
  } catch {
    return truncate(String(value));
  }
}

function describeResponse(res) {
  return [
    `请求：${res.method} ${res.url}`,
    `请求体：${formatJson(res.requestBody)}`,
    `响应状态：HTTP ${res.status}`,
    `响应体：${formatJson(res.body ?? res.raw)}`,
  ].join('\n  ');
}

/**
 * 发起 HTTP 请求。不自动断言状态码（由调用方按契约断言），但解析 JSON 与超时失败
 * 会直接给出带上下文的断言错误。
 * @returns {Promise<{method:string,path:string,url:string,status:number,body:any,raw:string,
 *   parseError:Error|null,headers:Headers,requestBody:any}>}
 */
export async function request(method, apiPath, { query, body } = {}) {
  const url = new URL(apiPath, BASE_URL);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }
  const init = {
    method,
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    assert.fail(
      `请求失败：${method} ${url}\n  原因：${error.message}\n` +
        `  提示：API 应已启动并监听 ${BASE_URL}（由 Lead 启动，测试不自行拉起服务）。`,
    );
  }

  const raw = await response.text();
  let parsed = null;
  let parseError = null;
  if (raw.trim() !== '') {
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      parseError = error;
    }
  }
  return {
    method,
    path: apiPath,
    url: url.toString(),
    status: response.status,
    ok: response.ok,
    headers: response.headers,
    body: parsed,
    raw,
    parseError,
    requestBody: body,
  };
}

export const get = (apiPath, query) => request('GET', apiPath, { query });
export const post = (apiPath, body) => request('POST', apiPath, { body });
export const del = (apiPath) => request('DELETE', apiPath);

/** 断言 HTTP 状态码，失败消息包含完整请求/响应上下文。 */
export function assertHttpStatus(res, expectedStatus, context) {
  const prefix = context ? `${context}：` : '';
  if (res.status !== expectedStatus) {
    assert.fail(`${prefix}期望 HTTP ${expectedStatus}，实际 HTTP ${res.status}\n  ${describeResponse(res)}`);
  }
  if (res.parseError) {
    assert.fail(`${prefix}响应不是合法 JSON：${res.parseError.message}\n  ${describeResponse(res)}`);
  }
}

/**
 * 断言 200 + JSON 对象响应，返回响应体。
 * @returns {Record<string, any>}
 */
export function assertOk(res, context) {
  assertHttpStatus(res, 200, context);
  assert.ok(
    res.body !== null && typeof res.body === 'object' && !Array.isArray(res.body),
    `${context ? `${context}：` : ''}期望 JSON 对象响应\n  ${describeResponse(res)}`,
  );
  return res.body;
}

/** 断言 200 + JSON 数组响应，返回数组。 */
export function assertOkArray(res, context) {
  assertHttpStatus(res, 200, context);
  assert.ok(Array.isArray(res.body), `${context ? `${context}：` : ''}期望 JSON 数组响应\n  ${describeResponse(res)}`);
  return res.body;
}

/**
 * 断言错误响应：状态码、error.code、error.message，422 时校验 details.field。
 * @param {object} res 请求结果
 * @param {{status:number, code?:string, field?:string, context?:string}} expected
 */
export function assertErrorResponse(res, { status, code, field, context }) {
  const label = context ? `${context}：` : '';
  assertHttpStatus(res, status, context);
  const expectedCode = code ?? ERROR_CODE_BY_STATUS[status];
  if (!expectedCode) {
    assert.fail(`${label}未为 HTTP ${status} 定义期望错误 code（测试自身配置错误）`);
  }
  assert.ok(res.body && typeof res.body === 'object', `${label}错误响应应为 JSON 对象\n  ${describeResponse(res)}`);
  assert.ok(
    res.body.error && typeof res.body.error === 'object' && !Array.isArray(res.body.error),
    `${label}错误响应缺少 error 对象\n  ${describeResponse(res)}`,
  );
  const { error } = res.body;
  assert.equal(
    error.code,
    expectedCode,
    `${label}error.code 应为 ${expectedCode}，实际 ${JSON.stringify(error.code)}\n  ${describeResponse(res)}`,
  );
  assert.ok(
    typeof error.message === 'string' && error.message.trim() !== '',
    `${label}error.message 应为非空字符串\n  ${describeResponse(res)}`,
  );
  if (field !== undefined) {
    assert.ok(
      error.details && typeof error.details === 'object',
      `${label}422 响应 error.details 应为对象且包含 field\n  ${describeResponse(res)}`,
    );
    // 支持两种格式：details.issues[].path（多字段时优先精确匹配）或 details.field（首个错误）。
    const actualField =
      (error.details.issues && Array.isArray(error.details.issues)
        ? error.details.issues.find((i) => i.path === field)?.path
        : undefined) ?? error.details.field;
    assert.equal(
      actualField,
      field,
      `${label}error.details.field 应为 ${JSON.stringify(field)}，实际 ${JSON.stringify(actualField)}\n  ${describeResponse(res)}`,
    );
  }
  return error;
}

/** 断言两个值深度相等，失败消息输出实际与期望 JSON。 */
export function assertDeepEqual(actual, expected, context) {
  try {
    assert.deepEqual(actual, expected);
  } catch {
    assert.fail(
      `${context ?? '深度比较'}：\n  期望：${formatJson(expected)}\n  实际：${formatJson(actual)}`,
    );
  }
}

/** 断言数值近似（用于浮点统计）。 */
export function assertApprox(actual, expected, tolerance, context) {
  assert.equal(typeof actual, 'number', `${context}：应为数字，实际 ${formatJson(actual)}`);
  assert.ok(
    Number.isFinite(actual),
    `${context}：应为有限数字，实际 ${formatJson(actual)}`,
  );
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${context}：期望 ${expected}（容差 ±${tolerance}），实际 ${actual}`,
  );
}

// ---------------------------------------------------------------------------
// 声明式结构断言
// ---------------------------------------------------------------------------

/**
 * 形状描述符：
 *  - 'string' | 'nonEmptyString' | 'number' | 'integer' | 'boolean' | 'dateTime' | 'object'
 *  - 'string|null' 等可空写法：{ nullable: spec }
 *  - { enum: [...] } / { array: spec, minItems?, maxItems? } / { object: shape }
 *  - { numberRange: { min?, max? } } / { integerRange: { min?, max? } }
 */
export const S = {
  string: 'string',
  nonEmptyString: 'nonEmptyString',
  number: 'number',
  integer: 'integer',
  boolean: 'boolean',
  dateTime: 'dateTime',
  object: 'object',
  enum: (...values) => ({ enum: values }),
  array: (items, options = {}) => ({ array: items, ...options }),
  objectOf: (shape) => ({ object: shape }),
  nullable: (inner) => ({ nullable: inner }),
  numberRange: (min, max) => ({ numberRange: { min, max } }),
  integerRange: (min, max) => ({ integerRange: { min, max } }),
};

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

/** 断言值可被 Date.parse 解析且为 ISO 8601 字符串（带时区）。 */
export function assertIsoDate(value, label) {
  assert.equal(typeof value, 'string', `${label}：应为 ISO 8601 字符串，实际 ${formatJson(value)}`);
  assert.ok(
    ISO_PATTERN.test(value),
    `${label}：应为形如 2026-11-03T10:00:00+08:00 的 ISO 8601 时间，实际 ${JSON.stringify(value)}`,
  );
  assert.ok(Number.isFinite(Date.parse(value)), `${label}：时间无法解析，实际 ${JSON.stringify(value)}`);
}

function describeShapeSpec(spec) {
  if (typeof spec === 'string') return spec;
  return JSON.stringify(spec);
}

/**
 * 按形状描述符递归断言对象结构。只校验描述中列出的字段，不禁止额外字段。
 * @param {any} value
 * @param {any} spec
 * @param {string} label 形如 body.review 的路径
 */
export function assertShape(value, spec, label) {
  if (typeof spec === 'string') {
    switch (spec) {
      case 'string':
        assert.equal(typeof value, 'string', `${label}：应为 string，实际 ${formatJson(value)}`);
        return;
      case 'nonEmptyString':
        assert.equal(typeof value, 'string', `${label}：应为非空 string，实际 ${formatJson(value)}`);
        assert.notEqual(value.trim(), '', `${label}：字符串不应为空`);
        return;
      case 'number':
        assert.equal(typeof value, 'number', `${label}：应为 number，实际 ${formatJson(value)}`);
        assert.ok(Number.isFinite(value), `${label}：应为有限数字，实际 ${formatJson(value)}`);
        return;
      case 'integer':
        assert.ok(Number.isInteger(value), `${label}：应为 integer，实际 ${formatJson(value)}`);
        return;
      case 'boolean':
        assert.equal(typeof value, 'boolean', `${label}：应为 boolean，实际 ${formatJson(value)}`);
        return;
      case 'dateTime':
        assertIsoDate(value, label);
        return;
      case 'object':
        assert.ok(
          value !== null && typeof value === 'object' && !Array.isArray(value),
          `${label}：应为 object，实际 ${formatJson(value)}`,
        );
        return;
      default:
        assert.fail(`${label}：未知形状描述符 ${spec}`);
    }
  }

  if (spec.nullable) {
    if (value === null || value === undefined) return;
    assertShape(value, spec.nullable, label);
    return;
  }
  if (spec.enum) {
    assert.ok(
      spec.enum.includes(value),
      `${label}：应为枚举 ${JSON.stringify(spec.enum)} 之一，实际 ${formatJson(value)}`,
    );
    return;
  }
  if (spec.array) {
    assert.ok(Array.isArray(value), `${label}：应为数组，实际 ${formatJson(value)}`);
    if (spec.minItems !== undefined) {
      assert.ok(value.length >= spec.minItems, `${label}：数组长度应 ≥ ${spec.minItems}，实际 ${value.length}`);
    }
    if (spec.maxItems !== undefined) {
      assert.ok(value.length <= spec.maxItems, `${label}：数组长度应 ≤ ${spec.maxItems}，实际 ${value.length}`);
    }
    value.forEach((item, index) => assertShape(item, spec.array, `${label}[${index}]`));
    return;
  }
  if (spec.object !== undefined) {
    assert.ok(
      value !== null && typeof value === 'object' && !Array.isArray(value),
      `${label}：应为 object，实际 ${formatJson(value)}`,
    );
    for (const [key, childSpec] of Object.entries(spec.object)) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(value, key),
        `${label}：缺少必填字段 ${key}（实际字段：${Object.keys(value).join(', ') || '无'}）`,
      );
      assertShape(value[key], childSpec, `${label}.${key}`);
    }
    return;
  }
  // 扁平对象 spec：每个 key 对应一个子断言（如 {ok: S.boolean, seeded: S.objectOf({...})}）
  // 仅在 spec 不含已知类型键时才当作扁平对象处理
  if (typeof spec === 'object' && spec !== null && !spec.nullable && !spec.enum && !spec.array && spec.object === undefined && !spec.numberRange && !spec.integerRange) {
    assert.ok(
      value !== null && typeof value === 'object' && !Array.isArray(value),
      `${label}：应为 object，实际 ${formatJson(value)}`,
    );
    for (const [key, childSpec] of Object.entries(spec)) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(value, key),
        `${label}：缺少必填字段 ${key}（实际字段：${Object.keys(value).join(', ') || '无'}）`,
      );
      assertShape(value[key], childSpec, `${label}.${key}`);
    }
    return;
  }
  if (spec.numberRange) {
    assert.equal(typeof value, 'number', `${label}：应为 number，实际 ${formatJson(value)}`);
    const { min, max } = spec.numberRange;
    if (min !== undefined) assert.ok(value >= min, `${label}：应 ≥ ${min}，实际 ${value}`);
    if (max !== undefined) assert.ok(value <= max, `${label}：应 ≤ ${max}，实际 ${value}`);
    return;
  }
  if (spec.integerRange) {
    assert.ok(Number.isInteger(value), `${label}：应为 integer，实际 ${formatJson(value)}`);
    const { min, max } = spec.integerRange;
    if (min !== undefined) assert.ok(value >= min, `${label}：应 ≥ ${min}，实际 ${value}`);
    if (max !== undefined) assert.ok(value <= max, `${label}：应 ≤ ${max}，实际 ${value}`);
    return;
  }
  assert.fail(`${label}：未知形状描述 ${describeShapeSpec(spec)}`);
}

// ---------------------------------------------------------------------------
// 分页与列表
// ---------------------------------------------------------------------------

/**
 * 断言分页列表信封 { items, page, pageSize, total } 并校验分页参数回显。
 * @param {any} body
 * @param {{label:string, page?:number, pageSize?:number}} options
 */
export function assertPaginated(body, { label, page, pageSize }) {
  assertShape(
    body,
    {
      items: S.array(undefined ?? 'object'),
      page: S.integerRange(1, undefined),
      pageSize: S.integerRange(1, 100),
      total: S.integerRange(0, undefined),
    },
    label,
  );
  assert.ok(Array.isArray(body.items), `${label}.items 应为数组`);
  if (page !== undefined) assert.equal(body.page, page, `${label}.page 应回显 ${page}，实际 ${body.page}`);
  if (pageSize !== undefined) assert.equal(body.pageSize, pageSize, `${label}.pageSize 应回显 ${pageSize}，实际 ${body.pageSize}`);
  assert.ok(
    body.items.length <= body.pageSize,
    `${label}：单页条数 ${body.items.length} 不应超过 pageSize ${body.pageSize}`,
  );
  assert.ok(
    body.items.length <= body.total,
    `${label}：单页条数 ${body.items.length} 不应超过 total ${body.total}`,
  );
  return body;
}

/**
 * 按 pageSize=100 翻页拉全量列表（数据规模 ≤ 120，页数有限）。
 * @returns {Promise<Array<any>>}
 */
export async function listAll(apiPath, query = {}, label = apiPath) {
  const collected = [];
  let total = null;
  for (let page = 1; page <= 20; page += 1) {
    const body = assertOk(await get(apiPath, { ...query, page, pageSize: 100 }), `${label} page=${page}`);
    assertPaginated(body, { label: `${label} page=${page}`, page, pageSize: 100 });
    if (total === null) total = body.total;
    else assert.equal(body.total, total, `${label}：翻页过程中 total 应保持稳定`);
    collected.push(...body.items);
    if (collected.length >= total) break;
    if (body.items.length === 0) assert.fail(`${label}：翻页提前为空，已收集 ${collected.length}/${total}`);
  }
  assert.equal(collected.length, total, `${label}：全量条数应为 ${total}，实际收集 ${collected.length}`);
  return collected;
}

// ---------------------------------------------------------------------------
// 数据集与演示态
// ---------------------------------------------------------------------------

/** 读取仓库内 JSON 文件；文件缺失时给出明确提示（data/ 尚未交付 / 路径错误）。 */
export function readJsonFile(relativePath) {
  const absolutePath = path.resolve(REPO_ROOT, relativePath);
  if (!fs.existsSync(absolutePath)) {
    assert.fail(`文件不存在：${absolutePath}（data/ 是否已由 data-lab 交付？）`);
  }
  const raw = fs.readFileSync(absolutePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    assert.fail(`文件不是合法 JSON：${absolutePath}\n  原因：${error.message}`);
  }
}

/** 判断仓库内相对文件是否存在。 */
export function repoFileExists(relativePath) {
  return fs.existsSync(path.resolve(REPO_ROOT, relativePath));
}

/**
 * 探测 API 是否就绪（GET /api/health，默认最多等待 20s）。
 * 未就绪时打印明确提示并 exit 1，避免测试「静默跳过」。
 */
export async function ensureApi({ timeoutMs = 20_000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(3_000) });
      if (res.status === 200) {
        const body = await res.json();
        if (body && body.status === 'ok') return body;
        lastError = new Error(`/api/health 返回 status=${JSON.stringify(body?.status)}`);
      } else {
        lastError = new Error(`/api/health 返回 HTTP ${res.status}`);
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  process.stderr.write(
    `\n[QCC 测试] API 未就绪：无法访问 ${BASE_URL}/api/health（${lastError?.message ?? '未知原因'}）。\n` +
      `  请先启动 apps/api（监听 ${BASE_URL}）后重新运行：cd tests && npm test\n` +
      `  提示：测试不负责启动服务；如需临时指定地址，设置 QCC_BASE_URL。\n\n`,
  );
  process.exit(1);
}

/**
 * 重置演示态并校验响应契约，返回响应体。
 * （specs/005-api-contract.md §3.12 ResetResult；FR-SYS-006）
 */
export async function resetDemoData(context = 'POST /api/admin/reset') {
  const body = assertOk(await post('/api/admin/reset'), context);
  assertShape(
    body,
    {
      ok: S.boolean,
      resetAt: S.dateTime,
      seeded: S.objectOf({
        conversations: S.integerRange(0, undefined),
        qcResults: S.integerRange(0, undefined),
        comments: S.integerRange(0, undefined),
        badcases: S.integerRange(0, undefined),
        alerts: S.integerRange(0, undefined),
        clues: S.integerRange(0, undefined),
        metricSnapshots: S.integerRange(0, undefined),
      }),
    },
    context,
  );
  assert.equal(body.ok, true, `${context}：ok 应为 true`);
  return body;
}
