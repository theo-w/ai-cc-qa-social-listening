/**
 * 列表筛选与 URL 查询参数双向同步：筛选条件随 URL 保留，可刷新/分享/回退。
 */
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

type ParamValue = string | number | null | undefined;

export interface QueryState {
  get: (key: string) => string;
  getNumber: (key: string, fallback?: number) => number;
  setParams: (patch: Record<string, ParamValue>, options?: { replace?: boolean }) => void;
  reset: () => void;
}

export function useQueryState(): QueryState {
  const [searchParams, setSearchParams] = useSearchParams();

  const get = useCallback((key: string) => searchParams.get(key) ?? '', [searchParams]);

  const getNumber = useCallback(
    (key: string, fallback = 1) => {
      const raw = searchParams.get(key);
      if (!raw) return fallback;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed < 1) return fallback;
      return Math.floor(parsed);
    },
    [searchParams],
  );

  const setParams = useCallback(
    (patch: Record<string, ParamValue>, options?: { replace?: boolean }) => {
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          for (const [key, value] of Object.entries(patch)) {
            if (value === null || value === undefined || value === '') next.delete(key);
            else next.set(key, String(value));
          }
          return next;
        },
        { replace: options?.replace ?? false },
      );
    },
    [setSearchParams],
  );

  const reset = useCallback(() => setSearchParams(new URLSearchParams(), { replace: false }), [setSearchParams]);

  return { get, getNumber, setParams, reset };
}

/**
 * 搜索框与 URL 双向同步：输入时本地即时响应，停止输入 delay 毫秒后写入 URL。
 * 用于列表页搜索，避免每敲一个字符都改地址栏。
 */
export function useSearchParamInput(key: string, delay = 350): [string, (value: string) => void] {
  const { get, setParams } = useQueryState();
  const urlValue = get(key);
  const [value, setValue] = useState(urlValue);

  useEffect(() => {
    setValue(urlValue);
  }, [urlValue]);

  useEffect(() => {
    if (value === urlValue) return;
    const timer = window.setTimeout(() => {
      setParams({ [key]: value }, { replace: true });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [value, urlValue, key, delay, setParams]);

  return [value, setValue];
}
