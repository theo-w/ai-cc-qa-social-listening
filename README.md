# QCC Workbench · AI 客服运营质量管控工作台（MVP）

> 用 AI 把客服质量管控和舆情响应，从「抽检 + 人工盯」变成「全量检测 + 分级响应 + 闭环复盘 + 线索传递」。

QCC Workbench 是《AI 客服运营质量管控工作台 MVP》的完整可演示实现：一份 SDD（规范驱动开发）文档集 + 一个可本地运行的全栈 Demo。项目面向客服/质检/培训/主管、品牌/市场、产研等角色，覆盖三条主线：

1. **AI 质检与 badcase 闭环**：全量对话检测 → 评分/标签/证据 → 低置信度人工复核 → badcase 归因分派 → 整改证明 → 复发识别。
2. **舆情分级预警与快速响应**：公开评论/工单导入 → 情感与主题 → 单条分级 + 聚簇升级（P0/P1/P2）→ 预警 SOP 处置 → 转线索。
3. **运营看板与线索传递（底座）**：7 个北极星指标、异常检测与下钻、一键生成产品/品牌/市场线索并跟踪闭环。

同时内置**评测中心**：用带人工金标的评测集回放质检与舆情引擎，直接给出准确率、误报/漏报、响应时长、预警准确率等指标与发布门禁结论。

---

## 单文件演示（零依赖）

不想启动服务？直接用浏览器打开 [`demo.html`](demo.html)：

- 单个 HTML 文件，CSS / JS / 合成数据全部内嵌，双击即可打开，无需 `pnpm install`；
- 覆盖运营总览、质检、badcase、舆情、线索、评测、关于 7 个页面；
- 支持质检证据回看与人工复核、badcase 状态流转、预警 SOP、线索流转、评测门禁查看（状态仅保存在页面内存，刷新复位）。

---

## 快速开始

前置：Node ≥ 22（推荐 24）、pnpm ≥ 9（推荐 10+）。

```bash
# 1. 安装依赖（monorepo，一次装完）
pnpm install

# 2. 同时启动 API 与 Web（API 8787，Web 5178）
pnpm dev
```

打开：

- Web：<http://127.0.0.1:5178>
- API 健康检查：<http://127.0.0.1:8787/api/health>
- OpenAPI 契约（唯一接口事实源）：[`specs/contracts/openapi.yaml`](specs/contracts/openapi.yaml)

首次启动时 API 会：

1. 读取 `data/` 下的评测/种子数据集；
2. 用确定性规则引擎（`rule-engine-v0.3.0`）对全部对话与评论做分析；
3. 生成运行态数据并落到 `apps/api/.data/store.json`；
4. 自动跑一轮评测作为基线历史。

想回到初始演示状态：`pnpm reset`（或 `POST /api/admin/reset`）。重置是确定性的，重复 reset 结果一致。

### 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 并行启动 API（8787）与 Web（5178） |
| `pnpm build` | 构建全部 workspace（API `tsc` + Web `vite build`） |
| `pnpm start` | 以构建产物启动 API（`apps/api/dist`） |
| `pnpm typecheck` | 全仓 TypeScript 严格检查 |
| `pnpm test` | 运行 QA 测试（数据校验 + 契约 + 端到端验收；需 API 已启动） |
| `pnpm eval` | 通过 API 跑质检与舆情评测并输出指标 |
| `pnpm reset` | 重置运行态数据到初始演示状态 |

> `pnpm test` / `pnpm eval` 依赖已在 8787 运行的 API；先 `pnpm dev` 或 `pnpm start`。

---

## 目录结构

```
.
├── specs/                      # SDD 规范（本项目的"事实源"）
│   ├── README.md               # SDD 方法、阶段、门禁、ID 规范
│   ├── 000-charter.md          # 项目章程：目标/非目标/原则/指标
│   ├── 001-prd.md              # 结构化 PRD（PRD-* 需求编号）
│   ├── 002-spec.md             # 功能规格（FR-* + Given/When/Then）
│   ├── 003-architecture.md     # 架构、数据流、ADR
│   ├── 004-data-model.md       # 实体、状态机、数据模型、数据集格式
│   ├── 005-api-contract.md     # 人读 API 契约（27 端点）
│   ├── contracts/openapi.yaml  # 机读 OpenAPI 契约（唯一接口事实源）
│   ├── 006-ui-spec.md          # 设计系统、9 个页面规格
│   ├── 007-evaluation-spec.md  # 评测指标口径、门禁
│   ├── 008-tasks.md            # 任务分解、里程碑、工作协议
│   ├── traceability.md         # PRD→FR→API→UI→TEST 追溯矩阵
│   ├── fixtures/               # 契约示例 fixture（QA 复用）
│   └── checklists/             # 评审/评测/发布检查清单
├── data/                       # 合成评测/种子数据集（确定性生成）
│   ├── qc/dataset.json         # 60 条带金标的客服对话
│   ├── sentiment/dataset.json  # 120 条带金标的公开评论
│   ├── manifest.json           # 数据集版本与定额校验
│   └── scripts/generate.mjs    # 确定性生成 + --check 校验
├── docs/                       # 业务侧文档（模板/SOP/口径/培训闭环）
├── apps/api/                   # Node 24 + Express 5 + TS + zod
├── apps/web/                   # React 19 + Vite 7 + TS（纯 CSS + SVG 图表）
└── tests/                      # 零依赖 QA 测试（node:test + fetch）
```

---

## 三个模块与关键交互

### 1. AI 质检（`/qc`、`/qc/:id`）

- **全量检测**：对话导入后由规则引擎输出 6 类标签：服务态度、违规话术、答非所问、知识错误、响应超时、情绪升级；每类带权重、证据（消息 seq + 原文引用）、置信度与摘要。
- **评分**：`score = clamp(100 - Σ权重, 0, 100)`；存在任一违规标签即 `violation`。
- **证据回看**：详情页高亮命中消息，标签可展开查看规则 ID 与引用。
- **低置信度复核**：`confidence < 0.75` 自动进入人工复核队列；支持「确认 / 推翻 / 修正」三种动作，重复复核返回 409。
- **badcase 闭环**：违规对话一键创建 badcase，按根因自动路由责任人并设置 SLA（knowledge 顾清 48h / script 唐沐 48h / process 陆川 24h / system 周野 72h），状态机 `open → in_progress → pending_verify → closed`，关闭必须填写整改证明；同坐席同主标签 14 天内复发会自动标记 `recurrence`。

### 2. 舆情预警（`/sentiment`、`/sentiment/alerts/:id`）

- 120 条评论覆盖 Steam / TapTap / GooglePlay / 社群 / 工单五类来源，情感 + 主题（版本、充值、外挂、客服、活动、Bug 等）。
- **单条分级**：P0（高危主题 + 高危信号词，如回档/封号误封/扣款未到账/维权/12315/媒体曝光）、P1（明确影响）、P2（一般抱怨）、none（正面/中性/噪声）。
- **聚簇升级**：按 `主题 × 日期` 聚合，负面 ≥ 8 条升 P0、3–7 条至少 P1、1–2 条至少 P2；每簇生成一条预警，带触发规则与关联评论。
- **SOP 处置**：`acknowledge → respond → escalate → resolve`，记录首次响应与各节点时间线；P0 SLA 30 分钟、P1 2 小时、P2 24 小时。
- 预警可一键转线索，联动品牌/市场/产研。

### 3. 运营看板与线索（`/`、`/clues`）

- 7 个 KPI：质检覆盖率、质检准确率、badcase 闭环率、P0 响应时长、预警准确率、线索闭环率、CSAT，均带目标值、状态与环比。
- 趋势（7/14/30 天）、质检分布、舆情趋势、待办；指标异常自动生成异常项，可下钻到 case 列表/预警/线索并携带筛选条件。
- 线索状态机 `draft → routed → accepted/rejected → closed`，按目标路由责任人（product→周野，brand→江岚，market→程雨）；关闭需填写结果。

### 4. 评测中心（`/eval`）

- 展示数据集版本与定额；一键运行质检/舆情评测。
- 输出指标、混淆矩阵、最多 20 条错例与门禁结论（`thresholdsMet`），历史保留、重复运行结果一致。

---

## 评测指标（MVP 门禁）

| 模块 | 指标 | 目标 | 实际 |
|---|---|---|---|
| 质检 | 覆盖率 / 准确率 / 误报率 / 漏报率 / badcase 闭环率 | ≥90% / ≥80% / ≤15% / ≤20% / ≥70% | 100% / 100% / 0% / 0% / — |
| 质检 | 人工复核占比 / 单条耗时 | ≤30% / 较人工下降 ≥50% | 11.7% / 0.07ms |
| 舆情 | 预警准确率 / 主题准确率 / 情感准确率 | ≥80% / ≥75% / ≥80% | 100% / 100% / 100% |
| 舆情 | 预警召回 / P0 召回 / 复核占比 | ≥80% / ≥90% / ≤30% | 100% / 100% / 23.3% |
| 舆情 | P0 响应 / P1 响应 | ≤30 分钟 / ≤2 小时 | 9 分钟 / 36 分钟（演示种子） |
| 看板/线索 | 异常下钻率 / 线索闭环率 | ≥50% / ≥60% | — |

> 指标基于固定的合成金标评测集（`sentiment-eval-v0.1` / `qc-eval-v0.1`）与确定性规则引擎 `rule-engine-v0.3.0`，用于回归与发布门禁，不代表线上泛化效果；口径见 [`specs/007-evaluation-spec.md`](specs/007-evaluation-spec.md)。

## 当前状态

| 项目 | 状态 |
|---|---|
| 前端页面 | 8/8 完成（总览、质检列表/详情、badcase 列表/详情、舆情评论/预警详情、线索列表、评测中心、关于页） |
| 后端 API | 27 端点全部实现 |
| 契约与数据测试 | 32/32 通过 |
| 验收测试 | 16/16 通过 |
| 质检评测 | 门禁通过（accuracy 100%，verdictAccuracy 100%，FP 0%，FN 0%） |
| 舆情评测 | 门禁通过（sentimentAccuracy 100%，topicAccuracy 100%，alertPrecision 100%，alertRecall 100%） |
| TypeScript 构建 | 通过 |

完整口径、公式与数据集构成见 [`specs/007-evaluation-spec.md`](specs/007-evaluation-spec.md)。

---

## 技术栈与设计取舍

| 层 | 选择 | 理由（ADR） |
|---|---|---|
| 仓库 | pnpm workspaces 单仓 | 一人/小团队交付，契约与前后端同仓演进（ADR-001） |
| AI | 确定性规则引擎 `rule-engine-v0.3.0`，保留 Provider 扩展位 | 零成本、可复现、可评测；MVP 不训练模型（ADR-002） |
| 后端 | Node 24 + TypeScript strict + Express 5 + zod，JSON 单文件存储 | 无外部依赖、随时重置、演示稳定（ADR-003） |
| 契约 | OpenAPI 3.0.3 契约优先，前后端类型对齐 | 契约是唯一事实源，变更需评审（ADR-004） |
| 前端 | React 19 + Vite 7 + 纯 CSS + 自研 SVG 图表 | 无 UI 库/图表库，设计可控、体积小（ADR-005） |
| 数据 | 合成数据 + 人工金标，固定种子确定性生成 | 隐私安全、可演示、可回归（ADR-006） |
| 时间 | `DEMO_NOW` 固定演示时刻，SLA/趋势贴近最近 14 天 | 演示可复现（ADR-007） |

## 边界（不做什么）

- 不做完整客服系统（不接真实会话/工单系统，用导入数据演示）。
- 不做模型训练平台（MVP 用规则引擎，保留 AI Provider 接口）。
- 不做全渠道舆情爬虫（用公开评论 + 导入数据）。
- 不自动对外发布、不自动处罚坐席；AI 只做初判与建议，人工复核与决策保留。

## 文档索引

- SDD 方法与本项目规范：[`specs/README.md`](specs/README.md)
- 项目章程：[`specs/000-charter.md`](specs/000-charter.md)
- PRD / 功能规格：[`specs/001-prd.md`](specs/001-prd.md) · [`specs/002-spec.md`](specs/002-spec.md)
- 架构与 ADR：[`specs/003-architecture.md`](specs/003-architecture.md)
- 数据模型：[`specs/004-data-model.md`](specs/004-data-model.md)
- API 契约：[`specs/005-api-contract.md`](specs/005-api-contract.md) · [`specs/contracts/openapi.yaml`](specs/contracts/openapi.yaml)
- UI 规范：[`specs/006-ui-spec.md`](specs/006-ui-spec.md)
- 评测规范：[`specs/007-evaluation-spec.md`](specs/007-evaluation-spec.md)
- 任务与里程碑：[`specs/008-tasks.md`](specs/008-tasks.md)
- 追溯矩阵：[`specs/traceability.md`](specs/traceability.md)

## License

仅用于作品集/演示用途。
