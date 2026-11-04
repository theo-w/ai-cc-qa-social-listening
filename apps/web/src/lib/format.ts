/**
 * 展示格式化工具：时间统一按东八区渲染，数字统一 tabular-nums 由 CSS 保证。
 * 约定：比率一律以 0–1 小数传入（与 openapi 一致），展示时乘 100。
 */
import type { Range } from '../types';

const TZ = 'Asia/Shanghai';

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

interface DateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function toParts(input: string | number | Date): DateParts | null {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  const values: Record<string, string> = {};
  for (const part of dateTimeFormatter.formatToParts(date)) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }
  const year = Number(values.year ?? '');
  const month = Number(values.month ?? '');
  const day = Number(values.day ?? '');
  const hour = Number(values.hour ?? '');
  const minute = Number(values.minute ?? '');
  if ([year, month, day, hour, minute].some((n) => !Number.isFinite(n))) return null;
  return { year, month, day, hour, minute };
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** 无效或空值统一用长破折号，避免出现 Invalid Date。 */
export const EMPTY = '—';

/** MM-DD HH:mm */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const parts = toParts(iso);
  if (!parts) return EMPTY;
  return `${pad2(parts.month)}-${pad2(parts.day)} ${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

/** YYYY-MM-DD */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const parts = toParts(iso);
  if (!parts) return EMPTY;
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

/** MM-DD */
export function formatMonthDay(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const parts = toParts(iso);
  if (!parts) return EMPTY;
  return `${pad2(parts.month)}-${pad2(parts.day)}`;
}

/** YYYY-MM-DD HH:mm（完整时间，用于 title 悬浮提示） */
export function formatFullDateTime(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const parts = toParts(iso);
  if (!parts) return EMPTY;
  return `${formatDate(iso)} ${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

/** 会话内相对秒数 → 时钟 HH:mm */
export function formatClockAt(startedAt: string, atSec: number): string {
  const base = new Date(startedAt).getTime();
  if (Number.isNaN(base)) return EMPTY;
  const parts = toParts(base + Math.max(0, atSec) * 1000);
  if (!parts) return EMPTY;
  return `${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

/** 时长（秒）→「32 分钟」「1 小时 12 分」；小于是 60 秒时显示秒。 */
export function formatDurationSec(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return EMPTY;
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} 秒`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分`;
}

/** 分钟数（可为小数）→ 中文时长；用于 KPI / SLA 类指标。 */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return EMPTY;
  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded} 分钟`;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分`;
}

/** 毫秒 → 评测耗时展示（如 1234ms / 12.3s）。 */
export function formatMilliseconds(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return EMPTY;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** 0–1 比率 → 百分比字符串（保留 digits 位小数）。 */
export function formatRatio(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY;
  return `${(value * 100).toFixed(digits)}%`;
}

/** 数字 → 千分位；digits 控制小数位。 */
export function formatNumber(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY;
  return value.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** 质检评分（0–100 整数）。 */
export function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY;
  return String(Math.round(value));
}

/** 带方向的指标值：+2.0% / -1 分钟。 */
export function formatSigned(value: number, unit: 'percent' | 'min' | 'count' | 'score' | 'sec' | 'ms'): string {
  if (!Number.isFinite(value)) return EMPTY;
  const sign = value > 0 ? '+' : value < 0 ? '-' : '±';
  const abs = Math.abs(value);
  if (unit === 'percent') return `${sign}${(abs * 100).toFixed(1)}%`;
  if (unit === 'min') return `${sign}${Math.round(abs)} 分钟`;
  if (unit === 'sec') return `${sign}${Math.round(abs)} 秒`;
  if (unit === 'ms') return `${sign}${Math.round(abs)}ms`;
  return `${sign}${formatNumber(abs, 0)}`;
}

/** 单条消息间隔：203s 形式（与 006 的「间隔 203s」一致）。 */
export function formatGap(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return EMPTY;
  return `${Math.round(seconds)}s`;
}

/** 剩余/超期时间文案：{ overdue, text }。now 使用服务端对齐后的演示时间。 */
export function formatSla(dueIso: string | null | undefined, nowMs: number): { overdue: boolean; text: string } | null {
  if (!dueIso) return null;
  const due = new Date(dueIso).getTime();
  if (Number.isNaN(due)) return null;
  const diffMs = due - nowMs;
  const overdue = diffMs < 0;
  const minutes = Math.abs(diffMs) / 60000;
  const prefix = overdue ? '超期' : '剩余';
  if (minutes < 1) return { overdue, text: `${prefix}不足 1 分钟` };
  return { overdue, text: `${prefix}${formatMinutes(minutes)}` };
}

export function isOverdue(dueIso: string | null | undefined, nowMs: number): boolean {
  if (!dueIso) return false;
  const due = new Date(dueIso).getTime();
  if (Number.isNaN(due)) return false;
  return due < nowMs;
}

/** 文本截断（按字符数，含省略号）。 */
export function truncate(text: string, max: number): string {
  if (!text) return EMPTY;
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

/** 预警窗口：`10-30`。 */
export function formatWindow(startIso: string, endIso: string): string {
  return `${formatMonthDay(startIso)} – ${formatMonthDay(endIso)}`;
}

export function formatRangeLabel(range: Range): string {
  if (range === '14d') return '近 14 天';
  if (range === '30d') return '近 30 天';
  return '近 7 天';
}

/** 置信度：0.83 → 83%。 */
export function formatConfidence(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY;
  return `${Math.round(value * 100)}%`;
}

/** 情感强度：0.62 → +0.62 / -0.62。 */
export function formatSentimentScore(score: number | null | undefined): string {
  if (score === null || score === undefined || !Number.isFinite(score)) return EMPTY;
  const sign = score > 0 ? '+' : '';
  return `${sign}${score.toFixed(2)}`;
}
