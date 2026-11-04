/**
 * 运行态存储：单文件 JSON（apps/api/.data/store.json），tmp + rename 原子落盘。
 *
 * - ensureStore：启动/重置时调用；datasetStamp 与 schemaVersion 一致则复用文件，否则全量重建种子。
 * - getStore：同步读取内存态（读接口零 IO）。
 * - mutateStore：串行写队列，所有写操作在内存修改后整体原子落盘，成功后才返回（FR-SYS-006）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { STORE_PATH, STORE_SCHEMA_VERSION } from './config.js';
import { loadDatasets } from './data.js';
import { buildSeed, type SeedCounts } from './seed.js';
import type { StoreData } from './types.js';
import { realNow } from './util/time.js';

export interface StoreBuildResult {
  store: StoreData;
  counts: SeedCounts;
  rebuilt: boolean;
}

export interface ResetSummary {
  resetAt: string;
  counts: SeedCounts;
}

let state: StoreData | null = null;
let writeQueue: Promise<unknown> = Promise.resolve();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const ARRAY_FIELDS = [
  'conversations',
  'qcResults',
  'reviewTasks',
  'badcases',
  'knowledgeEntries',
  'comments',
  'alerts',
  'clues',
  'evalRuns',
  'metricSnapshots',
] as const;

function isStoreData(value: unknown): value is StoreData {
  if (!isRecord(value)) {
    return false;
  }
  if (typeof value.schemaVersion !== 'number' || typeof value.datasetVersion !== 'string') {
    return false;
  }
  return ARRAY_FIELDS.every((field) => Array.isArray(value[field]));
}

function readStoreFile(): StoreData | null {
  if (!fs.existsSync(STORE_PATH)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return isStoreData(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeStoreFile(store: StoreData): Promise<void> {
  const directory = path.dirname(STORE_PATH);
  await fs.promises.mkdir(directory, { recursive: true });
  const tempFile = `${STORE_PATH}.${process.pid}.tmp`;
  const payload = `${JSON.stringify(store)}\n`;
  await fs.promises.writeFile(tempFile, payload, 'utf8');
  try {
    await fs.promises.rename(tempFile, STORE_PATH);
  } catch (error) {
    await fs.promises.rm(tempFile, { force: true });
    throw error;
  }
}

/** 统计各集合数量（reset/meta/报告复用）。 */
export function countStore(store: StoreData): SeedCounts {
  return {
    conversations: store.conversations.length,
    qcResults: store.qcResults.length,
    comments: store.comments.length,
    badcases: store.badcases.length,
    knowledgeEntries: store.knowledgeEntries.length,
    alerts: store.alerts.length,
    clues: store.clues.length,
    metricSnapshots: store.metricSnapshots.length,
    reviewTasks: store.reviewTasks.length,
    evalRuns: store.evalRuns.length,
  };
}

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(task, task);
  writeQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/** 启动时确保运行态可用：版本一致复用，否则按 data/ 全量重建并落盘。 */
export async function ensureStore(): Promise<StoreBuildResult> {
  return serialize(async () => {
    const datasets = loadDatasets();
    const existing = readStoreFile();
    if (
      existing !== null &&
      existing.schemaVersion === STORE_SCHEMA_VERSION &&
      existing.datasetVersion === datasets.datasetStamp
    ) {
      state = existing;
      return { store: existing, counts: countStore(existing), rebuilt: false };
    }
    const { store, counts } = buildSeed(datasets);
    await writeStoreFile(store);
    state = store;
    return { store, counts, rebuilt: true };
  });
}

/** 清空运行态并按同一逻辑重建（确定性可复现）。 */
export async function resetStore(): Promise<ResetSummary> {
  return serialize(async () => {
    const datasets = loadDatasets();
    const { store, counts } = buildSeed(datasets);
    await writeStoreFile(store);
    state = store;
    return { resetAt: realNow(), counts };
  });
}

/** 读取内存运行态（必须在 ensureStore 成功后调用）。 */
export function getStore(): StoreData {
  if (state === null) {
    throw new Error('运行态尚未初始化：请先调用 ensureStore()。');
  }
  return state;
}

/** 串行写：mutator 修改内存态 → 整体原子落盘 → 返回 mutator 结果。 */
export async function mutateStore<T>(mutator: (store: StoreData) => T): Promise<T> {
  return serialize(async () => {
    const store = getStore();
    const result = mutator(store);
    await writeStoreFile(store);
    return result;
  });
}

/** 仅用于测试/报告：存储文件路径。 */
export function storeFilePath(): string {
  return STORE_PATH;
}
