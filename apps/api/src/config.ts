/**
 * 全局配置：端口、数据目录、存储路径、演示时间基准与引擎版本。
 *
 * 说明（QCC Workbench MVP，冻结基线）：
 * - 仅监听 127.0.0.1，无鉴权，零外部网络调用；
 * - 运行态持久化到单文件 JSON（`apps/api/.data/store.json`）；
 * - 演示时间基准 `DEMO_NOW` 固定，保证同一数据的引擎判定/统计/SLA 展示可复现。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/** 仓库根目录（src 与 dist 均位于 apps/api/ 下一层，向上三级即仓库根）。 */
export const REPO_ROOT = path.resolve(moduleDir, '../../..');

/** 应用版本（/api/health、/api/meta 展示）。 */
export const APP_VERSION = '0.1.0';

/** 规则引擎版本号（写入 QcResult.modelVersion、评测记录）。 */
export const MODEL_VERSION = 'rule-engine-v0.3.0';

/** 运行态存储结构版本；结构变更时递增以触发重建。 */
export const STORE_SCHEMA_VERSION = 2;

/** 低置信度阈值：confidence < 0.75 时 needsReview = true。 */
export const REVIEW_CONFIDENCE_THRESHOLD = 0.75;

/** 监听端口（仅 127.0.0.1）。 */
export const PORT = Number(process.env.PORT ?? 8787);

/** 监听地址（仅本机）。 */
export const HOST = process.env.HOST ?? '127.0.0.1';

/** 前端开发服务器地址，用于 CORS。 */
export const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://127.0.0.1:5178';

/**
 * 演示"当前时间"基线（东八区，无毫秒）。
 * 种子时间、SLA/超期判定、趋势窗口均以此为基准；可用环境变量覆写。
 */
export const DEMO_NOW_ISO = process.env.DEMO_NOW ?? '2026-11-03T10:00:00+08:00';

/** 原始数据集目录（只读输入）。 */
export const DATA_DIR = process.env.DATA_DIR ?? path.join(REPO_ROOT, 'data');

/** 运行态存储文件路径。 */
export const STORE_PATH = process.env.STORE_PATH ?? path.join(REPO_ROOT, 'apps/api/.data/store.json');

/** 引擎中文名（/api/meta 的 about 区块展示）。 */
export const ENGINE_NAME = '确定性规则引擎';
