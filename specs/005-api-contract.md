# 005 · API 契约（人读版）

| 项 | 内容 |
|---|---|
| 版本 | v0.1.1 |
| 机器可读契约 | `specs/contracts/openapi.yaml`（**唯一事实来源**） |
| Base URL | 开发：`http://127.0.0.1:8787`；前端通过 Vite 代理 `/api` → 8787 |
| 认证 | MVP 无鉴权（演示态）；生产鉴权为后续版本 |
| 时间格式 | ISO 8601 带时区偏移 |
| 变更规则 | 实现与本文不一致时以 openapi 为准；改契约须同步本文件与 fixtures |

## 1. 通用约定

### 1.1 响应形态

- 单对象：直接返回对象，如 `GET /api/badcases/bc-0001` → `Badcase`。
- 列表：`{ "items": [...], "page": 1, "pageSize": 20, "total": 37 }`。
- 错误：`{ "error": { "code": "NOT_FOUND", "message": "badcase 不存在", "details": null } }`。

### 1.2 分页与筛选

- `page` 默认 1，`pageSize` 默认 20（最大 100）。
- 通用搜索参数 `q`：模糊匹配标题/文本/责任人；`range`：`7d` / `14d` / `30d`。

### 1.3 错误码

| HTTP | code | 场景 |
|---|---|---|
| 400 | `BAD_REQUEST` | 参数缺失/格式错误 |
| 404 | `NOT_FOUND` | 实体不存在 |
| 409 | `CONFLICT` | 非法状态转移（如闭单缺 proof、重复复核） |
| 422 | `VALIDATION_ERROR` | 请求体不符合契约（含 details 字段级说明） |
| 500 | `INTERNAL` | 未预期错误（不暴露堆栈） |

### 1.4 幂等与一致性

- `POST /api/qc/conversations/{id}/reviews`：同一对话已有 `pending` 复核任务返回 409；**复核已完成（done）后再次提交同样返回 409**（复核结论为终态，保证留痕唯一、可审计）。
- `POST /api/eval/runs`：每次调用都是新 run（不做幂等）；同数据集同引擎版本结果必须一致。
- 所有写操作在 `apps/api/.data/store.json` 原子落盘后返回（写成功 = 已持久化）。
- `POST /api/admin/reset`：清空运行态，按 `data/` 重新种子，返回重建后的计数摘要。

## 2. 端点清单

| API ID | 方法 | 路径 | 说明 | 对应 FR |
|---|---|---|---|---|
| API-META-01 | GET | `/api/health` | 健康检查 | — |
| API-META-02 | GET | `/api/meta` | 字典/角色/标签/枚举/演示信息 | FR-PLAT-01 |
| API-META-03 | POST | `/api/admin/reset` | 重置演示数据 | FR-PLAT-04 |
| API-DASH-01 | GET | `/api/dashboard/summary` | 看板 KPI 汇总 | FR-DASH-01 |
| API-DASH-02 | GET | `/api/dashboard/trends` | 14 天趋势 | FR-DASH-02 |
| API-DASH-03 | GET | `/api/dashboard/anomalies` | 异常列表（可下钻） | FR-DASH-03 |
| API-QC-01 | GET | `/api/qc/stats` | 质检概览统计 | FR-QC-01 |
| API-QC-02 | GET | `/api/qc/conversations` | 对话列表（筛/排/搜） | FR-QC-01 |
| API-QC-03 | GET | `/api/qc/conversations/{id}` | 对话 + 质检结果 + 复核 + badcase | FR-QC-01 |
| API-QC-04 | POST | `/api/qc/conversations/{id}/reviews` | 提交人工复核 | FR-QC-02 |
| API-QC-05 | POST | `/api/qc/conversations/{id}/badcases` | 从质检结果转 badcase | FR-BC-01 |
| API-KB-01 | GET | `/api/knowledge` | 知识条目列表（筛/搜/分页） | FR-KB-001 |
| API-KB-02 | GET | `/api/knowledge/stats` | 知识库统计与关联率 | FR-KB-006 |
| API-KB-03 | GET | `/api/knowledge/gaps` | 知识缺口列表 | FR-KB-003 |
| API-KB-04 | GET | `/api/knowledge/{id}` | 知识条目详情（证据/版本/badcase） | FR-KB-001 |
| API-KB-05 | POST | `/api/knowledge` | 新建知识草稿 | FR-KB-001 |
| API-KB-06 | POST | `/api/knowledge/{id}/revisions` | 新建修订（回到 draft） | FR-KB-001 |
| API-KB-07 | POST | `/api/knowledge/{id}/publish` | 发布并自动复测 | FR-KB-005 |
| API-KB-08 | POST | `/api/knowledge/{id}/offline` | 下线并自动复测 | FR-KB-005 |
| API-KB-09 | POST | `/api/knowledge/{id}/recheck` | 手动复测 | FR-KB-005 |
| API-KB-10 | POST | `/api/knowledge/suggestions` | 从会话/badcase 生成草稿（幂等） | FR-KB-004 |
| API-BC-01 | GET | `/api/badcases` | badcase 列表 | FR-BC-01 |
| API-BC-02 | GET | `/api/badcases/{id}` | badcase 详情（含时间线/来源） | FR-BC-02 |
| API-BC-03 | POST | `/api/badcases/{id}/actions` | 状态流转动作 | FR-BC-02 |
| API-BC-04 | GET | `/api/badcases/stats` | 闭环统计 | FR-BC-03 |
| API-SEN-01 | GET | `/api/sentiment/stats` | 舆情概览统计 | FR-SEN-01 |
| API-SEN-02 | GET | `/api/sentiment/comments` | 评论列表 | FR-SEN-01 |
| API-SEN-03 | GET | `/api/sentiment/alerts` | 预警列表 | FR-SEN-02 |
| API-SEN-04 | GET | `/api/sentiment/alerts/{id}` | 预警详情（评论/时间线/线索） | FR-SEN-02 |
| API-SEN-05 | POST | `/api/sentiment/alerts/{id}/actions` | SOP 动作 | FR-SEN-03 |
| API-CLUE-01 | GET | `/api/clues` | 线索列表 | FR-CLUE-01 |
| API-CLUE-02 | GET | `/api/clues/{id}` | 线索详情 | FR-CLUE-01 |
| API-CLUE-03 | POST | `/api/clues` | 创建线索（三个入口共用） | FR-CLUE-02 |
| API-CLUE-04 | POST | `/api/clues/{id}/actions` | 线索流转动作 | FR-CLUE-03 |
| API-EVAL-01 | GET | `/api/eval/datasets` | 可评测数据集列表 | FR-EVAL-01 |
| API-EVAL-02 | POST | `/api/eval/runs` | 运行评测 | FR-EVAL-02 |
| API-EVAL-03 | GET | `/api/eval/runs` | 历史评测 | FR-EVAL-03 |
| API-EVAL-04 | GET | `/api/eval/runs/{id}` | 评测详情（指标/混淆矩阵/错例） | FR-EVAL-03 |

## 3. 关键请求/响应

### 3.1 质检列表项 `ConversationListItem`

```json
{
  "id": "conv-1001",
  "channel": "online",
  "product": "星海远征",
  "agentName": "林晓",
  "customerName": "用户8821",
  "startedAt": "2026-10-27T10:12:00+08:00",
  "durationSec": 486,
  "messageCount": 8,
  "score": 75,
  "verdict": "violation",
  "needsReview": false,
  "emotion": "angry",
  "summary": "用户反馈充值未到账，坐席查询后以反问回应，判定服务态度违规。",
  "tags": [{ "code": "attitude", "name": "服务态度", "severity": "high" }]
}
```

### 3.2 对话详情 `ConversationDetail`

```json
{
  "conversation": { "...": "Conversation（含 messages）" },
  "qcResult": { "...": "QcResult（含 tags/evidence）" },
  "review": { "...": "ReviewTask 或 null" },
  "badcase": { "...": "Badcase 或 null" }
}
```

### 3.3 发起复核 `POST /api/qc/conversations/{id}/reviews`

请求：

```json
{ "decision": "confirm", "finalTags": ["attitude"], "note": "确认服务态度问题", "reviewer": "沈言" }
```

- `decision`：`confirm`（认可 AI）/ `overturn`（改判为正常）/ `amend`（修正标签）。
- `amend` 时 `finalTags` 必填且非空；`overturn` 时 `finalTags` 必须为空数组。
- 响应：`{ "review": {ReviewTask}, "qcResult": {QcResult} }`，同时若存在关联 badcase，则更新其 `status` 不受影响（badcase 独立流转）。

### 3.4 转 badcase `POST /api/qc/conversations/{id}/badcases`

```json
{ "category": "knowledge", "owner": "顾清", "slaHours": 48, "title": "充值到账规则说明错误", "rootCause": "知识库条目版本过旧" }
```

- `category` 必填；`owner` 缺省按 category 路由（knowledge→顾清、script→唐沐、process→陆川、system→周野）。
- `slaHours` 缺省按 **category**：knowledge=48、script=48、process=24、system=72（不允许按 severity 推导；severity 仅用于展示）。
- `title` / `rootCause` 可省略：`title` 自动生成为「{对话 id} · {主标签中文名}」，`rootCause` 可为空字符串。
- 同一对话已有未关闭 badcase 时返回 409。
- 响应：`Badcase`。

### 3.5 badcase 动作 `POST /api/badcases/{id}/actions`

| type | 允许的前态 | 后态 | 必填 |
|---|---|---|---|
| `assign` | open / in_progress | in_progress | `owner` |
| `progress` | open / in_progress | in_progress | `note` |
| `verify` | in_progress | pending_verify | `note` |
| `close` | pending_verify | closed | `proof` |
| `reopen` | closed | in_progress | `note` |
| `comment` | 任意 | 不变 | `note` |

请求：`{ "type": "close", "note": "知识库已更新 v3", "proof": "知识库 KB-188 已修订并完成复测", "by": "顾清" }`。响应：`Badcase`。

### 3.6 舆情预警动作 `POST /api/sentiment/alerts/{id}/actions`

| type | 前态 | 后态 | 说明 |
|---|---|---|---|
| `acknowledge` | new | acknowledged | 写 `firstResponseAt` |
| `respond` | acknowledged | responding | 记录处理动作 |
| `escalate` | new/acknowledged/responding | escalated | P0 或升级；通知范围扩大 |
| `resolve` | responding/escalated | resolved | 写 `resolvedAt` |
| `comment` | 任意 | 不变 | 仅记录 |

请求：`{ "type": "acknowledge", "note": "已确认，品牌侧开始准备口径", "by": "江岚" }`。响应：`SentimentAlert`。

### 3.7 线索创建 `POST /api/clues`

```json
{
  "title": "充值到账延迟的系统性反馈",
  "description": "舆情簇 10-30 外挂/充值 集中负面，建议产研排查支付回调。",
  "sourceType": "sentiment",
  "sourceRef": { "type": "alert", "id": "alt-0002", "label": "外挂 · 10-30 集中负面" },
  "target": "product",
  "priority": "high",
  "evidence": ["回档 + 充值损失，P0"],
  "createdBy": "江岚"
}
```

响应：`Clue`（初始 `status=draft`）。

### 3.8 线索动作 `POST /api/clues/{id}/actions`

| type | 前态 | 后态 | 必填 |
|---|---|---|---|
| `route` | draft | routed | `owner` |
| `accept` | routed | accepted | `owner`（可覆盖） |
| `reject` | routed | rejected→closed | `note`（理由） |
| `close` | accepted | closed | `outcome` |
| `comment` | 任意 | 不变 | `note` |

### 3.9 评测运行 `POST /api/eval/runs`

请求：`{ "dataset": "qc" }` 或 `{ "dataset": "sentiment" }`。响应：`EvalRun`（含 `metrics`、`confusion`、`mismatches`、`thresholdsMet`）。

指标键：

- qc：`coverage`、`accuracy`、`verdictAccuracy`、`falsePositiveRate`、`falseNegativeRate`、`reviewRatio`、`avgLatencyMs`、`tagPrecision`（对象）。
- sentiment：`sentimentAccuracy`、`topicAccuracy`、`alertPrecision`、`alertRecall`、`p0Recall`、`reviewRatio`。

### 3.10 看板

`GET /api/dashboard/summary?range=7d`：

```json
{
  "range": "7d",
  "generatedAt": "2026-11-03T10:00:00+08:00",
  "kpis": [
    { "id": "qcCoverage", "label": "质检覆盖率", "value": 0.94, "target": 0.9, "op": ">=", "status": "ok", "delta": 0.03, "unit": "%", "hint": "近 7 天 vs 前 7 天" },
    { "id": "qcAccuracy", "label": "质检准确率", "value": 0.84, "target": 0.8, "op": ">=", "status": "ok", "delta": 0.02, "unit": "%" },
    { "id": "badcaseCloseRate", "label": "badcase 闭环率", "value": 0.72, "target": 0.7, "op": ">=", "status": "ok", "delta": -0.01, "unit": "%" },
    { "id": "p0ResponseMin", "label": "P0 响应时长", "value": 21, "target": 30, "op": "<=", "status": "ok", "delta": -4, "unit": "min" },
    { "id": "alertPrecision", "label": "舆情预警准确率", "value": 0.83, "target": 0.8, "op": ">=", "status": "ok", "delta": 0.01, "unit": "%" },
    { "id": "clueCloseRate", "label": "线索闭环率", "value": 0.64, "target": 0.6, "op": ">=", "status": "ok", "delta": 0.05, "unit": "%" }
  ],
  "volume": { "conversations": 60, "reviewPending": 9, "badcasesOpen": 7, "alertsOpen": 4, "cluesOpen": 3 },
  "quality": { "avgScore": 78.4, "violationRate": 0.55 },
  "distribution": {
    "tags": [{ "code": "attitude", "name": "服务态度", "count": 9 }],
    "channels": [{ "channel": "online", "count": 28 }],
    "alertLevels": [{ "level": "P0", "count": 2 }, { "level": "P1", "count": 5 }, { "level": "P2", "count": 6 }],
    "clueTargets": [{ "target": "product", "count": 4 }]
  }
}
```

`GET /api/dashboard/trends?range=14d` → `{ "range": "14d", "rows": [{ "date": "2026-10-21", "qcCoverage": 0.91, "qcAccuracy": 0.81, "badcaseCloseRate": 0.66, "p0ResponseMin": 26, "alertPrecision": 0.79, "clueCloseRate": 0.55, "csat": 0.87 }] }`。

`GET /api/dashboard/anomalies` → `{ "items": [{ "id": "anomaly-1", "metric": "p1ResponseMin", "metricLabel": "P1 响应时长", "current": 146, "target": 120, "deviation": 0.22, "severity": "warn", "drillType": "sentiment", "drillFilter": { "level": "P1", "status": "new" }, "owner": "江岚", "suggestion": "P1 预警待确认 2 条已接近 SLA" }] }`。

### 3.12 知识库 `GET /api/knowledge` / `POST /api/knowledge/{id}/publish`

**列表项 `KnowledgeListItem`**

```json
{
  "id": "kb-0001",
  "code": "KB-1001",
  "title": "退款规则与手续费",
  "category": "refund",
  "status": "published",
  "version": 2,
  "owner": "顾清",
  "source": "official",
  "knowledgeHits": 4,
  "linkedHits": 4,
  "linkedBadcases": 1,
  "updatedAt": "2026-10-28T15:30:00+08:00"
}
```

**详情 `KnowledgeDetail`**

```json
{
  "entry": { "...": "KnowledgeEntry（含 facts/revisions）" },
  "hits": [{ "conversationId": "conv-1018", "agentName": "陈默", "seq": 2, "quote": "退款手续费是 20%，这个是公司规定。", "expected": "0%（不收取手续费）", "actual": "20%" }],
  "badcases": [{ "...": "Badcase" }]
}
```

**发布 `POST /api/knowledge/{id}/publish`**

请求：`{ "by": "顾清", "note": "官方公告已核对" }`。响应：

```json
{
  "entry": { "...": "KnowledgeEntry" },
  "recheck": {
    "rechecked": 57,
    "changed": 1,
    "before": { "knowledgeTags": 8, "linkedKnowledgeTags": 7, "unlinkedKnowledgeTags": 1, "gaps": 1 },
    "after": { "knowledgeTags": 8, "linkedKnowledgeTags": 8, "unlinkedKnowledgeTags": 0, "gaps": 0 },
    "changes": [{ "conversationId": "conv-1011", "beforeTags": ["forbidden", "wrong_knowledge"], "afterTags": ["forbidden", "wrong_knowledge"] }]
  }
}
```

规则：

- `publish` 仅允许 `draft` / `offline` → `published`，否则 409；
- `offline` 仅允许 `published` → `offline`，否则 409；
- `revisions` 仅允许 `published` / `offline` / `draft`（draft 上修订等于覆盖草稿，version 不增加）；为简化实现：draft 上修订直接替换当前版本并更新 `updatedAt`，不新增版本。已发布条目修订则 version + 1 并回到 draft。
- `recheck` 只更新未完成复核的 QcResult；已 done 的复核结果保持不变；
- `suggestions` 同一 `conversationId` / `badcaseId` 重复调用返回已有草稿（200，不新建）。

### 3.13 `GET /api/meta` 的 `statusLabels` 结构（v0.1.1 冻结）

`statusLabels` 为**按实体分组的嵌套对象**（不是扁平 map，避免 `closed` 等重名歧义），共 14 个状态键：

```json
{
  "statusLabels": {
    "badcase": { "open": "待处理", "in_progress": "处理中", "pending_verify": "待验证", "closed": "已闭环" },
    "alert": { "new": "待确认", "acknowledged": "已确认", "responding": "响应中", "escalated": "已升级", "resolved": "已解决" },
    "clue": { "draft": "草稿", "routed": "已分派", "accepted": "已受理", "rejected": "已拒绝", "closed": "已闭环" }
  }
}
```

前端渲染状态时必须通过该字典取中文文案；后端不得省略任何分组。

## 4. fixtures 与验证

- 样例返回：`specs/fixtures/*.json`（dashboard-summary、qc-detail、alert-detail、eval-run-qc）。
- 契约测试（QA）：启动 API 后校验所有端点 HTTP 200/4xx 语义、响应字段与 fixtures 对齐、非法状态转移返回 409。
- 前端类型：`apps/web/src/lib/api-types.ts` 由本契约手工映射（MVP），字段名必须一致。

## 5. 变更记录

| 版本 | 日期 | 变更 | 作者 |
|---|---|---|---|
| v0.1.0 | 2026-11-03 | 初版：27 个端点、通用约定、状态转移动作表、指标键 | Lead |
| v0.1.1 | 2026-11-03 | 契约裁决：复核终态 409、badcase SLA 按 category、statusLabels 嵌套结构、badcase title 可省略；补 §3.11 | Lead |
