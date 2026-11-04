/**
 * 轻量数据请求 hook：loading / error / data / refresh，自带竞态保护与重置后自动刷新。
 * 不引入额外数据请求库，保持依赖面最小。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DependencyList } from 'react';
import { errorMessage } from '../api/client';
import { useAppData } from './useAppData';

export interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useApi<T>(loader: () => Promise<T>, deps: DependencyList = []): ApiState<T> {
  const { dataVersion } = useAppData();
  const loaderRef = useRef(loader);
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({
    data: null,
    loading: true,
    error: null,
  });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    loaderRef.current = loader;
  });

  useEffect(() => {
    let cancelled = false;
    setState((previous) => ({ data: previous.data, loading: true, error: null }));
    loaderRef
      .current()
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState((previous) => ({ data: previous.data, loading: false, error: errorMessage(error) }));
        }
      });
    return () => {
      cancelled = true;
    };
    // deps 由调用方显式声明；dataVersion 用于重置演示数据后统一刷新。
  }, [...deps, tick, dataVersion]);

  const refresh = useCallback(() => setTick((value) => value + 1), []);

  return { ...state, refresh };
}
