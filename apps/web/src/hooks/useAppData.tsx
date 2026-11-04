/**
 * 全局运行数据：Meta（枚举/责任人/标签字典）、服务端对齐的演示时间、数据版本号。
 * 数据版本号变化时（重置演示数据），所有 useApi 调用会自动重新拉取。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { errorMessage, fetchMeta, resetDemoData } from '../api/client';
import type { Meta, ResetResult } from '../types';

interface AppDataContextValue {
  meta: Meta | null;
  metaLoading: boolean;
  metaError: string | null;
  refreshMeta: () => void;
  /** 与服务端 generatedAt 对齐的「演示当前时间」毫秒值，每 30s 刷新。 */
  now: number;
  dataVersion: number;
  bumpDataVersion: () => void;
  resetDemo: () => Promise<ResetResult>;
}

const AppDataContext = createContext<AppDataContextValue | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [metaTick, setMetaTick] = useState(0);
  const [dataVersion, setDataVersion] = useState(0);
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    setMetaLoading(true);
    fetchMeta()
      .then((result) => {
        if (cancelled) return;
        setMeta(result);
        setMetaError(null);
        const generatedAt = Date.parse(result.generatedAt);
        if (!Number.isNaN(generatedAt)) setOffset(generatedAt - Date.now());
      })
      .catch((error: unknown) => {
        if (!cancelled) setMetaError(errorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setMetaLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [metaTick]);

  useEffect(() => {
    setNow(Date.now() + offset);
    const timer = window.setInterval(() => setNow(Date.now() + offset), 30000);
    return () => window.clearInterval(timer);
  }, [offset]);

  const refreshMeta = useCallback(() => setMetaTick((tick) => tick + 1), []);
  const bumpDataVersion = useCallback(() => setDataVersion((version) => version + 1), []);
  const resetDemo = useCallback(async () => {
    const result = await resetDemoData();
    setDataVersion((version) => version + 1);
    setMetaTick((tick) => tick + 1);
    return result;
  }, []);

  const value = useMemo<AppDataContextValue>(
    () => ({
      meta,
      metaLoading,
      metaError,
      refreshMeta,
      now,
      dataVersion,
      bumpDataVersion,
      resetDemo,
    }),
    [meta, metaLoading, metaError, refreshMeta, now, dataVersion, bumpDataVersion, resetDemo],
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppDataContextValue {
  const value = useContext(AppDataContext);
  if (!value) throw new Error('useAppData 必须在 AppDataProvider 内使用');
  return value;
}
