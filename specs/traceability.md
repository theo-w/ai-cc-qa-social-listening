# SDD 追溯矩阵（Traceability Matrix）

> 版本：v0.1.0 ｜ 更新：2026-11-03
> 用途：证明「PRD 需求 → 功能规格 → API → UI → 测试」全链路无遗漏、无孤儿实现。
> 维护规则：新增需求/端点必须在本表登记；删除需求保留行并标记 deprecated。

---

## 1. PRD → FR → API → UI → 测试

### 1.1 质检与复核

| PRD | FR | 核心行为 | API | 页面/组件 | 测试 ID |
|---|---|---|---|---|---|
| PRD-QC-01 | FR-QC-004 | 6 标签 + 权重 + 评分规则 | `GET /api/meta` | 标签徽标、详情标签区 | TEST-QC-RULE-01..06 |
| PRD-QC-02 | FR-QC-003、FR-QC-010 | 证据回看、原文定位、脱敏 | `GET /api/qc/conversations/{id}` | 对话转写 + Evidence 高亮 | TEST-QC-EVID-01、TEST-MASK-01 |
| PRD-QC-03 | FR-QC-001 | 全量检测覆盖 | `GET /api/qc/stats` | 看板覆盖率 KPI、统计条 | TEST-QC-COV-01 |
| PRD-QC-04 | FR-QC-005 | 低置信度转人工复核 | `POST /api/qc/conversations/{id}/reviews` | 详情复核区三动作 | TEST-QC-REV-01..03 |
| PRD-QC-05 | FR-QC-002、FR-QC-009 | 列表筛选/排序/分页稳定 | `GET /api/qc/conversations` | 质检列表 + 筛选栏 | TEST-QC-LIST-01..03 |
| PRD-QC-06 | FR-BC-001 | 从质检创建 badcase、去重 | `POST /api/qc/conversations/{id}/badcases` | 创建模态 | TEST-BC-CREATE-01..02 |
| PRD-QC-07 | FR-BC-002 | 归因 + 责任人 + SLA | `GET /api/badcases/stats`、`/api/meta` | badcase 详情元信息 | TEST-BC-ROUTE-01 |
| PRD-QC-08 | FR-BC-003、FR-BC-006 | 状态机 + 闭环证明 + 时间线 | `POST /api/badcases/{id}/actions` | 详情抽屉动作区 | TEST-BC-SM-01..04 |
| PRD-QC-09 | FR-BC-004 | 复发标记（14 天/同坐席/同标签） | `GET /api/badcases`、详情 | 复发提示条 | TEST-BC-RECUR-01 |
| PRD-QC-10 | FR-BC-002、FR-QC-007 | 培训/知识库联动、复核留痕 | `GET /api/meta`、详情 | 详情建议区、About | TEST-TRACE-01 |
| PRD-QC-11 | FR-QC-006、FR-BC-005、FR-EVAL-001/002 | 验收指标：覆盖/准确/误报/闭环/复发 | `/api/qc/stats`、`/api/badcases/stats`、`/api/eval/*` | 看板 + 评测页 | TEST-EVAL-QC-01..03 |
| PRD-QC-12 | FR-QC-007 | 风险边界（不处罚/可申诉/复核留痕） | 复核记录字段 | About + 详情 | TEST-TRACE-01 |

### 1.1A 知识库与知识完善（009）

| PRD | FR | 核心行为 | API | 页面/组件 | 测试 ID |
|---|---|---|---|---|---|
| PRD-QC-10 | FR-KB-001 | 结构化知识条目、版本历史、状态机 | `/api/knowledge`、`/api/knowledge/{id}`、`/revisions` | 知识库列表/详情 | TEST-KB-01 |
| PRD-QC-01 | FR-KB-002 | 已发布事实驱动 wrong_knowledge 并附知识引用 | `/api/qc/conversations/{id}`、`GET /api/meta` | 质检详情知识依据卡 | TEST-KB-02 |
| PRD-QC-10 | FR-KB-003 | 未覆盖命中/知识类 badcase 进入缺口 | `/api/knowledge/gaps` | 知识库缺口面板 | TEST-KB-03 |
| PRD-QC-10 | FR-KB-004 | 从会话/badcase 生成知识草稿（幂等） | `POST /api/knowledge/suggestions` | 质检/badcase 详情按钮 | TEST-KB-04 |
| PRD-QC-10 | FR-KB-005 | 发布/下线自动复测，保护人工复核结论 | `/publish`、`/offline`、`/recheck` | 详情操作 + 复测结果 | TEST-KB-05 |
| PRD-QC-11 | FR-KB-006 | 知识统计、关联率、发布率、闭环率 | `/api/knowledge/stats`、`/api/meta` | 知识库统计条 | TEST-KB-06 |

### 1.2 舆情

| PRD | FR | 核心行为 | API | 页面/组件 | 测试 ID |
|---|---|---|---|---|---|
| PRD-SEN-01 | FR-SEN-001、FR-SEN-005 | 五类来源、情感与主题分析 | `/api/sentiment/comments`、`/api/meta` | 评论 Tab、来源筛选 | TEST-SEN-ANA-01 |
| PRD-SEN-02 | FR-SEN-001 | 主题聚类（12–16 簇） | `/api/sentiment/stats`、`/api/eval/runs` | 主题分布、评测页 | TEST-SEN-TOPIC-01 |
| PRD-SEN-03 | FR-SEN-002、FR-SEN-003 | 单条分级 + 聚簇升级 + 预警生成 | `/api/sentiment/alerts`、`/{id}` | 预警列表/详情 | TEST-SEN-ALERT-01..03 |
| PRD-SEN-04 | FR-SEN-004 | SOP 动作 + 首响 + SLA + 升级 | `POST /api/sentiment/alerts/{id}/actions` | 处置页行动区 | TEST-SEN-SOP-01..03 |
| PRD-SEN-05 | FR-SEN-007 | 预警转线索、品牌/市场联动 | `POST /api/clues`、`GET /api/clues` | 处置页「生成线索」 | TEST-SEN-CLUE-01 |
| PRD-SEN-06 | FR-SYS-001、FR-SYS-002 | 舆情趋势/来源/主题/响应时长看板 | `/api/dashboard/*`、`/api/sentiment/stats` | 看板 | TEST-DASH-01 |
| PRD-SEN-07 | FR-SEN-006、FR-EVAL-002 | 预警准确率、响应时长、升级率、重复舆情 | `/api/sentiment/stats`、`/api/eval/runs` | 评测页 + 看板 | TEST-EVAL-SEN-01..03 |
| PRD-SEN-08 | FR-SEN-004 | 边界：不自动对外、不替代公关、低置信人工确认 | 触发规则/复核字段 | About + 处置页提示 | TEST-BOUND-01 |

### 1.3 看板与线索

| PRD | FR | 核心行为 | API | 页面/组件 | 测试 ID |
|---|---|---|---|---|---|
| PRD-SYS-01 | FR-SYS-001、FR-SYS-002 | 统一指标口径与趋势 | `/api/dashboard/summary`、`/trends` | 总览 KPI + 折线 | TEST-DASH-01..02 |
| PRD-SYS-02 | FR-SYS-003 | 异常检测 + 下钻到 case/责任人 | `/api/dashboard/anomalies` + 路由 query | 异常条 + 列表筛选 | TEST-DRILL-01..02 |
| PRD-SYS-03 | FR-SYS-004 | 一键生成线索（四来源） | `POST /api/clues` | 新建线索模态、来源按钮 | TEST-CLUE-CREATE-01..02 |
| PRD-SYS-04 | FR-SYS-005 | 线索看板与闭环 | `/api/clues`、`/actions`、`/stats`（看板聚合） | 线索页表格/看板 | TEST-CLUE-SM-01..03 |

### 1.4 非功能

| PRD | FR/NFR | 验收方式 | 测试 ID |
|---|---|---|---|
| PRD-NFR-01 | FR-QC-010、NFR-003 | 脱敏断言（手机号/邮箱/身份证/订单号） | TEST-MASK-01 |
| PRD-NFR-02 | FR-QC-007、FR-BC-006、FR-SEN-004、NFR-002 | 时间线/审计字段完整性 | TEST-TRACE-01 |
| PRD-NFR-03 | FR-SEN-005、NFR-002 | 低置信度标记与复核占比 | TEST-QC-REV-01 |
| PRD-NFR-04 | NFR-004 | 成本面板为 0、无外部调用 | TEST-COST-01（代码审查：无 fetch 外呼） |
| PRD-NFR-05 | NFR-001、NFR-005 | 断网启动、页面 P95 | TEST-PERF-01（手工/脚本） |
| PRD-NFR-06 | FR-EVAL-001/002/003、NFR-006 | 评测集版本 + 确定性复跑 | TEST-EVAL-DET-01 |
| PRD-NFR-07 | FR-SYS-006、NFR-006 | reset 幂等与可复现 | TEST-RESET-01 |

---

## 2. API 覆盖核对（35 paths / 38 operations）

| API ID | 方法/路径 | FR | 测试 |
|---|---|---|---|
| API-META-01 | GET /api/health | 平台 | TEST-META-01 |
| API-META-02 | GET /api/meta | FR-QC-004/008、FR-SYS-007 | TEST-META-02 |
| API-META-03 | POST /api/admin/reset | FR-SYS-006 | TEST-RESET-01 |
| API-DASH-01 | GET /api/dashboard/summary | FR-SYS-001 | TEST-DASH-01 |
| API-DASH-02 | GET /api/dashboard/trends | FR-SYS-002 | TEST-DASH-02 |
| API-DASH-03 | GET /api/dashboard/anomalies | FR-SYS-003 | TEST-DRILL-01 |
| API-QC-01 | GET /api/qc/stats | FR-QC-006 | TEST-QC-STAT-01 |
| API-QC-02 | GET /api/qc/conversations | FR-QC-002 | TEST-QC-LIST-01 |
| API-QC-03 | GET /api/qc/conversations/{id} | FR-QC-003 | TEST-QC-DETAIL-01 |
| API-QC-04 | POST /api/qc/conversations/{id}/reviews | FR-QC-005 | TEST-QC-REV-01 |
| API-QC-05 | POST /api/qc/conversations/{id}/badcases | FR-BC-001 | TEST-BC-CREATE-01 |
| API-BC-01 | GET /api/badcases | FR-BC-005 | TEST-BC-LIST-01 |
| API-BC-02 | GET /api/badcases/stats | FR-BC-005 | TEST-BC-STAT-01 |
| API-BC-03 | GET /api/badcases/{id} | FR-BC-006 | TEST-BC-DETAIL-01 |
| API-BC-04 | POST /api/badcases/{id}/actions | FR-BC-003 | TEST-BC-SM-01 |
| API-SEN-01 | GET /api/sentiment/stats | FR-SEN-006 | TEST-SEN-STAT-01 |
| API-SEN-02 | GET /api/sentiment/comments | FR-SEN-005 | TEST-SEN-COMMENT-01 |
| API-SEN-03 | GET /api/sentiment/alerts | FR-SEN-003 | TEST-SEN-ALERT-01 |
| API-SEN-04 | GET /api/sentiment/alerts/{id} | FR-SEN-003 | TEST-SEN-ALERT-02 |
| API-SEN-05 | POST /api/sentiment/alerts/{id}/actions | FR-SEN-004 | TEST-SEN-SOP-01 |
| API-CLUE-01 | GET /api/clues | FR-SYS-005 | TEST-CLUE-LIST-01 |
| API-CLUE-02 | POST /api/clues | FR-SYS-004 | TEST-CLUE-CREATE-01 |
| API-CLUE-03 | GET /api/clues/{id} | FR-SYS-005 | TEST-CLUE-DETAIL-01 |
| API-CLUE-04 | POST /api/clues/{id}/actions | FR-SYS-004 | TEST-CLUE-SM-01 |
| API-EVAL-01 | GET /api/eval/datasets | FR-EVAL-001 | TEST-EVAL-DS-01 |
| API-EVAL-02 | GET /api/eval/runs | FR-EVAL-003 | TEST-EVAL-HIST-01 |
| API-EVAL-03 | POST /api/eval/runs | FR-EVAL-002 | TEST-EVAL-RUN-01 |
| API-EVAL-04 | GET /api/eval/runs/{id} | FR-EVAL-003 | TEST-EVAL-HIST-02 |
| API-KB-01 | GET /api/knowledge | FR-KB-001 | TEST-KB-01 |
| API-KB-02 | GET /api/knowledge/stats | FR-KB-006 | TEST-KB-06 |
| API-KB-03 | GET /api/knowledge/gaps | FR-KB-003 | TEST-KB-03 |
| API-KB-04 | GET /api/knowledge/{id} | FR-KB-001 | TEST-KB-01 |
| API-KB-05 | POST /api/knowledge | FR-KB-001 | TEST-KB-01 |
| API-KB-06 | POST /api/knowledge/{id}/revisions | FR-KB-001 | TEST-KB-01 |
| API-KB-07 | POST /api/knowledge/{id}/publish | FR-KB-005 | TEST-KB-05 |
| API-KB-08 | POST /api/knowledge/{id}/offline | FR-KB-005 | TEST-KB-05 |
| API-KB-09 | POST /api/knowledge/{id}/recheck | FR-KB-005 | TEST-KB-05 |
| API-KB-10 | POST /api/knowledge/suggestions | FR-KB-004 | TEST-KB-04 |

> 注：`/api/meta` 与 `/api/admin/reset` 属于 meta 域，但计入 path。paths 计数以 openapi 为准：health 1 + meta 1 + reset 1 + dashboard 3 + qc 5 + knowledge 9 + badcase 4 + sentiment 5 + clue 3 + eval 3 = 35 paths；其中 `/api/clues`、`/api/eval/runs`、`/api/knowledge` 各承载 2 个 operation，合计 38 operations。

---

## 3. UI 路由覆盖

| 路由 | 页面 | 覆盖 FR | 空态 | 错误态 |
|---|---|---|---|---|
| `/` | 运营总览 | FR-SYS-001/002/003、FR-SEN-006 | ✓ | ✓ |
| `/qc` | 质检工作台 | FR-QC-001/002 | ✓ | ✓ |
| `/qc/:id` | 质检详情 | FR-QC-003/004/005、FR-BC-001 | ✓ | ✓ |
| `/badcases` | badcase 闭环 | FR-BC-002..006 | ✓ | ✓ |
| `/sentiment` | 舆情预警/评论 | FR-SEN-001/002/003/005 | ✓ | ✓ |
| `/sentiment/alerts/:id` | 预警处置 | FR-SEN-004/007 | ✓ | ✓ |
| `/clues` | 线索传递 | FR-SYS-004/005 | ✓ | ✓ |
| `/eval` | 评测中心 | FR-EVAL-001/002/003 | ✓ | ✓ |
| `/knowledge` | 知识库 | FR-KB-001/003/006 | ✓ | ✓ |
| `/knowledge/:id` | 知识条目详情 | FR-KB-001/002/004/005 | ✓ | ✓ |
| `/about` | 关于与边界 | FR-SYS-007、边界声明 | — | — |

---

## 4. 反向孤儿检查

- 所有 `apps/api/src/routes/*` 的端点必须在上表出现，否则视为孤儿实现，删除或补需求。
- 所有 UI 页面必须至少覆盖 1 条 FR；无 FR 支撑的页面删除。
- 所有 FR 必须至少映射 1 个 API 或明确标注“纯展示/纯文档”。

---

## 5. 变更记录

| 版本 | 日期 | 变更 | 作者 |
|---|---|---|---|
| v0.1.0 | 2026-11-03 | 首版矩阵：PRD 31 条 → FR 37 条 → API 28 operation → UI 9 路由 | Lead |
