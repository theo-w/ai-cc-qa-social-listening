# 指标字典（Metric Dictionary）

> 适用：QCC Workbench MVP 评测中心、看板、趋势图与演示报告。**所有页面与报告使用同一口径**，否则数字不可比。
> 事实来源：`specs/007-evaluation-spec.md` §4/§5/§7（评测指标与门禁）、`specs/005-api-contract.md` §3.9/§3.10（接口字段与指标键）、`specs/002-spec.md` FR-BC-005/FR-SEN-006/FR-SYS-001~005（统计口径）、`specs/004-data-model.md` §3.11（MetricSnapshot 字段）。
> 命名规则：文档用 007 的 `MET-*` 编号；接口/前端用 005 的 metric key（camelCase）；展示用中文名。

## 1. 指标键对照表

| 007 编号 | 005 指标键（`EvalRun.metrics`） | 看板 KPI id | 中文名 | 口径归属 |
|---|---|---|---|---|
| MET-QC-COV | `coverage` | `qcCoverage` | 质检覆盖率 | 007 §4 |
| MET-QC-ACC | `accuracy` | `qcAccuracy` | 质检准确率（主指标） | 007 §4 |
| MET-QC-VACC | `verdictAccuracy` | — | 结论准确率 | 007 §4 |
| MET-QC-FP | `falsePositiveRate` | — | 误报率 | 007 §4 |
| MET-QC-FN | `falseNegativeRate` | — | 漏报率 | 007 §4 |
| MET-QC-REV | `reviewRatio` | `qcReviewRatio` | 人工复核占比 | 007 §4 |
| MET-QC-LAT | `avgLatencyMs` | — | 单条检测耗时 | 007 §4 |
| MET-QC-TAGP | `tagPrecision` | — | 标签精确率（分标签） | 007 §4 |
| MET-SEN-SA | `sentimentAccuracy` | — | 情感分类准确率 | 007 §5 |
| MET-SEN-TA | `topicAccuracy` | — | 主题分类准确率 | 007 §5 |
| MET-SEN-AP | `alertPrecision` | `alertPrecision` | 预警准确率 | 007 §5 |
| MET-SEN-AR | `alertRecall` | — | 预警召回率 | 007 §5 |
| MET-SEN-P0R | `p0Recall` | — | P0 召回率 | 007 §5 |
| MET-SEN-REV | `reviewRatio` | — | 舆情复核占比 | 007 §5 |

> 同一 `EvalRun` 内 qc 与 sentiment 各有一组 metrics；`reviewRatio` 在两种数据集下语义相同（needsReview 条数 / N）。

## 2. 质检指标（MET-QC-*）

记评测集 N 条，`gt` 为标注（`data/qc/dataset.json` 的 `labels`），`pred` 为引擎输出。

| 指标 | 公式 | 目标 | 判定/说明 |
|---|---|---|---|
| MET-QC-COV 覆盖率 | 已检测对话数 / 导入对话数 | ≥ 90% | 种子数据引擎全量处理 = 100%；生产按导入批次统计 |
| MET-QC-ACC 准确率 | 判定一致条数 / N | **≥ 80%** | 判定一致 = `verdict` 相同 **且**（`pass`，或 `primaryTag` 相同）；违规但主标签不同 = 不一致 |
| MET-QC-VACC 结论准确率 | `verdict` 相同条数 / N | 展示用 | 辅助区分「标签错」与「结论错」 |
| MET-QC-FP 误报率 | 正常判违规条数 / 预测违规总条数 | **≤ 15%** | 分母为 0 时记 0 |
| MET-QC-FN 漏报率 | 违规未判出条数 / 标注违规总条数 | **≤ 20%** | 分母为 0 时记 0 |
| MET-QC-REV 复核占比 | needsReview 条数 / N | ≤ 30% | 演示目标 15%–30%；当前数据集 13/60 = **21.7%** |
| MET-QC-LAT 单条耗时 | 总耗时 / N（ms） | < 50ms（本地） | 评测报告展示 |
| MET-QC-TAGP 标签精确率 | 分标签：预测该标签中正确条数 / 预测该标签条数 | 展示用 | 对象结构 `{ "attitude": 0.9, ... }`，用于错例分析 |

**混淆矩阵（四格）**：`tp` 违规判违规、`fp` 正常判违规、`tn` 正常判正常、`fn` 违规判正常。**通过标准**：MET-QC-ACC、MET-QC-FP、MET-QC-FN 三项同时达标（G-EVAL-1）。

**计算示例（假设一次 run，仅演示算法）**：N=60，正常 20 / 违规 40；预测正常判违规 2 条（fp），违规漏判 3 条（fn），违规主标签判对 34 条：

| 指标 | 演算 | 结果 |
|---|---|---|
| accuracy | (18 + 34) / 60 | 0.8667 → 86.7% ✅ |
| verdictAccuracy | (18 + 37) / 60 | 0.9167 → 91.7% |
| falsePositiveRate | 2 / (2 + 37) | 0.0513 → 5.1% ✅ |
| falseNegativeRate | 3 / 40 | 0.075 → 7.5% ✅ |
| reviewRatio | 13 / 60 | 0.2167 → 21.7% ✅ |

## 3. 舆情指标（MET-SEN-*）

记评测集 N 条（`data/sentiment/dataset.json`，N=120）。

| 指标 | 公式 | 目标 | 说明 |
|---|---|---|---|
| MET-SEN-SA 情感准确率 | `sentiment` 相同条数 / N | ≥ 80% | 三分类 positive/neutral/negative |
| MET-SEN-TA 主题准确率 | `primaryTopic` 相同条数 / N | ≥ 75% | 只看主主题，不看 topics 集合 |
| MET-SEN-AP 预警准确率 | 预测预警中级别与期望一致数 / 预测预警总数 | ≥ 80% | 预警按簇级别，匹配键 `(topic, date)` |
| MET-SEN-AR 预警召回率 | 级别与期望一致的预警数 / 期望预警总数 | ≥ 80%（展示） | 期望预警 = 期望簇级别 ∈ {P0,P1,P2} |
| MET-SEN-P0R P0 召回率 | 命中 P0 预警数 / 期望 P0 预警数 | ≥ 90%（展示） | 分母为 0 时记 0 |
| MET-SEN-REV 舆情复核占比 | needsReview 评论数 / N | 展示（目标 ≤ 30%） | 低置信度转人工 |

**预警回放口径（007 §5，关键）**：

1. 按 `primaryTopic + publishedAt 日期` 将评论聚合成簇（引擎预测主题用于回放，期望簇用标注主题）。
2. 单条级别由标注 `expectedLevel`（期望）或引擎 `severity`（预测）得出，规则见 007 §6.1。
3. 簇级别 = `max(单条最大级别, 聚合升级级别)`；聚合升级：负面 ≥ 8 → P0、3–7 → 至少 P1、1–2 → 至少 P2。
4. 期望预警集合 = 期望簇级别 ∈ {P0,P1,P2} 的簇；预测预警集合同理。
5. 匹配键 `(topic, date)`：匹配上且级别相同 = true positive；预测有期望无 = false positive；期望有预测无 = false negative。

**当前数据集金标规模（用于回放对账）**：16 簇 = P0 3 / P1 6 / P2 4 / none 3，即期望预警 13 条；单条级别 P0 8 / P1 12 / P2 42 / none 58；其中 1 个 P0 簇由聚合升级产生（充值 · 2026-11-01）。

**计算示例（假设一次 run）**：预测预警 12 条，级别与期望一致 10 条，期望预警 13 条，期望 P0 3 条且全部命中：

| 指标 | 演算 | 结果 |
|---|---|---|
| alertPrecision | 10 / 12 | 0.8333 → 83.3% ✅ |
| alertRecall | 10 / 13 | 0.7692 → 76.9% |
| p0Recall | 3 / 3 | 100% |

## 4. 看板与趋势指标

### 4.1 看板 7 张 KPI 卡（005 §3.10、002 FR-SYS-001）

| KPI id | 中文名 | 公式/口径 | 目标 |
|---|---|---|---|
| `qcCoverage` | 质检覆盖率 | 已检测会话 / 导入会话 | ≥ 0.90 |
| `qcAccuracy` | 质检准确率 | 同 MET-QC-ACC（看板取实时状态或最近 run） | ≥ 0.80 |
| `badcaseCloseRate` | badcase 闭环率 | `closed / total`（total=0 返回 0，002 FR-BC-005） | ≥ 0.70 |
| `p0ResponseMin` | P0 首响（分钟） | P0 已首响应记录的平均 `firstResponseAt - createdAt` 分钟数（002 FR-SEN-006） | ≤ 30 |
| `alertPrecision` | 舆情预警准确率 | 同 MET-SEN-AP | ≥ 0.80 |
| `clueCloseRate` | 线索闭环率 | `closed / total`（total=0 返回 0，002 FR-SYS-005） | ≥ 0.60 |
| `csat` | 满意度 | 会话满意度评价均值，归一化 0–1（演示数据由指标快照生成） | ≥ 0.85 |

每张卡包含 `value`（存储为 0–1 小数）、`target`、`op`（`>=` / `<=`）、`status`（`ok/warn/bad`）、`delta`、`unit`、`hint`；**展示时 `value × 100` 加 `%`，接口/存储层不要预先乘 100**。

### 4.2 趋势与异常

- `GET /api/dashboard/trends` 行字段：`date`、`qcCoverage`、`qcAccuracy`、`badcaseCloseRate`、`p0ResponseMin`、`alertPrecision`、`clueCloseRate`、`csat`；缺失数据点为 `null`（不得填 0，002 FR-SYS-002）。
- `GET /api/dashboard/anomalies`：对未达标 KPI 生成 `{ metric, metricLabel, current, target, deviation, severity, drillType, drillFilter, owner, suggestion }`；`drillType ∈ qc|sentiment|badcase|clue`，下钻筛选与列表一致（002 FR-SYS-003）。

### 4.3 运营指标（MetricSnapshot，004 §3.11）

| 字段 | 中文名 | 口径 |
|---|---|---|
| `qcCoverage` / `qcAccuracy` / `qcReviewRatio` | 质检覆盖率/准确率/复核占比 | 同 MET-QC-COV / ACC / REV |
| `badcaseCloseRate` / `recurrenceRate` | badcase 闭环率/复发率 | `closed/total`；`recurrence/total`（002 FR-BC-005） |
| `p0ResponseMin` / `p1ResponseMin` | P0/P1 首响（分钟） | 已首响记录均值；未响应记录不计入（002 FR-SEN-004） |
| `alertPrecision` / `sentimentAccuracy` | 预警准确率/情感准确率 | 同 MET-SEN-AP / SA |
| `clueCloseRate` / `clueConversion` | 线索闭环率/转化率 | 闭环率 `closed/total`；转化率建议 `accepted/total`（线索看板口径，PRD-SYS-04） |
| `csat` / `firstResponseSec` / `transferRate` | 满意度/首响秒/转人工率 | 会话评价均值；坐席首次响应秒数均值；转人工会话/总会话（演示指标） |

## 5. 计算与展示约束

1. 比例统一存 0–1 小数，保留 2 位小数（`0.8667`）；页面展示乘 100 加 `%`；分钟数保留整数或 1 位小数。
2. 分母为 0：007 明确 FP/FN 在分母为 0 时记 0；响应时长类无样本返回 `null`（002 FR-SEN-006），不得返回 0。
3. 评测可重复：同数据集 + 同引擎版本连续两次 run 指标必须完全一致（G-EVAL-4）；`EvalRun` 记录 `datasetVersion`、`modelVersion`、`runAt`、`durationMs`、`mismatches`（最多 20 条，含 `expected/predicted/reason`）。
4. 判定单位：质检按整条对话判「准确」；舆情 SA/TA 按单条评论；预警指标按簇。三者不可混用。
5. 舆情回放优先用金标 `expectedLevel` 对账；引擎侧 `severity` 仅作预测值，不得用于期望值。
6. 看板当前值优先由实时状态计算，`MetricSnapshot` 仅用于趋势展示（004 §6）；前端不得二次计算指标。

## 6. 发布门禁（007 §7）

| 门禁 | 条件 | 不通过处理 |
|---|---|---|
| G-EVAL-1 | QC `accuracy ≥ 0.80` 且 `falsePositiveRate ≤ 0.15` 且 `falseNegativeRate ≤ 0.20` | 调规则或标注，重跑；不得静默发布 |
| G-EVAL-2 | 舆情 `sentimentAccuracy ≥ 0.80` 且 `topicAccuracy ≥ 0.75` 且 `alertPrecision ≥ 0.80` | 同上 |
| G-EVAL-3 | `reviewRatio ≤ 0.30` | 调整置信度阈值 |
| G-EVAL-4 | 同数据同版本连续两次 run 指标一致 | 修复引擎随机性 |
| G-EVAL-5 | 错例清单 ≤ 20 条且含 expected/predicted/reason | 补错例分析 |

发布声明必须附：`datasetVersion`、`modelVersion`、run 时间、指标表、达标结论；未达标需写明原因与下一步。

## 7. 指标责任人

| 指标域 | 口径负责人 | 展示位置 |
|---|---|---|
| 质检评测（MET-QC-*） | 沈言（质检组长）+ 周野（引擎） | `/eval` 页面、评测报告 |
| 舆情评测（MET-SEN-*） | 江岚（品牌）+ 周野（引擎） | `/eval` 页面、预警看板 |
| 看板 KPI 与趋势 | 陆川（客服主管） | `/` 看板、趋势图 |
| badcase/线索闭环 | 各默认责任人 + 陆川汇总 | `/badcases`、`/clues` |

## 8. 常见口径错误

| 错误 | 影响 | 正确做法 |
|---|---|---|
| 把「标签全对」当准确率 | 指标虚高 | 按 007：verdict 相同且（pass 或 primaryTag 相同）才计一致 |
| 用单条级别判断预警 | 漏掉聚合升级 P0 | 簇级别 = max(单条, 聚合) |
| 分母为 0 填 0 或 100% | 趋势图异常 | 比例记 0，时长类返回 null |
| 接口返回百分数（如 86.7） | 看板重复乘 100 | 接口存 0–1 小数，展示层转换 |
| 舆情用预测主题聚簇对账期望 | 指标不可复现 | 期望簇用标注 `primaryTopic`，预测回放用引擎主题 |
| 跨 run 比较不记录版本 | 数字不可比 | 报告附 datasetVersion/modelVersion/runAt |

## 9. 变更记录

| 版本 | 日期 | 变更 | 作者 |
|---|---|---|---|
| v0.1.0 | 2026-11-03 | 初版：对齐 007 指标公式、005 指标键、002 统计口径、004 MetricSnapshot 字段 | data-lab |
