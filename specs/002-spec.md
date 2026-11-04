# SDD-002 功能规格说明（Spec）

> 版本：v0.1.0 ｜ 状态：已冻结（Baseline） ｜ 更新：2026-11-03
> 上游：`001-prd.md` ｜ 下游：`003-architecture.md`、`005-api-contract.md`、`008-tasks.md`
> 规则：需求 ID 一经冻结不复用；任何行为变更先改本文与 OpenAPI，再改代码。

---

## 1. 说明

本文把 PRD 中的业务需求翻译成**可测试的功能需求（FR）**与**非功能需求（NFR）**。每条 FR 必须携带：

- 关联 PRD 编号与优先级（P0 = MVP 必须，P1 = MVP 应有，P2 = 后续）；
- 验收场景（Given / When / Then），可直接转换为测试用例；
- 涉及 API 与页面，用于追溯。

**术语**：Conversation（对话）、QcResult（质检结果）、ReviewTask（人工复核任务）、Badcase（质检问题工单）、SentimentComment（舆情评论）、SentimentAlert（分级预警）、Clue（线索）。定义见 `004-data-model.md` 与 `000-charter.md` 术语表。

---

## 2. 需求总览

| 模块 | FR 数量 | P0 | P1 | 关联 PRD |
|---|---|---|---|---|
| 质检与复核 | 10 | 8 | 2 | PRD-QC-01..12 |
| 知识库与知识完善 | 6 | 4 | 2 | PRD-QC-10、PRD-QC-12 |
| badcase 闭环 | 6 | 5 | 1 | PRD-QC-06..10 |
| 舆情分析 | 4 | 4 | 0 | PRD-SEN-01..03 |
| 预警与响应 | 4 | 4 | 0 | PRD-SEN-04..05 |
| 看板与线索 | 7 | 5 | 2 | PRD-SYS-01..04、PRD-SEN-06 |
| 评测中心 | 3 | 3 | 0 | PRD-QC-11、PRD-SEN-07 |
| 平台能力 | 3 | 2 | 1 | PRD-NFR-01..07 |

页面路由与交互细节见 `006-ui-spec.md`；接口字段以 `contracts/openapi.yaml` 为唯一事实来源。

---

## 3. 质检模块

### FR-QC-001 全量自动质检（P0，PRD-QC-03）

系统在初始化/重置后，对数据集内**全部**对话执行质检：生成评分（0–100）、判定（pass/violation）、标签与证据、摘要、情绪、置信度、是否需复核。

**验收场景**

```gherkin
Scenario: 初始化即完成全量检测
  Given 数据集含 60 条对话
  When  API 启动并完成种子化
  Then  每条对话都存在且仅存在一条 QcResult
  And   每条 QcResult 的 evidence 引用的消息 seq 存在于该对话
  And   质检统计接口返回 analyzed = 60

Scenario: 违规判定必须有证据
  Given 任一 verdict=violation 的 QcResult
  Then  tags 非空
  And   每个 tag 至少包含 1 条 evidence（seq + quote 可在原文中定位）
```

### FR-QC-002 质检工作台列表与筛选（P0，PRD-QC-05）

提供分页列表，支持关键词（对话摘要/坐席/对话 ID）、判定、标签、复核状态、渠道筛选与排序。

**验收场景**

```gherkin
Scenario: 按标签下钻
  Given 已存在 attitude 标签的质检结果
  When  请求 GET /api/qc/conversations?tag=attitude&pageSize=20
  Then  返回项全部含 attitude 标签
  And    total 等于该标签的去重对话数
  And    响应时间 P95 < 300ms（本地数据集）

Scenario: 低置信度筛选
  When  请求 GET /api/qc/conversations?review=pending
  Then  返回项满足 needsReview = true
  And    每项均带 confidence 与 recommendedReason
```

### FR-QC-003 质检详情与证据回看（P0，PRD-QC-02）

详情页展示完整对话、AI 摘要、逐标签证据高亮、情绪轨迹、置信度与评分构成。

**验收场景**

```gherkin
Given 一条特定对话 ID
When  请求 GET /api/qc/conversations/{id}
Then  返回 conversation.messages 按 seq 升序
And   qcResult.tags[*].evidence 的 seq 均存在于 messages
And   响应包含 review（可能为 null）与 badcase（可能为 null）
```

### FR-QC-004 评分与标签规则（P0，PRD-QC-01）

标签体系与扣分权重固定：服务态度 attitude -25、违规话术 forbidden -30、答非所问 off_topic -15、知识错误 wrong_knowledge -25、响应超时 timeout -10、情绪升级 escalation -20。评分 = `clamp(100 + Σ权重, 0, 100)`；存在任一标签即 `violation`；置信度取标签置信度的加权结果与基础置信度，四舍五入保留 2 位。

**验收场景**

```gherkin
Scenario: 多标签扣分
  Given 同一对话命中 forbidden(-30) 与 escalation(-20)
  Then  score = 50
  And   verdict = violation
  And   tags 按 severity 降序、confidence 降序排列

Scenario: 分数下界
  Given 扣分总和超过 100
  Then  score = 0
```

> 规则实现位于 `apps/api/src/engine/`，规则 ID 与标签码表进入 `/api/meta`。

### FR-QC-005 低置信度人工复核（P0，PRD-QC-04）

`confidence < 0.75` 或命中规则冲突时 `needsReview=true`，进入复核队列。复核动作三选一：确认 confirm、推翻 overturn、修正 amend（可改标签集合）。

**验收场景**

```gherkin
Scenario: 确认复核
  Given 一条 needsReview=true 的 QcResult
  When  POST /api/qc/conversations/{id}/reviews {"decision":"confirm"}
  Then  返回 review.status = done 且 finalVerdict 与 AI 判定一致
  And   qcResult.needsReview 变为 false
  And   review 记录写入 reviewer、reviewedAt

Scenario: 推翻需改变判定
  When  decision = overturn
  Then  qcResult.verdict 取反，tags 清空，latestReviewId 指向本次复核

Scenario: 不可重复复核
  Given 已存在 done 状态复核
  When  再次提交复核
  Then  返回 409 CONFLICT
```

### FR-QC-006 质检统计（P0，PRD-QC-11）

统计返回总量、通过/违规、待复核/已复核数、平均分、复核占比、标签分布、渠道分布。

**验收场景**

```gherkin
Given 质检结果集合
When  请求 GET /api/qc/stats
Then  total = pass + violation
And   reviewRatio = needsReview / analyzed（保留 3 位小数）
And   标签分布计数之和 = 带标签的质检结果数（同一结果多标签重复计数，需在文档注明口径）
```

### FR-QC-007 质检复核记录可追溯（P1，PRD-QC-12、PRD-NFR-02）

复核记录不可删除、不可覆盖，保留 reviewer 与时间戳；质检结果保留 `modelVersion`。

```gherkin
Given 任意一条完成复核的记录
Then  详情接口可回看 baseline 判定、复核结论与差异
And   数据文件中保留 review 数组历史（最新一条为 current）
```

### FR-QC-008 标签码表与口径元数据（P0，PRD-QC-01）

`GET /api/meta` 返回标签码表（code/name/description/severity/weight）、渠道、来源、角色、负责人、目标主题、状态文案，前端不得硬编码中文枚举。

```gherkin
Given 前端渲染任一标签徽标
When  标签 code 未知
Then  前端降级显示 code 原文，不崩溃
```

### FR-QC-009 质检结果排序与稳定性（P1，PRD-QC-05）

支持 score_asc、score_desc、time_desc、time_asc；默认 time_desc；同等条件按 id 升序保证分页稳定。

```gherkin
Given 两页数据请求
When  使用相同排序与筛选
Then  第 1 页与第 2 页无重复、无遗漏
```

### FR-QC-010 数据脱敏展示（P0，PRD-NFR-01）

对话与评论中的手机号、邮箱、身份证、订单号在接口输出时脱敏；前端不展示原始明文。

```gherkin
Given 一条包含手机号 13812345678 的对话
When  请求质检详情
Then  customer 文本显示 138****5678
And   API 原始响应中不出现完整号码
```

---

## 4. badcase 闭环

### FR-BC-001 从质检结果创建 badcase（P0，PRD-QC-06）

创建参数：category（knowledge/script/process/system）、owner（默认按路由表）、slaHours（24/48/72，默认按 category）、title、rootCause。同一 conversationId 只允许存在一个未关闭 badcase。

```gherkin
Scenario: 创建成功
  Given 一条 violation 的对话
  When  POST /api/qc/conversations/{id}/badcases {"category":"knowledge"}
  Then  返回 badcase.code 形如 BC-2026-0001
  And   status = open，timeline 含 created 事件
  And   owner 默认为知识责任人

Scenario: 重复创建
  Given 该对话已有未关闭 badcase
  When  再次创建
  Then  返回 409 CONFLICT，error.details.badcaseId 指向已有记录
```

### FR-BC-002 归因与责任人/SLA 路由（P0，PRD-QC-07）

按 category 路由责任人：knowledge→顾清、script/training→唐沐、process→陆川、system→周野；SLA：knowledge/script 48h、process 24h、system 72h；`dueAt = createdAt + slaHours`。

```gherkin
Given category = process
Then  owner = 陆川 且 slaHours = 24
And   列表 overdue 字段在 now > dueAt 且未关闭时为 true
```

### FR-BC-003 状态机动作（P0，PRD-QC-08）

合法动作：assign、progress、verify、close、reopen、comment。转移：
`open→in_progress→pending_verify→closed`；`closed→in_progress`（reopen，复发）。非法转移返回 409。

```gherkin
Scenario: 非法跳跃
  Given 状态 = open
  When  执行 close
  Then  返回 409 CONFLICT（必须经过处理与验证）

Scenario: 关闭必须提交证明
  Given 状态 = pending_verify
  When  close 且 proof 为空
  Then  返回 422 VALIDATION_ERROR
  When  close 且 proof 非空
  Then  status = closed、closedAt 写入、timeline 追加 closed
```

### FR-BC-004 复发标记（P0，PRD-QC-09）

创建/重开时，若同一坐席在 14 天内已有同 primaryTag 的 closed badcase，则 `recurrence=true, recurrenceOf=该记录 id`；列表与详情显著展示。

```gherkin
Given 坐席 A 在 2026-10-25 有已关闭 knowledge badcase
When  2026-11-02 为坐席 A 新建 knowledge badcase
Then  recurrence = true 且 recurrenceOf 指向首条记录
```

### FR-BC-005 badcase 列表与统计（P0，PRD-QC-11）

支持状态、类别、负责人、关键词筛选；统计返回各状态计数、超期数、闭环率（closed/total）、复发率（recurrence/total）、按类别与负责人分布。

```gherkin
Given badcase 集合
Then  closeRate = closed / total（0 条时为 0）
And   统计口径与 /api/dashboard/summary 中 badcaseCloseRate 一致
```

### FR-BC-006 badcase 详情与时间线（P1，PRD-QC-08、PRD-NFR-02）

详情返回关联对话摘要、证据、完整 timeline（操作人/动作/备注/时间），前端按时间正序渲染。

```gherkin
Given 任意 badcase
Then  timeline[0].type = created
And   每个动作的 at 单调不减
```

---

## 4A. 知识库与知识完善（新增，详见 `009-knowledge-base.md`）

### FR-KB-001 知识条目与版本（P0，PRD-QC-10）

系统提供结构化知识条目：标题、分类、标准口径、结构化事实、关键词、来源、责任人与版本历史。条目状态为 `draft / published / offline`，每次修订生成新版本并保留旧版本快照。

**验收场景**

```gherkin
Scenario: 查询知识条目
  Given 已发布 KB-1001（退款手续费 0%）
  When  请求 GET /api/knowledge
  Then  返回条目含 code/title/category/status/version/facts/revisions
  And   仅 published 条目参与质检

Scenario: 修订生成新版本
  Given 已发布条目 version = 1
  When  POST /api/knowledge/{id}/revisions 提交新口径
  Then  version = 2 且 status = draft
  And   revisions 保留 v1 快照
```

### FR-KB-002 事实校验驱动知识错误（P0，PRD-QC-01）

已发布条目的结构化事实参与 `wrong_knowledge` 判定：数值 / 时效 / 日期 / 文本口径与坐席陈述冲突即命中；命中的 `QcTag` 必须带 `knowledge` 引用（条目、事实、标准值、实际值）。

**验收场景**

```gherkin
Scenario: 知识依据可解释
  Given 已发布 KB-1001（退款手续费 0%）
  And   会话中坐席称「退款手续费是 20%」
  When  查询质检详情
  Then  wrong_knowledge 标签 knowledge.expected = "0%（不收取手续费）"
  And   knowledge.actual 包含 "20%"
  And   knowledge.code = "KB-1001"

Scenario: 知识库优先于旧兜底规则
  Given 旧规则命中某说法，但已发布事实判定该说法合规
  When  执行复测
  Then  该 wrong_knowledge 标签被移除
```

### FR-KB-003 知识缺口（P0，PRD-QC-10）

未被已发布事实覆盖的知识错误命中、未关联任何条目的知识类 badcase，必须进入知识缺口列表；缺口按规则/案例聚合，附样例证据与出现次数。

**验收场景**

```gherkin
Given 一条 wrong_knowledge 标签的 knowledge = null
When  请求 GET /api/knowledge/gaps
Then  该命中以 ruleId 分组出现在 gaps 中
And   附 sample.conversationId / seq / quote
```

### FR-KB-004 质检与 badcase 生成草稿（P0，PRD-QC-10）

支持从知识缺口会话或知识类 badcase 一键生成知识草稿（`status=draft`、`source=qc_badcase`、`sourceRef` 指向来源）；同一来源重复生成返回已有草稿（幂等）。

**验收场景**

```gherkin
Given 会话 conv-1018 命中知识错误且未被条目覆盖
When  POST /api/knowledge/suggestions {"conversationId":"conv-1018"}
Then  返回一条 draft 条目，source = qc_badcase
And   sourceRef.id = "conv-1018"
And   再次提交同一请求返回同一条目
```

### FR-KB-005 发布 / 下线与复测（P0，PRD-QC-10）

发布或下线条目后自动复测：对未完成人工复核的会话重新执行质检，更新 QcResult 与待复核队列；返回前后知识命中、关联率与缺口变化。人工已复核结论不得被覆盖。

**验收场景**

```gherkin
Given 一条 draft 条目补齐了事实与识别规则
When  POST /api/knowledge/{id}/publish
Then  status = published
And   response.recheck.changed >= 0
And   response.recheck.before/after 含 knowledgeTags/linked/unlinked/gaps
And   已 done 的复核结果保持不变
```

### FR-KB-006 知识统计与元数据（P1，PRD-QC-11）

提供条目总数、发布/草稿/下线数、分类分布、知识错误关联率、缺口数与知识类 badcase 闭环率；`/api/meta` 提供分类、状态、来源与比对方式字典。

**验收场景**

```gherkin
When  请求 GET /api/knowledge/stats
Then  返回 total/published/draft/offline/byCategory/hits/gaps
And   hits.linked + hits.unlinked = hits.knowledgeTags
```

---

## 5. 舆情模块

### FR-SEN-001 评论导入与情感/主题分析（P0，PRD-SEN-01、02）

120 条评论全部完成情感（positive/neutral/negative，score −1..1）、主题（1–3 个，primaryTopic 唯一）、置信度分析；低置信度标记 needsReview。

```gherkin
Given 舆情数据集
When  完成初始化
Then  每条评论都有 sentiment、sentimentScore、topics、primaryTopic、confidence
And   所有 primaryTopic 属于 /api/meta 中的 topics 列表
```

### FR-SEN-002 单条分级与聚簇升级（P0，PRD-SEN-03）

单条分级按主题高危度与信号词判定 P0/P1/P2/none；再按 `(topic, date)` 聚簇：负面 ≥8 → P0，3–7 → ≥P1，1–2 → ≥P2；簇内级别取 max(单条级别, 聚合级别)。簇按级别生成预警。

```gherkin
Scenario: 聚簇升级
  Given 2026-11-01 的“回档”主题有 9 条负面评论且单条均为 P2
  Then  生成 1 条 P0 预警，commentIds 覆盖该簇全部评论
  And   triggerRules 含 aggregate_escalation_p0

Scenario: 不重复预警
  Given 同一 (topic, date) 已生成预警
  When  重建数据
  Then  该簇预警数量仍为 1
```

### FR-SEN-003 预警列表与详情（P0，PRD-SEN-03、04）

列表支持级别、状态、关键词筛选，展示 owner、SLA 截止、是否超期；详情返回预警、触发规则、评论证据、关联线索、时间线。

**责任人口径（v0.1.1 冻结）**：预警 `owner` 为单一责任人字符串——P0 主责为江岚（品牌），陆川（主管）与周野（产研）为通知范围；P1/P2 按 004 §4.5 主题路由（外挂/充值→江岚，版本/Bug→周野，客服/活动/其他→陆川）。

```gherkin
Given 存在 P0 预警
When  请求预警列表按 level=P0
Then  所有项 slaMinutes = 30 且 owner 含品牌责任人
And   详情 comments 数量 = commentIds 长度
```

### FR-SEN-004 预警响应 SOP 动作（P0，PRD-SEN-04）

动作：acknowledge、respond、escalate、resolve、comment。`new→acknowledged→responding→resolved`，可 `escalated` 旁路；首次 acknowledge/respond 写入 firstResponseAt 并用于响应时长统计。

```gherkin
Scenario: 超时判定
  Given P1 预警 slaDueAt 已过且 firstResponseAt 为空
  Then  列表 overdue = true
  And   statistics 中 p1ResponseMin 不计该未响应记录

Scenario: 解决需结论
  When  resolve 且 note 为空
  Then  返回 422 VALIDATION_ERROR
```

### FR-SEN-005 评论检索与低置信度复核（P0，PRD-SEN-01、PRD-NFR-03）

支持关键词、来源、情感、主题、级别筛选与分页；低置信度评论在评测页展示并计入复核占比。

```gherkin
Given 来源 = steam 的评论
When  请求 /api/sentiment/comments?source=steam
Then  返回项 source 均为 steam，total 与数据集一致
```

### FR-SEN-006 舆情统计（P0，PRD-SEN-06、07）

返回评论数、分析数、负面占比、待复核数、预警总数/未关闭数、P0/P1/P2 计数、平均首响、P0/P1 首响、主题/来源/情感分布。

```gherkin
Given 预警集合
Then  p0ResponseMin = P0 已首响记录的平均 (firstResponseAt - createdAt) 分钟数
And   无样本时返回 null 而非 0
```

### FR-SEN-007 预警转线索（P0，PRD-SEN-05）

预警详情支持一键创建线索：sourceType=sentiment、sourceRef 指向预警、target 默认 brand，可改 market/product；创建后预警 linkedClueIds 追加。

```gherkin
Given P0 预警
When  一键生成线索 target=market
Then  返回 clue.status = draft
And   预警 linkedClueIds 包含新线索 id
And   重复生成同一目标返回 409
```

---

## 6. 看板与线索

### FR-SYS-001 统一 KPI 看板（P0，PRD-SYS-01）

看板返回 7 张 KPI 卡：质检覆盖率、质检准确率、badcase 闭环率、P0 首响、预警准确率、线索闭环率、满意度；每张卡含 value、target、比较符 op、status（ok/warn/bad）、delta、单位。

```gherkin
Given 演示数据
When  请求 /api/dashboard/summary?range=7d
Then  返回 7 个 kpi，id 唯一
And   每个 kpi 的 status 由 value 与 target 按 op 计算
And   质检覆盖率 value ≥ 0.90
```

### FR-SYS-002 趋势数据（P0，PRD-SYS-01）

按天返回近 7/14/30 天的质检覆盖率、准确率、闭环率、P0 首响、预警准确率、线索闭环率、满意度趋势。

```gherkin
Given range=7d
Then  rows.length = 7 且日期连续升序
And   缺失数据点为 null 而非 0
```

### FR-SYS-003 异常检测与下钻（P0，PRD-SYS-02）

对未达标 KPI 生成异常卡：指标、当前值、目标值、偏差、严重度、钻取类型与筛选条件、建议责任人。前端点击下钻跳转对应列表并自动应用筛选。

```gherkin
Given badcase 闭环率 < 0.70
Then  anomalies 包含 metric=badcaseCloseRate、drillType=badcase、drillFilter.status=open
When  前端点击该异常
Then  跳转 /badcases 且列表筛选状态为 open
```

### FR-SYS-004 线索创建（P0，PRD-SYS-03）

线索由质检、舆情、看板异常或人工创建；必填 title/description/sourceType/sourceRef/target/priority；状态 draft→routed→accepted/rejected→closed；关闭需 outcome。

```gherkin
Given 来源为 badcase
When  创建 target=product 的线索
Then  owner 路由为产研负责人周野
And   状态机非法转移返回 409
And   closed 前必须 accepted 或 rejected
```

### FR-SYS-005 线索列表与看板（P0，PRD-SYS-04）

支持状态、目标、来源、关键词筛选；看板展示线索总数、各状态、闭环率与目标分布，并提供 30 秒内可完成的创建入口。

```gherkin
Given 线索集合
Then  clueCloseRate = closed / total（total=0 返回 0）
And   列表项展示来源标签、目标、责任人、状态与更新时间
```

### FR-SYS-006 演示态重置（P0，PRD-NFR-07）

`POST /api/admin/reset` 清空运行态、按 data/ 重新种子并返回计数；重置后所有页面数据一致且可复现。

```gherkin
Given 已执行若干写操作
When  调用重置
Then  返回 seeded 计数与 resetAt
And   再次请求列表，数据与首次初始化一致（确定性）
```

### FR-SYS-007 元数据与字典（P0，PRD-QC-01）

`/api/meta` 提供角色、负责人、标签、主题、来源、目标、状态文案与演示信息，前端所有中文枚举从此读取。

```gherkin
Given 前端启动
When  加载 /api/meta
Then  侧边栏与筛选器渲染中文标签而不是 code
```

---

## 7. 评测中心

### FR-EVAL-001 数据集注册与展示（P0，PRD-QC-11、PRD-NFR-06）

返回 qc 与 sentiment 两个评测集：dsId、version、itemCount、说明、最近运行时间与是否达标。

```gherkin
Given 评测集已随 data/ 提供
Then  /api/eval/datasets 返回 2 个数据集
And   每个数据集含 itemCount 与 version
```

### FR-EVAL-002 运行评测（P0，PRD-QC-11、PRD-SEN-07）

`POST /api/eval/runs {"dataset":"qc"}` 对评测集逐条执行引擎并比对金标，返回指标、混淆矩阵、错例列表（最多 20 条）、门禁达标映射、总结；运行记录持久化。

```gherkin
Scenario: 质检评测
  Given qc 评测集 60 条金标
  When  运行评测
  Then  metrics 含 accuracy、falsePositiveRate、reviewRatio 等
  And   metrics.accuracy ≥ 0.80
  And   mismatches 每项含 itemId/expected/predicted/reason

Scenario: 舆情评测
  Given sentiment 评测集 120 条
  When  运行评测
  Then  metrics 含 sentimentAccuracy、topicAccuracy、alertPrecision
  And   alertPrecision 按 (topic,date) 簇匹配计算
```

### FR-EVAL-003 评测历史与门禁（P1，PRD-NFR-06）

评测历史按时间倒序返回，展示指标与门禁徽标；相同数据集重复运行结果确定（除 runAt/durationMs/id）。

```gherkin
Given 两次运行同一数据集
Then  metrics 与 confusion 完全一致
And   thresholdsMet 一致
```

---

## 8. 非功能需求

| ID | 类别 | 需求 | 验收 | 优先级 |
|---|---|---|---|---|
| NFR-001 | 性能 | 单页列表接口本地 P95 < 300ms；首屏可交互 < 2s | 手动计时 + 简单基准脚本 | P0 |
| NFR-002 | 可追溯 | 所有写操作留时间线/审计字段（by、at、from、to） | 详情时间线完整、不可覆盖 | P0 |
| NFR-003 | 隐私 | 手机号/邮箱/身份证/订单号脱敏 | 响应断言不含完整号码 | P0 |
| NFR-004 | 成本 | 演示态零外部 AI 调用；token 成本面板显示 0 与本地调用次数 | /api/meta + 关于页说明 | P0 |
| NFR-005 | 离线 | 无网络可启动、构建、演示 | 断网验证 | P0 |
| NFR-006 | 可复现 | 同一 data/ 版本 + 同一引擎版本 → 相同质检/预警结果 | 连续两次 reset 后比对 | P0 |
| NFR-007 | 可访问性 | 键盘可达、对比度 ≥ 4.5:1、焦点可见 | 手动走查 + axe（可选） | P1 |
| NFR-008 | 响应式 | ≥1280px 完整体验；1024–1279px 可用；移动端不承诺 | 视口检查 | P1 |
| NFR-009 | 可维护 | TypeScript strict、契约类型一致、无 any 泄漏 | `pnpm typecheck` 通过 | P0 |
| NFR-010 | 安全边界 | 无鉴权（演示态），仅监听 127.0.0.1；不写外部系统 | 启动日志与配置检查 | P0 |

---

## 9. 业务规则（BR）

| ID | 规则 | 影响 |
|---|---|---|
| BR-01 | 评分 `clamp(100 + Σ权重, 0, 100)` | 质检 |
| BR-02 | 有标签即 violation；无标签即 pass | 质检 |
| BR-03 | `confidence < 0.75` 必进复核队列 | 质检/复核 |
| BR-04 | 一个对话最多一个未关闭 badcase | badcase |
| BR-05 | close 必须 proof；reopen 必须 note | badcase |
| BR-06 | 复发窗口 = 14 天、同坐席 + 同 primaryTag | badcase |
| BR-07 | 聚合升级阈值：负面 ≥8→P0、3–7→≥P1、1–2→≥P2 | 舆情 |
| BR-08 | SLA：P0 30min、P1 2h、P2 24h；badcase 按 category 24/48/72h | 舆情/闭环 |
| BR-09 | 线索关闭前必须 accepted/rejected | 线索 |
| BR-10 | 所有统计 ratio 分母为 0 时返回 0（响应时长类返回 null） | 全局 |

---

## 10. 边界与异常处理

1. **数据缺失**：数据集为空时接口返回空列表与 0 值，不报 500；`/api/eval/runs` 在无金标时报 422。
2. **非法状态转移**：统一返回 409 并给出现状与目标动作。
3. **参数校验**：query/body 用 zod 校验，非法枚举返回 422，`error.details.field` 指明字段。
4. **重复操作**：复核、重复 badcase、重复线索、重复预警均幂等或 409 二选一，以契约与测试为准。
5. **不做什么**：不自动对外发布、不自动处罚、不做真实爬虫、不接真实 LLM；相关入口只展示“人工确认”文案。

---

## 11. 需求追踪

- PRD → FR 映射：见 `traceability.md`。
- FR → API：见 `005-api-contract.md` 与 OpenAPI `operationId`。
- FR → UI：见 `006-ui-spec.md` 页面清单。
- FR → 测试：见 `008-tasks.md` 任务卡与 QA 测试清单。

## 12. 变更记录

| 版本 | 日期 | 变更 | 作者 |
|---|---|---|---|
| v0.1.0 | 2026-11-03 | 首版冻结，覆盖三模块 MVP 全部 P0 需求 | Lead |
| v0.1.1 | 2026-11-03 | 明确预警 owner 口径（P0 江岚主责，P1/P2 主题路由） | Lead |
