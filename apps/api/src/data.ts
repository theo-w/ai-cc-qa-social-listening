/**
 * 原始数据集读取（只读输入）：data/manifest.json + data/qc/dataset.json + data/sentiment/dataset.json。
 *
 * 兼容：
 * - manifest.datasets 既支持 004 §7.2 的对象映射，也支持扩展的数组形式；
 * - 数据集路径优先取 manifest 的 file 字段，缺失时回退到约定路径；
 * - 版本判断一律用 manifest.version；datasetVersion 仅用于展示（004 §7.5 v0.1.1 冻结口径）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import type {
  KnowledgeCategory,
  KnowledgeDataset,
  KnowledgeFact,
  KnowledgeFactCompare,
  KnowledgeRevision,
  KnowledgeSeedEntry,
  KnowledgeSource,
  KnowledgeSourceRef,
  KnowledgeStatus,
  Manifest,
  ManifestDatasetEntry,
  QcDataset,
  QcDatasetItem,
  SentimentDataset,
  SentimentDatasetItem,
} from './types.js';

export class DataLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataLoadError';
  }
}

export interface LoadedDatasets {
  manifest: Manifest;
  qc: QcDataset;
  sentiment: SentimentDataset;
  /** 知识库种子（data/knowledge/entries.json）；缺失时为空知识库。 */
  knowledge: KnowledgeDataset;
  /** 数据集版本判断戳（004 §7.5：后端以 manifest.version 判断数据集版本）。 */
  datasetStamp: string;
  /** 数据集展示版本（manifest.datasetVersion ?? version，仅供 meta/UI 展示）。 */
  displayDatasetVersion: string;
}

function readJsonFile(file: string): unknown {
  if (!fs.existsSync(file)) {
    throw new DataLoadError(`缺少原始数据文件：${file}。请先运行 data/scripts/generate.mjs 生成 data/ 数据集。`);
  }
  const raw = fs.readFileSync(file, 'utf8');
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new DataLoadError(`数据文件不是合法 JSON：${file}（${(error as Error).message}）`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeManifestEntry(value: unknown, fallbackFile: string): ManifestDatasetEntry {
  if (!isRecord(value)) {
    return { datasetId: '', version: '', file: fallbackFile, itemCount: 0 };
  }
  return {
    datasetId: typeof value.datasetId === 'string' ? value.datasetId : '',
    version: typeof value.version === 'string' ? value.version : '',
    file: typeof value.file === 'string' && value.file.length > 0 ? value.file : fallbackFile,
    itemCount: typeof value.itemCount === 'number' ? value.itemCount : 0,
    description: typeof value.description === 'string' ? value.description : undefined,
  };
}

function parseManifest(raw: unknown): Manifest {
  if (!isRecord(raw)) {
    throw new DataLoadError('data/manifest.json 结构非法：应为对象。');
  }
  const version = typeof raw.version === 'string' ? raw.version : '';
  if (version.length === 0) {
    throw new DataLoadError('data/manifest.json 缺少 version 字段。');
  }
  const rawDatasets = raw.datasets;
  let qcEntry: ManifestDatasetEntry;
  let sentimentEntry: ManifestDatasetEntry;
  if (Array.isArray(rawDatasets)) {
    const entries = rawDatasets.filter(isRecord);
    const qc = entries.find((entry) => entry.dataset === 'qc' || entry.key === 'qc');
    const sentiment = entries.find((entry) => entry.dataset === 'sentiment' || entry.key === 'sentiment');
    qcEntry = normalizeManifestEntry(qc, 'qc/dataset.json');
    sentimentEntry = normalizeManifestEntry(sentiment, 'sentiment/dataset.json');
  } else if (isRecord(rawDatasets)) {
    qcEntry = normalizeManifestEntry(rawDatasets.qc, 'qc/dataset.json');
    sentimentEntry = normalizeManifestEntry(rawDatasets.sentiment, 'sentiment/dataset.json');
  } else {
    qcEntry = { datasetId: '', version: '', file: 'qc/dataset.json', itemCount: 0 };
    sentimentEntry = { datasetId: '', version: '', file: 'sentiment/dataset.json', itemCount: 0 };
  }

  return {
    version,
    datasetVersion: typeof raw.datasetVersion === 'string' ? raw.datasetVersion : undefined,
    generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : undefined,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    datasets: { qc: qcEntry, sentiment: sentimentEntry },
  };
}

function resolveDatasetPath(relative: string): string {
  if (path.isAbsolute(relative)) {
    return relative;
  }
  const normalized = relative.replace(/^\.\//, '');
  if (normalized.startsWith('data/')) {
    return path.join(DATA_DIR, normalized.slice('data/'.length));
  }
  return path.join(DATA_DIR, normalized);
}

function parseQcDataset(raw: unknown, entry: ManifestDatasetEntry, file: string): QcDataset {
  if (!isRecord(raw) || !Array.isArray(raw.items)) {
    throw new DataLoadError(`质检数据集结构非法（缺少 items 数组）：${file}`);
  }
  const items = raw.items.filter(isRecord).map((item, index) => {
    const id = typeof item.id === 'string' ? item.id : `qc-${String(index + 1).padStart(4, '0')}`;
    const labels = isRecord(item.labels) ? item.labels : {};
    const tags = Array.isArray(labels.tags) ? labels.tags.filter((tag): tag is string => typeof tag === 'string') : [];
    const verdict = labels.verdict === 'violation' ? 'violation' : 'pass';
    const primaryTag = typeof labels.primaryTag === 'string' ? labels.primaryTag : null;
    return {
      id,
      channel:
        item.channel === 'ticket' || item.channel === 'phone' || item.channel === 'online'
          ? item.channel
          : 'online',
      product: typeof item.product === 'string' ? item.product : '星海远征',
      agent: isRecord(item.agent)
        ? {
            id: typeof item.agent.id === 'string' ? item.agent.id : 'A-0000',
            name: typeof item.agent.name === 'string' ? item.agent.name : '未知坐席',
          }
        : { id: 'A-0000', name: '未知坐席' },
      customer: isRecord(item.customer)
        ? {
            id: typeof item.customer.id === 'string' ? item.customer.id : 'C-0000',
            name: typeof item.customer.name === 'string' ? item.customer.name : '用户',
          }
        : { id: 'C-0000', name: '用户' },
      startedAt: typeof item.startedAt === 'string' ? item.startedAt : '2026-10-27T10:00:00+08:00',
      durationSec: typeof item.durationSec === 'number' ? item.durationSec : 0,
      messages: Array.isArray(item.messages)
        ? item.messages.filter(isRecord).map((message, messageIndex) => ({
            seq: typeof message.seq === 'number' ? message.seq : messageIndex + 1,
            role:
              message.role === 'agent' || message.role === 'system' || message.role === 'customer'
                ? message.role
                : 'customer',
            text: typeof message.text === 'string' ? message.text : '',
            atSec: typeof message.atSec === 'number' ? message.atSec : 0,
          }))
        : [],
      labels: {
        verdict,
        tags,
        primaryTag,
        note: typeof labels.note === 'string' ? labels.note : '',
        complexity:
          labels.complexity === 'implicit' || labels.complexity === 'explicit' ? labels.complexity : undefined,
        confidence: typeof labels.confidence === 'number' ? labels.confidence : undefined,
        needsReview: typeof labels.needsReview === 'boolean' ? labels.needsReview : undefined,
        summary: typeof labels.summary === 'string' ? labels.summary : undefined,
        emotion:
          labels.emotion === 'calm' || labels.emotion === 'anxious' || labels.emotion === 'angry'
            ? labels.emotion
            : undefined,
        tagEvidence: Array.isArray(labels.tagEvidence) ? (labels.tagEvidence as QcDatasetItem['labels']['tagEvidence']) : undefined,
      },
    } satisfies QcDatasetItem;
  });

  if (items.length === 0) {
    throw new DataLoadError(`质检数据集为空：${file}`);
  }
  return {
    datasetId: typeof raw.datasetId === 'string' ? raw.datasetId : entry.datasetId,
    version: typeof raw.version === 'string' ? raw.version : entry.version,
    description: typeof raw.description === 'string' ? raw.description : '',
    items,
  };
}

function parseSentimentDataset(raw: unknown, entry: ManifestDatasetEntry, file: string): SentimentDataset {
  if (!isRecord(raw) || !Array.isArray(raw.items)) {
    throw new DataLoadError(`舆情数据集结构非法（缺少 items 数组）：${file}`);
  }
  const items = raw.items.filter(isRecord).map((item, index) => {
    const id = typeof item.id === 'string' ? item.id : `cm-${String(index + 1).padStart(4, '0')}`;
    const labels = isRecord(item.labels) ? item.labels : {};
    const topics = Array.isArray(labels.topics)
      ? labels.topics.filter((topic): topic is string => typeof topic === 'string')
      : [];
    const expectedRaw = labels.expectedLevel;
    const expectedLevel =
      expectedRaw === 'P0' || expectedRaw === 'P1' || expectedRaw === 'P2' || expectedRaw === 'none'
        ? expectedRaw
        : 'none';
    const sentiment =
      labels.sentiment === 'positive' || labels.sentiment === 'negative' ? labels.sentiment : 'neutral';
    return {
      id,
      source:
        item.source === 'taptap' ||
        item.source === 'googleplay' ||
        item.source === 'community' ||
        item.source === 'ticket'
          ? item.source
          : 'steam',
      brand: typeof item.brand === 'string' ? item.brand : '星海远征',
      author: typeof item.author === 'string' ? item.author : '匿名用户',
      publishedAt: typeof item.publishedAt === 'string' ? item.publishedAt : '2026-10-27T10:00:00+08:00',
      text: typeof item.text === 'string' ? item.text : '',
      language: typeof item.language === 'string' ? item.language : undefined,
      labels: {
        sentiment,
        topics,
        primaryTopic:
          typeof labels.primaryTopic === 'string' && labels.primaryTopic.length > 0
            ? labels.primaryTopic
            : '其他',
        expectedLevel,
        noise: labels.noise === true,
        note: typeof labels.note === 'string' ? labels.note : '',
        severity: typeof labels.severity === 'string' ? labels.severity : undefined,
        confidence: typeof labels.confidence === 'number' ? labels.confidence : undefined,
        needsReview: typeof labels.needsReview === 'boolean' ? labels.needsReview : undefined,
        sentimentScore: typeof labels.sentimentScore === 'number' ? labels.sentimentScore : undefined,
      },
    } satisfies SentimentDatasetItem;
  });

  if (items.length === 0) {
    throw new DataLoadError(`舆情数据集为空：${file}`);
  }
  return {
    datasetId: typeof raw.datasetId === 'string' ? raw.datasetId : entry.datasetId,
    version: typeof raw.version === 'string' ? raw.version : entry.version,
    description: typeof raw.description === 'string' ? raw.description : '',
    items,
  };
}

/* ------------------------------ 知识库种子 ------------------------------ */

const KNOWLEDGE_CATEGORIES: readonly KnowledgeCategory[] = ['refund', 'recharge', 'activity', 'version', 'account', 'other'];
const KNOWLEDGE_STATUSES: readonly KnowledgeStatus[] = ['draft', 'published', 'offline'];
const KNOWLEDGE_SOURCES: readonly KnowledgeSource[] = ['official', 'qc_badcase', 'manual'];
const KNOWLEDGE_COMPARES: readonly KnowledgeFactCompare[] = ['number', 'duration_minutes', 'date', 'text'];

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : [];
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asIntegerOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function parseKnowledgeFact(raw: unknown, index: number): KnowledgeFact {
  const fact = isRecord(raw) ? raw : {};
  const rawCompare = asString(fact.compare, 'text');
  const compare: KnowledgeFactCompare = (KNOWLEDGE_COMPARES as readonly string[]).includes(rawCompare)
    ? (rawCompare as KnowledgeFactCompare)
    : 'text';
  return {
    key: asString(fact.key) || `fact-${index + 1}`,
    label: asString(fact.label) || '未命名事实',
    expected: asString(fact.expected) || '待补充',
    compare,
    expectedNumber: asNumberOrNull(fact.expectedNumber),
    expectedMinutes: asNumberOrNull(fact.expectedMinutes),
    expectedMonth: asIntegerOrNull(fact.expectedMonth),
    expectedDay: asIntegerOrNull(fact.expectedDay),
    unit: typeof fact.unit === 'string' ? fact.unit : null,
    claimPatterns: asStringArray(fact.claimPatterns),
    violationPatterns: asStringArray(fact.violationPatterns),
    note: typeof fact.note === 'string' ? fact.note : null,
  };
}

function parseKnowledgeRevision(raw: unknown, index: number): KnowledgeRevision {
  const revision = isRecord(raw) ? raw : {};
  const rawStatus = asString(revision.status, 'draft');
  const status: KnowledgeStatus = (KNOWLEDGE_STATUSES as readonly string[]).includes(rawStatus)
    ? (rawStatus as KnowledgeStatus)
    : 'draft';
  const rawFacts = Array.isArray(revision.facts) ? revision.facts : [];
  return {
    version: asIntegerOrNull(revision.version) ?? index + 1,
    status,
    content: asString(revision.content),
    facts: rawFacts.map((fact, factIndex) => parseKnowledgeFact(fact, factIndex)),
    note: asString(revision.note),
    by: asString(revision.by) || '顾清',
    at: asString(revision.at) || '2026-11-03T10:00:00+08:00',
  };
}

function parseKnowledgeEntry(raw: unknown, index: number): KnowledgeSeedEntry {
  const entry = isRecord(raw) ? raw : {};
  const rawCategory = asString(entry.category, 'other');
  const category: KnowledgeCategory = (KNOWLEDGE_CATEGORIES as readonly string[]).includes(rawCategory)
    ? (rawCategory as KnowledgeCategory)
    : 'other';
  const rawSource = asString(entry.source, 'manual');
  const source: KnowledgeSource = (KNOWLEDGE_SOURCES as readonly string[]).includes(rawSource)
    ? (rawSource as KnowledgeSource)
    : 'manual';
  const rawRevisions = Array.isArray(entry.revisions) ? entry.revisions : [];
  const revisions = rawRevisions
    .map((revision, revisionIndex) => parseKnowledgeRevision(revision, revisionIndex))
    .sort((left, right) => left.version - right.version);

  const owner = asString(entry.owner) || '顾清';
  if (revisions.length === 0) {
    revisions.push({
      version: 1,
      status: 'draft',
      content: asString(entry.content) || '待补充标准口径',
      facts: [],
      note: '导入时缺少版本历史，自动补为草稿',
      by: owner,
      at: '2026-11-03T10:00:00+08:00',
    });
  }

  const sourceRefRaw = entry.sourceRef;
  let sourceRef: KnowledgeSourceRef | null = null;
  if (isRecord(sourceRefRaw)) {
    const type = asString(sourceRefRaw.type, 'manual');
    sourceRef = {
      type: type === 'conversation' || type === 'badcase' ? type : 'manual',
      id: asString(sourceRefRaw.id),
      label: asString(sourceRefRaw.label),
    };
  }

  return {
    key: asString(entry.key) || `seed-${index + 1}`,
    code: asString(entry.code) || `KB-${1001 + index}`,
    title: asString(entry.title) || `知识条目 ${index + 1}`,
    category,
    keywords: asStringArray(entry.keywords),
    owner,
    source,
    sourceRef,
    linkedBadcaseIds: asStringArray(entry.linkedBadcaseIds),
    revisions,
  };
}

function parseKnowledgeDataset(raw: unknown): KnowledgeDataset {
  if (!isRecord(raw) || !Array.isArray(raw.entries) || raw.entries.length === 0) {
    return {
      datasetId: 'knowledge-seed-v0.1',
      version: '0.1.0',
      description: '知识库种子缺失，按空知识库运行。',
      entries: [],
    };
  }
  return {
    datasetId: asString(raw.datasetId, 'knowledge-seed-v0.1'),
    version: asString(raw.version, '0.1.0'),
    datasetVersion: asString(raw.datasetVersion) || undefined,
    description: asString(raw.description),
    generatedAt: asString(raw.generatedAt) || undefined,
    entries: raw.entries
      .filter(isRecord)
      .map((entry, index) => parseKnowledgeEntry(entry, index)),
  };
}

/** 读取并解析全部原始数据集。 */
export function loadDatasets(): LoadedDatasets {
  const manifestPath = path.join(DATA_DIR, 'manifest.json');
  const manifest = parseManifest(readJsonFile(manifestPath));

  const qcFile = resolveDatasetPath(manifest.datasets.qc.file || 'qc/dataset.json');
  const sentimentFile = resolveDatasetPath(manifest.datasets.sentiment.file || 'sentiment/dataset.json');

  const qc = parseQcDataset(readJsonFile(qcFile), manifest.datasets.qc, qcFile);
  const sentiment = parseSentimentDataset(readJsonFile(sentimentFile), manifest.datasets.sentiment, sentimentFile);

  const knowledgeFile = path.join(DATA_DIR, 'knowledge/entries.json');
  const knowledge = fs.existsSync(knowledgeFile)
    ? parseKnowledgeDataset(readJsonFile(knowledgeFile))
    : parseKnowledgeDataset(null);

  return {
    manifest,
    qc,
    sentiment,
    knowledge,
    datasetStamp: manifest.version,
    displayDatasetVersion: manifest.datasetVersion ?? manifest.version,
  };
}
