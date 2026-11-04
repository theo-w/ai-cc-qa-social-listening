# data/ 合成评测数据集（QCC Workbench MVP）

> 数据版本：`2026.11.03` · 生成器：`data/scripts/generate.mjs` v0.1.0 · 契约：`specs/004-data-model.md`、`specs/007-evaluation-spec.md`
>
> 用途：后端 seed/评测（eval）、告警回放演示、QA 校验规则引擎。数据为**确定性合成数据**，不含任何真实用户信息。

## 1. 文件清单

| 文件 | 内容 | 条数 | 字节 | md5（本版本，供比对） |
| --- | --- | ---: | ---: | --- |
| `data/qc/dataset.json` | 客服质检评测集（40 违规 + 20 正常） | 60 | 99,677 | `3bcb4348f98098fd3c61f8517ed5ced8` |
| `data/sentiment/dataset.json` | 舆情评测集（16 个 topic×date 簇） | 120 | 75,659 | `8f524e3fc63319c76eb9e618bbe7d7bd` |
| `data/manifest.json` | 数据集清单 + 统计 + 44 项自检结果 | — | 11,477 | `a04e7496a211da2b708602188b98ca4b` |
| `data/scripts/generate.mjs` | 确定性生成器（唯一数据源，无随机、无网络、不读系统时间） | — | — | — |

## 2. 复现与校验

```bash
# 生成（会覆盖上述 3 个 JSON；先跑全量约束校验，不通过则不写文件并 exit 1）
node data/scripts/generate.mjs

# 只校验：文件存在性 + 字节级比对 + 全量约束校验（失败 exit 1 并打印差异）
node data/scripts/generate.mjs --check

# 查看用法
node data/scripts/generate.mjs --help
```

确定性保证：所有文本、ID、时间、计数均写死在生成器内，`generatedAt` 为固定展示字符串；同一命令重复执行输出**字节级一致**（JSON 两空格缩进、UTF-8、以换行结尾）。

`--check` 输出（本版本实际结果）：

```text
== QCC Workbench 数据校验（--check，只校验、不写文件）==
[1/2] 文件存在性与字节级比对
  ✓ qc/dataset.json          与生成器输出一致（99677 字节，60 条）
  ✓ sentiment/dataset.json   与生成器输出一致（75659 字节，120 条）
  ✓ manifest.json            与生成器输出一致（11477 字节，180 条）
[2/2] 数据约束校验 44/44 通过
...
结果：PASS（文件字节级一致 + 约束 44/44 通过）
```

约束校验共 44 项：`QC-01..QC-20`（质检集结构/配额/标签证据/超时双向校验等）、`SE-01..SE-20`（舆情集结构/聚簇/级别/信号词等）、`MF-01..MF-04`（manifest 结构自洽）。

## 3. 质检数据集 `data/qc/dataset.json`

### 3.1 顶层结构

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `datasetId` | string | 固定 `qc-eval-v0.1` |
| `version` | string | 规范版本 `0.1.0` |
| `datasetVersion` | string | 数据集内容版本 `2026.11.03`（扩展展示字段） |
| `description` | string | 数据集说明 |
| `generatedAt` | string | 固定 `2026-11-03T10:00:00+08:00` |
| `items` | array | 60 条 Conversation（id 为 `qc-0001`…`qc-0060`） |

### 3.2 Conversation 字段（主字段：004 §3.1）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | `qc-0001`…`qc-0060`，唯一 |
| `channel` | enum | `online` / `ticket` / `phone`，各 20 条 |
| `product` | string | 星海远征 / 云上大陆 / 机甲前线，各 20 条 |
| `agent` | object | `{ id: "A-1001"…, name: "林晓"… }`，4 名坐席各 15 条 |
| `customer` | object | `{ id: "C-77xx", name: "用户xxxx" }`，纯合成 |
| `startedAt` | string | `YYYY-MM-DDTHH:mm:ss+08:00`，范围 2026-10-20 ~ 2026-11-02 |
| `durationSec` | number | 会话时长（秒），均大于末条消息 `atSec` |
| `messages` | array | 4–14 条 Message，详见 3.3 |
| `importedAt` | string | 导入时间，为开始当日 `23:10:00+08:00` |
| `batchId` | string | `B-<日期>`，与 `startedAt` 同日 |

### 3.3 Message 字段（主字段：004 §3.2）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `seq` | number | 从 1 连续递增 |
| `role` | enum | `customer` / `agent` / `system` |
| `text` | string | 消息文本；手机号/邮箱/订单号均已打码（如 `138****2210`、`u***21@example.com`、`SO2026****8821`） |
| `atSec` | number | 相对会话开始的秒数，严格递增 |
| `gapSec` | number | 与本条之前消息的间隔秒数（首条为 0，由相邻 `atSec` 差值计算） |

### 3.4 labels：冻结主字段 + 扩展字段

**评测主字段（004 §7.3 冻结，必须按此判定）**：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `verdict` | enum | `pass` / `violation` |
| `tags` | string[] | 违规标签数组；`pass` 时为空数组 |
| `primaryTag` | string \| null | 主标签；`pass` 时为 `null` |
| `note` | string | 标注说明（证据句、判定理由） |

**扩展字段（非 004 必填，演示/调试用，评测时可忽略）**：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `complexity` | enum | `explicit` / `implicit`（隐式边界样本） |
| `confidence` | number | 标注置信度；`implicit` ≤ 0.75，`explicit` ≥ 0.80 |
| `needsReview` | boolean | 是否需人工复核；与 `complexity=implicit` 一一对应，共 13 条 |
| `summary` | string | 一句话会话摘要 |
| `emotion` | enum | `calm` / `anxious` / `angry` |
| `tagEvidence` | array | `[{ code, evidenceSeq, quote }]`：每个标签的可定位证据消息 |

> **评测主字段为 `tags` / `primaryTag` / `note`**（`verdict` 参与判定一致性）。`tagEvidence` 等扩展字段仅用于证据核查与演示，后端/QA 可忽略。

### 3.5 标签配额与命中统计

| 标签 | 004/007 下限 | 实际命中 | 作为 primaryTag | 权重（004 §4.1） |
| --- | ---: | ---: | ---: | --- |
| `attitude` | ≥ 8 | 9 | 9 | 25（high） |
| `forbidden` | ≥ 8 | 8 | 8 | 30（high） |
| `off_topic` | ≥ 7 | 8 | 7 | 15（medium） |
| `wrong_knowledge` | ≥ 7 | 7 | 7 | 25（high） |
| `timeout` | ≥ 6 | 7 | 4 | 10（medium） |
| `escalation` | ≥ 6 | 11 | 5 | 20（medium） |
| `pass`（无标签） | ≥ 20 | 20 | — | — |

- 违规 40 条 = 单标签 30 条 + 多标签 10 条。多标签组合：`attitude+escalation`×3、`forbidden+escalation`×2、`off_topic+timeout`×2、`escalation+timeout`×1、`wrong_knowledge+escalation`×1、`wrong_knowledge+off_topic`×1。
- `primaryTag` 取权重最高者；同权重按 `forbidden > attitude = wrong_knowledge > escalation > off_topic > timeout` 顺序（`attitude` 与 `wrong_knowledge` 同为 25，取 `attitude`）。
- 隐式边界样本 13 条（`needsReview=true`，`confidence` 0.58–0.72），分布：`ATT-05/06`、`OT-04`、`WK-03/04`、`M-WK-OT-01`、`M-FRB-ESC-02`、`M-OT-TO-02`、`P-03/05/11/12/19`。

### 3.6 category 与 timeout 判定口径

- 标签判定口径严格对齐 `007 §3`：attitude=辱骂/嘲讽反问/指责/驱赶；forbidden=索评/站外/私下交易/绝对化承诺/隐私；off_topic=意图不匹配或连续 2 轮未回应；wrong_knowledge=费率/时间/规则事实错误；escalation=平静转愤怒/投诉/曝光/监管/退游/退款维权。
- **timeout 结构化判定**：存在 `role=agent` 的消息且其 `gapSec > 180` 即命中；生成器同时做了双向校验——标 `timeout` 的样本必有 >180s 坐席间隔，未标的样本不存在 >180s 坐席间隔。7 条超时样本间隔分别为 208s–520s。

### 3.7 整体分布

| 维度 | 分布 |
| --- | --- |
| 渠道 | online / ticket / phone 各 20 |
| 产品 | 星海远征 / 云上大陆 / 机甲前线 各 20 |
| 坐席 | 林晓 / 陈默 / 苏禾 / 何洋 各 15 |
| 日期 | 2026-10-20 ~ 2026-11-02，14 天全覆盖 |
| 消息数 | 4–14 条，平均 4.65 条/对话 |

## 4. 舆情数据集 `data/sentiment/dataset.json`

### 4.1 顶层结构

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `datasetId` | string | 固定 `sentiment-eval-v0.1` |
| `version` | string | 规范版本 `0.1.0` |
| `datasetVersion` | string | 数据集内容版本 `2026.11.03`（扩展） |
| `description` | string | 数据集说明 |
| `generatedAt` | string | 固定 `2026-11-03T10:00:00+08:00` |
| `items` | array | 120 条 Comment（id 为 `cm-0001`…`cm-0120`） |

### 4.2 Comment 字段与 labels

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | `cm-0001`…`cm-0120`，唯一 |
| `source` | enum | `steam` / `taptap` / `googleplay` / `community` / `ticket`，五类全覆盖 |
| `brand` | string | 所属产品（星海远征 / 云上大陆 / 机甲前线） |
| `author` | string | 合成作者名（如 `steam_1000`），无真实身份 |
| `text` | string | 评论文本，8–120 字 |
| `publishedAt` | string | 发布时间 `+08:00`，范围 2026-10-20 ~ 2026-11-02 |
| `topicHints` | string[] | 扩展：主题提示（≤3 个），供规则引擎/演示参考 |

**labels 主字段（004 §7.4 冻结）**：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `sentiment` | enum | `positive` / `neutral` / `negative` |
| `topics` | string[] | 1–3 个主题，取值 版本/充值/外挂/客服/活动/Bug/其他，且必含 `primaryTopic` |
| `primaryTopic` | enum | 主主题，与聚簇键一致 |
| `expectedLevel` | enum | **主字段**：`P0` / `P1` / `P2` / `none`（单条级别，007 §6.1） |
| `noise` | boolean | 是否为噪声（广告/灌水） |
| `note` | string | 标注说明（信号词、聚合关系） |

**扩展字段（非 004 必填）**：`severity`（`p0/p1/p2/none`，仅扩展展示，**评测以 `expectedLevel` 为准**）、`confidence`、`needsReview`、`sentimentScore`（-0.9 ~ 0.9）。

### 4.3 聚合与级别规则（007 §5）

- 聚合键：`(primaryTopic, date)`，同一 topic 同一天为同簇；每簇 4–12 条。
- 聚合级别：簇内负面评论 ≥8 → `P0`；3–7 → 至少 `P1`；1–2 → 至少 `P2`；0 → `none`。
- 簇级别 = `max(单条最大级别, 聚合级别)`。演示数据中「充值 2026-11-01」簇 10 条负面均为单条 `P2`，聚合后升级为 `P0`（聚合升级链路验证样本）。

### 4.4 16 个 topic×date 簇

| 簇 key | 主题 | 日期 | 品牌 | 条数 | 负面数 | 单条最高 | 簇级别 | 说明 |
| --- | --- | --- | --- | ---: | ---: | --- | --- | --- |
| `版本-2026-10-20` | 版本 | 10-20 | 星海远征 | 6 | 2 | P2 | P2 | 轻量吐槽 |
| `其他-2026-10-20` | 其他 | 10-20 | 机甲前线 | 6 | 0 | none | none | 6 条全噪声（广告/灌水） |
| `活动-2026-10-21` | 活动 | 10-21 | 云上大陆 | 6 | 0 | none | none | 活动好评为主 |
| `版本-2026-10-22` | 版本 | 10-22 | 星海远征 | 8 | 4 | P1 | P1 | 闪退影响正常游玩 |
| `Bug-2026-10-23` | Bug | 10-23 | 星海远征 | 8 | 4 | P1 | P1 | 奖励/匹配失败 |
| `充值-2026-10-24` | 充值 | 10-24 | 云上大陆 | 6 | 2 | P2 | P2 | 档位/发票咨询 |
| `活动-2026-10-25` | 活动 | 10-25 | 云上大陆 | 8 | 4 | P1 | P1 | 奖励领取失败 |
| `版本-2026-10-26` | 版本 | 10-26 | 星海远征 | 10 | 10 | P0 | P0 | 回档/数据丢失/集体维权（4 条单条 P0） |
| `客服-2026-10-26` | 客服 | 10-26 | 星海远征 | 8 | 4 | P1 | P1 | 排队/敷衍 |
| `活动-2026-10-28` | 活动 | 10-28 | 云上大陆 | 6 | 2 | P2 | P2 | 玩法老套 |
| `外挂-2026-10-29` | 外挂 | 10-29 | 星海远征 | 10 | 10 | P0 | P0 | 外挂/误封/12315（4 条单条 P0） |
| `其他-2026-10-30` | 其他 | 10-30 | 机甲前线 | 6 | 2 | P2 | P2 | 2 负面 + 3 噪声 + 1 中性 |
| `版本-2026-10-30` | 版本 | 10-30 | 星海远征 | 6 | 0 | none | none | 版本好评 |
| `Bug-2026-10-31` | Bug | 10-31 | 机甲前线 | 8 | 4 | P1 | P1 | 掉线/卡顿 |
| `充值-2026-11-01` | 充值 | 11-01 | 云上大陆 | 10 | 10 | P2 | P0 | **聚合升级 P0**（无单条 P0） |
| `客服-2026-11-02` | 客服 | 11-02 | 云上大陆 | 8 | 4 | P1 | P1 | 工单拖延 |

### 4.5 全局统计

| 维度 | 计数 |
| --- | --- |
| 情绪 | 负面 62 / 正面 30 / 中性 28 |
| 噪声 | 9 条（`noise=true`、中性、单条 `none`） |
| 单条级别 | P0 8 / P1 12 / P2 42 / none 58 |
| 簇级别 | P0 3 簇 / P1 6 簇 / P2 4 簇 / none 3 簇 |
| 来源 | steam 26 / taptap 24 / googleplay 23 / community 23 / ticket 24 |
| 主题 | 版本 30 / 活动 20 / Bug 16 / 充值 16 / 客服 16 / 其他 12 / 外挂 10 |
| 日期 | 2026-10-20 ~ 2026-11-02（13 个有数据日期） |

## 5. 信号词表（QA 校验规则引擎用）

### 5.1 质检标签信号词（`TAG_SIGNALS`）

| 标签 | 信号词（示例，完整列表见生成器常量） |
| --- | --- |
| `attitude` | 不会看、看不出来、爱要不要、别问了、说了多少遍、随便您、说话客气、爱信不信、反思一下、你什么态度 |
| `forbidden` | 好评、五星、加我微信、微信、私下、转账、包退、百分百、内部返利、内部渠道、截图发我、送您 200 |
| `wrong_knowledge` | 手续费是、20%、300%、7 个工作日、11 月 30 日上线、每天 2 次免费抽卡 |
| `escalation` | 投诉、曝光、12315、退游、维权、找你们领导、媒体曝光 |
| `off_topic` | 多关注游戏内的限时活动、版本更新将于、领取新手礼包、首充礼包、最近上线了新活动、看活动规则、先关注游戏内公告、游戏愉快，再见 等 |
| `timeout` | 结构化：坐席消息 `gapSec > 180` |

### 5.2 舆情级别信号词

- `HIGH_RISK_WORDS`（P0 高危）：回档、封号误封、扣款不到账、无法登录、大面积、集体、维权、投诉、12315、媒体曝光、退款潮、数据丢失。
- `IMPACT_WORDS`（P1 明确影响）：闪退、卡顿、进不去、黑屏、掉线、异常、失败、延迟、拖延、态度差、敷衍、排队、没人处理、没法正常、无法使用、加载不出、领取失败、匹配失败。
- `TOPIC_KEYWORDS`（主题校验）：版本→版本/更新/版更；充值→充值/月卡/档位/氪；外挂→外挂/脚本/开挂；客服→客服/工单/排队/服务；活动→活动/福利/奖励；Bug→BUG/Bug/bug/闪退/掉线/卡顿/修复；其他→无。
- 生成器保证：非 `P0` 单条文本不含高危词；`P1` 负评必含影响词且不含高危词；一切 `P2`/`none` 不含高危词；噪声评论为中性、无行动价值。

## 6. manifest.json

顶层结构（004 §7.2 必填字段 + 扩展）：

```json
{
  "version": "0.1.0",
  "datasetVersion": "2026.11.03",
  "generatedAt": "2026-11-03T10:00:00+08:00",
  "description": "QCC Workbench MVP 评测数据清单……",
  "generator": { "name": "qcc-data-generator", "version": "0.1.0", "deterministic": true, "specVersion": "0.1.0" },
  "datasets": {
    "qc": { "datasetId": "qc-eval-v0.1", "version": "0.1.0", "datasetVersion": "2026.11.03", "file": "qc/dataset.json", "itemCount": 60, "counts": { "...": "..." } },
    "sentiment": { "datasetId": "sentiment-eval-v0.1", "...": "...", "file": "sentiment/dataset.json", "itemCount": 120, "counts": { "...": "..." } }
  },
  "counts": { "total": 180, "qc": { "...": "..." }, "sentiment": { "...": "..." } },
  "checks": { "passed": true, "total": 44, "passedCount": 44, "failed": [], "items": [ { "id": "QC-01", "title": "…", "ok": true } ] }
}
```

字段口径：

- `datasets` 是**对象映射**（`qc` / `sentiment` 两个键），不是数组（004 §7.2 原文）。
- 按 004 §7.5 金标读取口径：后端以 `version` 判断数据集版本，`datasetVersion` 供展示层展示；两者均由生成器固定写入，不需要读方做 `??` 兜底。
- `dynamic` 统计（`counts`）由生成器从 `items` 实际计算，与数据集逐项对账；`checks` 为 44 项自检结果，失败时 `--check` exit 1。

## 7. 与规范对齐说明（扩展字段清单）

为满足任务卡对「每条文本埋入可定位证据」「人类可读判定说明」的要求，在 004 冻结结构之上增加了以下**非必填扩展字段**，不改动任何 `specs/` 文件：

| 位置 | 扩展字段 | 原因 |
| --- | --- | --- |
| QC item | `labels.complexity/confidence/needsReview/summary/emotion/tagEvidence` | 边界样本与证据定位，供演示/复核 |
| QC message | `gapSec` | 方便规则引擎直接取超时间隔（由相邻 `atSec` 差值计算，与 004 语义一致） |
| QC/Sentiment 顶层 | `datasetVersion`、`generatedAt` | 数据版本与生成时间展示（固定值，保证确定性） |
| Sentiment item | `topicHints`、`labels.severity/confidence/needsReview/sentimentScore` | 主题提示与演示排序；**级别判定以 `expectedLevel` 为主字段** |
| manifest | `datasetVersion/generator/counts/checks` | 对账、自检与门禁需要 |

评测主字段：质检 `verdict/tags/primaryTag/note`；舆情 `sentiment/topics/primaryTopic/expectedLevel/noise/note`。

## 8. 人工抽检记录

抽检比例：QC 6/60（10%）、舆情 12/120（10%），2026-11-03 由 data-lab 执行；方式：逐条核对文本证据句与金标是否一致（含边界样本与聚合升级样本）。

| 样本 | 类型 | 抽检结论 |
| --- | --- | --- |
| `qc-0001` | attitude / explicit | 坐席「您自己不会看吗」构成反问嘲讽；`verdict=violation`、`tags=[attitude]` 正确 |
| `qc-0008` | forbidden / explicit | 「加我微信」「私下找我处理」构成站外/私下交易引导；标签正确 |
| `qc-0018` | wrong_knowledge / explicit | 「退款手续费是 20%」与知识库「不收费」冲突；标签正确 |
| `qc-0023` | timeout | seq=4 坐席回复 `gapSec=245 > 180`，证据定位正确 |
| `qc-0031` | attitude + escalation | 坐席嘲讽（attitude seq=4）+ 用户投诉（escalation seq=5）；`primaryTag=attitude` 符合权重 |
| `qc-0047` | pass / implicit | 坐席按规则说明时限并提交申请，无违规信号；`tags=[]`、`primaryTag=null` 正确 |
| `cm-0007` | 噪声（其他 / 10-20） | 代练广告，`noise=true`、中性、`expectedLevel=none` 正确 |
| `cm-0019` | 版本 / 10-22 / P1 | 「2.4 更新后一直闪退，根本没法正常玩」负面 + 版本 + 影响词，P1 正确 |
| `cm-0031` | Bug / 10-23 / 正面 | 「BUG 今天就修好了」为正面回复，`none` 正确 |
| `cm-0049` | 版本 / 10-26 / P0 | 「回档 + 进度全没了 + 氪金」命中高危词，P0 正确 |
| `cm-0055` | 版本 / 10-26 / P2 | 「更新的新玩法不太好玩」轻量负面无高危词，P2 正确 |
| `cm-0075` | 外挂 / 10-29 / P0 | 「外挂猖獗 + 媒体曝光 + 维权」P0 正确 |
| `cm-0090` | 版本 / 10-30 / 正面 | 「新版本体验不错」正面 none 正确 |
| `cm-0101` | Bug / 10-31 / 正面 | 「BUG 修复速度很快」正面 none 正确 |
| `cm-0105` | 充值 / 11-01 / P2 | 「档位设置不合理」单条 P2；该簇 10 条负面聚合升级 P0，符合 007 §5 |
| `cm-0113` | 客服 / 11-02 / P1 | 「工单三天没人处理」负面 + 客服 + 拖延影响，P1 正确 |
| `cm-0045` | 活动 / 10-25 / 正面 | 「活动福利挺多」正面 none 正确 |
| `cm-0060` | 客服 / 10-26 / P1 | 「排队四十分钟」负面 + 客服 + 排队影响，P1 正确 |

结论：抽检 18 条全部与 `note` 描述及 007 口径一致，未发现错标；其余条目由 44 项自动校验覆盖结构、配额与信号词一致性。

## 9. 已知限制与维护

1. 数据为合成数据：产品/坐席/用户/订单号均为虚构或打码；评论作者为合成 ID。演示时请勿当作真实舆情。
2. 文本为固定语料，规则引擎若扩展同义词，需要同步更新生成器 `TAG_SIGNALS / HIGH_RISK_WORDS / IMPACT_WORDS` 并重新生成、重新跑 `--check`。
3. 修改生成器后，`data/README.md` 中字节数/md5 与统计需同步更新（以 `node data/scripts/generate.mjs --check` 输出为准）。
4. 后端若只读 004 主字段，可安全忽略所有扩展字段；不要依赖 `severity` 替代 `expectedLevel` 做级别判定。
