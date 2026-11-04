# 评测检查清单（Gate-4 / 评测发布）

> 用途：每次修改规则引擎、数据集或评测逻辑后，跑完本清单才能宣称「指标达标」。

## A. 数据集

- [ ] `data/qc/dataset.json` 60 条，字段符合 `004-data-model.md`
- [ ] `data/sentiment/dataset.json` 120 条，字段符合 schema
- [ ] QC 标签定额：attitude≥8、forbidden≥8、off_topic≥7、wrong_knowledge≥7、timeout≥6、escalation≥6、pass≥20
- [ ] QC 低置信度边界样本 ≥10（confidence 在 0.6–0.74）
- [ ] 舆情簇 12–16 个；P0 簇≥2、P1 簇≥3、P2 簇≥3、none 簇≥3
- [ ] 负面 ≥60、正面 ≥25、中性 ≥15、噪声 ≥8
- [ ] 来源 steam/taptap/googleplay/community/ticket 全覆盖
- [ ] 日期范围 2026-10-20 ~ 2026-11-02
- [ ] 每条都有金标 labels，且 evidenceSeq 可在原文定位
- [ ] `node data/scripts/generate.mjs --check` exit 0
- [ ] 数据集版本已写入 `data/manifest.json` 并记录变更

## B. 评测执行

- [ ] 引擎版本与评测记录中的 `modelVersion` 一致
- [ ] `POST /api/eval/runs {"dataset":"qc"}` 返回 200
- [ ] `POST /api/eval/runs {"dataset":"sentiment"}` 返回 200
- [ ] 重复运行结果 metrics 完全一致（确定性）
- [ ] EvalRun 持久化，历史列表可查询
- [ ] 错例列表 ≤20 且每条含 itemId/expected/predicted/reason

## C. 指标口径

- [ ] 质检准确率 = verdict 一致且（pass 或 primaryTag 一致）/ 总数
- [ ] 误报率 = 正常判违规 / 预测违规（分母 0 → 0）
- [ ] 漏报率 = 违规判正常 / 金标违规（分母 0 → 0）
- [ ] 复核占比 = needsReview / 总数
- [ ] 预警准确率按 (topic,date) 簇匹配计算，级别容差按 007 定义
- [ ] 响应时长只统计已首响样本，无样本返回 null
- [ ] 所有 ratio 保留 3 位小数，展示 1 位百分比

## D. 门禁与结论

- [ ] 质检准确率 ≥80%、误报 ≤15%、漏报 ≤20%、复核占比 ≤30%
- [ ] 舆情预警准确率 ≥80%、主题准确率 ≥75%、情感准确率 ≥80%
- [ ] P0 首响 ≤30min、P1 首响 ≤120min（演示数据口径）
- [ ] 未通过项已记录原因与改进建议，不隐瞒
- [ ] 评测报告包含：数据集版本、引擎版本、指标表、混淆矩阵、错例 Top5、局限性声明

## E. 回归

- [ ] 修改引擎后全量重跑，与上一版指标对比（记录 delta）
- [ ] 指标下降 >3pp 必须定位原因或回滚
- [ ] 新增加规则需新增对应测试用例

## F. 结论

| 项 | 结论 | 证据 |
|---|---|---|
| 评测日期 | 待填 | |
| 数据集版本 | 待填 | |
| 引擎版本 | rule-engine-v0.3.0 | |
| 结论 | 待填 | |
| 已知局限 | 合成评测集、规则引擎，不代表线上泛化 | |
