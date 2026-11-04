# Badcase 闭环单模板与操作规范

> 适用：QCC Workbench MVP 质检/舆情发现的问题，需要「定位根因 → 责任到人 → 培训/知识/流程修复 → 复测闭环」时使用。
> 依据：`specs/004-data-model.md` §3.6（Badcase 字段）、§4.2（归因类别）、§4.5（责任人路由）、§5.1（状态机）。
> 使用方式：复制 §3 模板 → 按 §2 填写 → 提交给对应责任人 → 按 §7 状态机流转；关闭前必须填写 `proof`。

## 1. 何时开 Badcase

| 触发来源 | 判断标准 | 示例 |
|---|---|---|
| 质检违规 | `verdict=violation` 且属于可修复的知识/话术/流程/系统问题 | 坐席说错退款费率 |
| 人工复核改判 | `decision=amend/overturn` 且暴露规则或培训缺口 | 隐晦嘲讽被判定为正常 |
| 舆情 P0/P1 预警 | 需要产研或流程介入的集中负面 | 回档导致充值损失 |
| 指标异常 | 看板异常卡触发，且归因落到客服/产研 | 超时率、满意度连续下滑 |

以下情况**不单独开单**：单次偶发的用户主观不满意、与知识库一致的合规拒绝、纯系统公告引起的误解（由舆情预警处理）。

## 2. 字段填写要求（基于 004 §3.6）

| 字段 | 必填 | 填写要求 |
|---|---|---|
| `id` / `code` | 系统生成 | `bc-0001` / `BC-2026-0001`，不可手改 |
| `conversationId` / `qcResultId` | 是 | 来源质检结果；舆情来源填关联评论或预警 id 到 `evidence` |
| `title` | 是 | 一句话问题，≤ 30 字，含「现象 + 影响」 |
| `category` | 是 | `knowledge` / `script` / `process` / `system`，按 §4 归因 |
| `rootCause` | 是 | 具体到「为什么」，禁止写「服务意识不足」这类空话；关闭前不得为空 |
| `owner` | 是 | 按 §6 路由默认责任人；可改派但需在 timeline 留痕 |
| `creator` | 是 | 建单人 |
| `severity` | 是 | 由来源标签最高级别决定：high/medium/low |
| `slaHours` / `dueAt` | 是 | 按 `category` 缺省（005 §3.4 契约）：knowledge=48h、script=48h、process=24h、system=72h；`severity` 仅展示，不参与 SLA 推导；`dueAt = createdAt + slaHours` |
| `status` | 是 | `open` / `in_progress` / `pending_verify` / `closed` |
| `recurrence` / `recurrenceOf` | 是 | 7 天内同标签同根因再次出现 → `recurrence=true` 并填历史 id |
| `evidence` | 是 | 至少 1 条可定位证据：`{ seq, quote }`，quote 必须来自原文 |
| `proof` | 关闭时必填 | 知识库链接/话术模板版本/培训记录/流程变更单号 |
| `timeline` | 系统写 | 每次状态变更写 `{ at, by, type, note, from, to }` |
| `closedAt` / `updatedAt` | 系统写 | ISO 时间（`+08:00`） |

SLA 按归因类别缺省（005 §3.4 契约冻结，**不用 severity 推导**）：

| category | 含义 | 缺省 slaHours | 超时处理 |
|---|---|---|---|
| knowledge | 知识缺失/过期 | 48 | 抄送顾清 + 质检组长 |
| script | 话术问题 | 48 | 升级客服主管陆川 |
| process | 流程问题 | 24 | 升级客服主管陆川 |
| system | 产品缺陷 | 72 | 升级周野（产研） |

严重级别（仅展示/排序用，由来源标签最高级别决定）：high=含 high 标签（attitude/forbidden/wrong_knowledge）或资损风险；medium=含 medium 标签（off_topic/timeout/escalation）；low=体验建议类。

## 3. 空白模板（复制后填写）

```markdown
### Badcase 闭环单
- id / code：
- 来源：conversationId= / qcResultId=
- 标题：
- 归因类别：knowledge / script / process / system
- 严重级别：high / medium / low（依据标签：      ）
- SLA：     小时，截止：
- 责任人：           建单人：
- 状态：open

#### 根因（必填，写清“为什么”）
（示例：知识库退款费率页停留在旧版，坐席按旧版口径答复，导致 20% 手续费错误承诺）

#### 证据快照
1. seq=   quote=“……”
2. seq=   quote=“……”

#### 修复动作与计划
- 动作 1：
- 动作 2：
- 预计完成日期：

#### 闭环证明（关闭时必填）
- 知识库链接 / 话术模板版本 / 培训记录 / 流程单号：
- 复测方式与结果：

#### 时间线（系统追加）
| 时间 | 操作人 | 动作 | 说明 |
|---|---|---|---|
| | | created | |
```

## 4. 填写示例（演示数据对应）

```markdown
### Badcase 闭环单
- id / code：bc-0001 / BC-2026-0001
- 来源：conversationId=qc-0008 / qcResultId=qcr-1008
- 标题：坐席引导加微信私下退款，存在站外交易与资损风险
- 归因类别：script
- 严重级别：high（依据标签：forbidden，仅展示）
- SLA：48 小时（category=script），截止：2026-10-23T10:30:00+08:00
- 责任人：唐沐（培训）  建单人：沈言（质检组长）
- 状态：in_progress

#### 根因
坐席对「订单异常需走官方退款通道」的流程不熟悉，为安抚用户承诺个人微信私下转账；
退款流程页在知识库中缺少「禁止站外交易」的显式红线说明。

#### 证据快照
1. seq=4 quote=“您加我微信，我私下把退款转给您，不用走平台。”
2. seq=6 quote=“放心，百分百退给您，不用申请。”

#### 修复动作与计划
- 动作 1：话术模板新增「退款必须走官方工单，禁止加微信/私下转账」红线，唐沐，10-22 前。
- 动作 2：知识库退款页补充红线说明与正确话术，顾清，10-22 前。
- 动作 3：涉事坐席 1v1 培训并复测 3 条样本，唐沐，10-23 前。

#### 闭环证明（关闭时必填）
- 话术模板 v2.0 已上线；知识库 KB-2026-1022-01 已发布；
- 复测 3 条 forbidden 样本，均未再出现站外引导。

#### 时间线（系统追加）
| 时间 | 操作人 | 动作 | 说明 |
|---|---|---|---|
| 2026-10-21T10:30:00+08:00 | 沈言 | created | 质检发现 forbidden |
| 2026-10-21T11:00:00+08:00 | 沈言 | assigned | 指派唐沐 |
| 2026-10-21T14:10:00+08:00 | 唐沐 | progressed | 话术模板修订中 |
```

## 5. 归因类别与典型闭环动作（004 §4.2）

| category | 含义 | 典型动作 | 默认责任人 |
|---|---|---|---|
| `knowledge` | 知识缺失/过期 | 知识库新增或修订条目，标注复测 | 顾清（知识运营） |
| `script` | 话术问题 | 话术模板更新 + 培训 + 抽测 | 唐沐（培训） |
| `process` | 流程问题 | 流程/SOP 修订，明确节点与责任人 | 陆川（客服主管） |
| `system` | 系统/产品缺陷 | 提产研需求，排期修复并回归 | 周野（产研） |

## 6. 责任人路由（004 §4.5）

| 场景 | 默认责任人 |
|---|---|
| 质检复核 | 沈言（质检组长） |
| badcase knowledge | 顾清（知识运营） |
| badcase script | 唐沐（培训） |
| badcase process | 陆川（客服主管） |
| badcase system | 周野（产研） |

## 7. 状态机与流转规则（004 §5.1）

```text
open ──认领/分派──▶ in_progress ──提交修复──▶ pending_verify ──验证通过+proof──▶ closed
  │                                              ▲                          │
  └──无效关闭(仅主管)──▶ closed                    └────验证不通过──────────────┘
                                                    closed ──7 天内复发──▶ in_progress(重开)
```

| 流转 | 操作人 | 必填 | 校验 |
|---|---|---|---|
| open → in_progress | 责任人/主管 | note | 确认 rootCause 非空 |
| in_progress → pending_verify | 责任人 | note | 修复动作可核验 |
| pending_verify → closed | 质检组长/主管 | `proof` | 无 proof 不允许关闭 |
| pending_verify → in_progress | 验证人 | note | 写明不通过原因 |
| closed → in_progress | 主管 | `recurrenceOf` | 7 天内同标签同根因 |
| open → closed（无效） | 仅主管 | note | 写明无效原因 |

## 8. 闭环验收清单

- [ ] `title` 能一眼看出「谁的问题 + 什么影响」
- [ ] `rootCause` 写到机制层，不是态度口号
- [ ] `category` 与 `owner` 路由一致（不一致时在 timeline 说明改派原因）
- [ ] `evidence` 至少 1 条原文证据，seq 可回跳
- [ ] 修复动作是**可执行**的（改哪份知识/哪版话术/哪个流程节点）
- [ ] `proof` 可点击核验，且包含复测结果
- [ ] 复发检查已完成（7 天内同标签同根因）
- [ ] 关闭时间早于 `dueAt`，或超时原因已记录

## 9. 常见错误

| 错误 | 后果 | 正确做法 |
|---|---|---|
| rootCause 写「服务意识不足」 | 无法定位修复动作，下月复发 | 写到流程/知识/话术/系统的具体缺口 |
| 关闭时 proof 为空 | 违反状态机，无法审计 | 先补复测记录再关闭 |
| 一条对话开多张单 | 统计重复、责任人混淆 | 一张单承载同根因，多标签在证据中标注 |
| 复发不填 recurrenceOf | 复发率指标失真 | 按 7 天同标签同根因规则关联历史单 |
| 用 badcase 代替舆情预警处理 | 状态机混用、SLA 错乱 | 舆情走 SentimentAlert（见 `docs/sentiment-sop.md`） |

## 10. 模板维护

- 本模板与 004 §3.6/§5.1 对齐；字段口径变更时先改 spec，再改模板。
- 建议每个迭代抽样复核 5 张已关闭单，检查 proof 可核验性与 rootCause 质量，结论记录在周会纪要。
