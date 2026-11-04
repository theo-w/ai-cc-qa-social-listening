/**
 * 进程内数据集缓存：启动后首次访问读取 data/，reset 时失效以读取最新文件。
 */
import { loadDatasets, type LoadedDatasets } from './data.js';

let cache: LoadedDatasets | null = null;

export function getDatasets(): LoadedDatasets {
  if (cache === null) {
    cache = loadDatasets();
  }
  return cache;
}

export function invalidateDatasets(): void {
  cache = null;
}
