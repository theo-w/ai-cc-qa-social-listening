/**
 * 时间工具：统一使用 ISO 8601 + 东八区偏移、无毫秒（如 2026-11-03T10:12:00+08:00）。
 *
 * 所有"演示当前时间"由 config.DEMO_NOW_ISO 提供；交互写操作的事件时间使用真实时钟，
 * 但真实时钟不参与任何规则判定（保证 reset 后运行态数据完全可复现）。
 */
import { DEMO_NOW_ISO } from '../config.js';

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 将时间格式化为东八区 ISO 字符串（不含毫秒）。 */
export function toShanghaiIso(input: Date | string | number): string {
  const date = input instanceof Date ? input : new Date(input);
  const shifted = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
  return `${shifted.toISOString().slice(0, 19)}+08:00`;
}

/** 解析 ISO 字符串为 Date。 */
export function parseIso(iso: string): Date {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`非法时间格式：${iso}`);
  }
  return date;
}

/** 东八区日期键（YYYY-MM-DD）。 */
export function dateKey(iso: string): string {
  return toShanghaiIso(iso).slice(0, 10);
}

/** 在给定 ISO 时间上增加毫秒。 */
export function addMs(iso: string, ms: number): string {
  return toShanghaiIso(parseIso(iso).getTime() + ms);
}

/** 在给定 ISO 时间上增加分钟。 */
export function addMinutes(iso: string, minutes: number): string {
  return addMs(iso, minutes * 60 * 1000);
}

/** 在给定 ISO 时间上增加小时。 */
export function addHours(iso: string, hours: number): string {
  return addMs(iso, hours * 60 * 60 * 1000);
}

/** 在给定 ISO 时间上增加天数。 */
export function addDays(iso: string, days: number): string {
  return addMs(iso, days * 24 * 60 * 60 * 1000);
}

/** 东八区某日 00:00:00。 */
export function startOfDay(date: string): string {
  return `${date.slice(0, 10)}T00:00:00+08:00`;
}

/** 东八区某日 23:59:59。 */
export function endOfDay(date: string): string {
  return `${date.slice(0, 10)}T23:59:59+08:00`;
}

/** 两个 ISO 时间相差的分钟数（to - from，四舍五入到 1 位小数）。 */
export function diffMinutes(fromIso: string, toIso: string): number {
  return round((parseIso(toIso).getTime() - parseIso(fromIso).getTime()) / 60000, 1);
}

/** 演示当前时间（固定基线，用于判定与展示）。 */
export function demoNow(): string {
  return toShanghaiIso(DEMO_NOW_ISO);
}

/** 真实当前时间（仅用于交互写操作的事件时间戳）。 */
export function realNow(): string {
  return toShanghaiIso(new Date());
}

/** 保留指定小数位（避免浮点尾巴）。 */
export function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** 平均值；无样本返回 null（统计口径：响应时长无样本 → null）。 */
export function averageOrNull(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return round(values.reduce((sum, value) => sum + value, 0) / values.length, 1);
}

/** 比率：分母为 0 → 0（BR-10），保留 3 位小数。 */
export function ratio(numerator: number, denominator: number, digits = 3): number {
  if (denominator === 0) {
    return 0;
  }
  return round(numerator / denominator, digits);
}

/** 按天生成从 startDateKey 到 endDateKey（含）的日期键数组。 */
export function dateRangeKeys(startDateKey: string, endDateKey: string): string[] {
  const keys: string[] = [];
  let cursor = startOfDay(startDateKey);
  const end = startOfDay(endDateKey);
  while (parseIso(cursor).getTime() <= parseIso(end).getTime()) {
    keys.push(dateKey(cursor));
    cursor = addDays(cursor, 1);
  }
  return keys;
}
