#!/usr/bin/env node
/**
 * QCC Workbench · data/ 合成评测数据集生成器
 * =============================================================================
 * 用途
 *   生成 MVP 演示与评测所需的确定性合成数据，不联网、不依赖第三方包：
 *     data/qc/dataset.json        客服质检评测集（60 条对话，40 违规 + 20 正常）
 *     data/sentiment/dataset.json 舆情评测集（120 条评论，16 个 topic×date 簇）
 *     data/manifest.json          数据集清单 + 统计 + 约束校验结果
 *
 * 契约
 *   字段以 specs/004-data-model.md §7.3 / §7.4 的冻结结构为主字段（verdict/
 *   tags/primaryTag/note、sentiment/topics/primaryTopic/expectedLevel/noise/note），
 *   另加非必填扩展字段（tagEvidence/confidence/needsReview/summary/emotion、
 *   severity/sentimentScore/topicHints 等），供演示与调试使用，不改变冻结语义。
 *   标签判定口径见 specs/007-evaluation-spec.md §3/§5/§6。
 *
 * 确定性
 *   固定数据源：所有文本、日期、时间、ID、计数均写死在脚本内，不使用随机数、
 *   不读网络、不读系统时间。同一命令重复执行输出字节级一致（UTF-8，JSON 两空格
 *   缩进并以换行结尾）。manifest.generatedAt 为固定展示字符串。
 *
 * 用法
 *   node data/scripts/generate.mjs            # 生成/覆盖 3 个 JSON 文件
 *   node data/scripts/generate.mjs --check    # 只校验（不写文件），与现有文件做
 *                                             # 字节级比对 + 全量约束校验，失败 exit 1
 *   node data/scripts/generate.mjs --help     # 查看用法
 * =============================================================================
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(SCRIPT_DIR, '..');

const GENERATOR_NAME = 'qcc-data-generator';
const GENERATOR_VERSION = '0.1.0';
const DATASET_VERSION = '2026.11.03';
const SPEC_VERSION = '0.1.0';
const GENERATED_AT = '2026-11-03T10:00:00+08:00';
const QC_DATASET_ID = 'qc-eval-v0.1';
const SENTIMENT_DATASET_ID = 'sentiment-eval-v0.1';
const DEMO_NOW = '2026-11-03T10:00:00+08:00';

// 质检对话：日期 / 开始时间（固定表，startedAt 一律在 2026-10-20 ~ 2026-11-02）
const DATES = [
  '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24',
  '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29',
  '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02',
];
const TIMES = ['09:12', '10:05', '11:24', '13:40', '15:18', '17:06', '19:32', '21:10'];
const CHANNELS = ['online', 'ticket', 'phone'];
const AGENTS = [
  { id: 'A-1001', name: '林晓' },
  { id: 'A-1002', name: '陈默' },
  { id: 'A-1003', name: '苏禾' },
  { id: 'A-1004', name: '何洋' },
];
const PRODUCTS = ['星海远征', '云上大陆', '机甲前线'];

// 004 §4.1 标签权重（primaryTag 取权重最高；同权按 PRIMARY_ORDER 先后）
const TAG_WEIGHTS = {
  attitude: 25,
  forbidden: 30,
  off_topic: 15,
  wrong_knowledge: 25,
  timeout: 10,
  escalation: 20,
};
const TAG_NAMES = {
  attitude: '服务态度',
  forbidden: '违规话术',
  off_topic: '答非所问',
  wrong_knowledge: '知识错误',
  timeout: '响应超时',
  escalation: '情绪升级',
};
const PRIMARY_ORDER = ['forbidden', 'attitude', 'wrong_knowledge', 'escalation', 'off_topic', 'timeout'];

// 可定位证据词表：violation 的 evidence 句必须命中本标签信号词；
// 非该标签样本（含全部 pass 样本）不得出现任何标签信号词。
const TAG_SIGNALS = {
  attitude: ['不会看', '看不出来', '爱要不要', '别问了', '说了多少遍', '随便您', '说话客气', '爱信不信', '反思一下', '你什么态度'],
  forbidden: ['好评', '五星', '加我微信', '微信', '私下', '转账', '包退', '百分百', '内部返利', '内部渠道', '截图发我', '送您 200'],
  wrong_knowledge: ['手续费是', '20%', '300%', '7 个工作日', '11 月 30 日上线', '每天 2 次免费抽卡'],
  escalation: ['投诉', '曝光', '12315', '退游', '维权', '找你们领导', '媒体曝光'],
  off_topic: [
    '多关注游戏内的限时活动',
    '活动期间充值还有额外奖励',
    '版本更新将于',
    '领取新手礼包',
    '新手礼包里面有钻石',
    '首充礼包',
    '限定时装很划算',
    '最近上线了新活动',
    '看活动规则',
    '先关注游戏内公告',
    '游戏愉快，再见',
  ],
};

// 舆情 P0 高危信号词 / P1 明确影响词（007 §6.1）
const HIGH_RISK_WORDS = ['回档', '封号误封', '扣款不到账', '无法登录', '大面积', '集体', '维权', '投诉', '12315', '媒体曝光', '退款潮', '数据丢失', '资损'];
const IMPACT_WORDS = ['闪退', '卡顿', '进不去', '黑屏', '掉线', '异常', '失败', '延迟', '拖延', '态度差', '敷衍', '排队', '没人处理', '没法正常', '无法使用', '加载不出', '领取失败', '匹配失败'];
const SENTIMENT_TOPICS = ['版本', '充值', '外挂', '客服', '活动', 'Bug', '其他'];
const SENTIMENT_SOURCES = ['steam', 'taptap', 'googleplay', 'community', 'ticket'];
const SENTIMENT_TIMES = ['08:12', '09:37', '10:24', '11:46', '13:18', '14:52', '16:07', '17:35', '19:11', '20:28', '21:43', '22:56'];

// ---------------------------------------------------------------------------
// 质检对话场景（60 条：40 violation + 20 pass）
// 每条：sid / tags / evidence（tag -> 证据 message seq，pass 为空）/ complexity /
// needsReview / emotion / summary / note / msgs（[role, text, atSec]）
// atSec 单调递增；非 timeout 样本相邻间隔一律 <= 180s；timeout 样本至少一处
// 坐席回复间隔 > 180s（由相邻 atSec 差值体现）。
// ---------------------------------------------------------------------------
const QC_SCENARIOS = [
  // ---------------- attitude 单标签（6）----------------
  {
    sid: 'ATT-01',
    tags: ['attitude'],
    evidence: { attitude: 4 },
    complexity: 'explicit',
    needsReview: false,
    emotion: 'angry',
    summary: '用户咨询充值到账问题，坐席以反问回应，判定服务态度违规。',
    note: '坐席使用「您自己不会看吗」反问羞辱用户，命中 attitude，证据 seq=4。',
    msgs: [
      ['customer', '你好，我昨天充值的 648 显示成功，但游戏里没收到钻石，能帮我看下吗？', 0],
      ['agent', '您好，请提供一下订单号。', 28],
      ['customer', '订单号 SO2026****8821，手机号 138****2210。', 74],
      ['agent', '系统显示已经到账了，您自己不会看吗？', 132],
      ['customer', '你什么态度？我就是没看到才来问的。', 168],
      ['agent', '这边建议您重新登录游戏查看。', 190],
    ],
  },
  {
    sid: 'ATT-02',
    tags: ['attitude'],
    evidence: { attitude: 4 },
    complexity: 'explicit',
    needsReview: false,
    emotion: 'angry',
    summary: '用户礼包码兑换失败求助，坐席嘲讽用户操作，判定服务态度违规。',
    note: '坐席使用「这都看不出来吗」嘲讽用户，命中 attitude，证据 seq=4。',
    msgs: [
      ['customer', '我的礼包码兑换失败了，提示无效，是不是过期了？', 0],
      ['agent', '您好，请提供礼包码前六位。', 22],
      ['customer', 'GIFT-****-9K2M。', 55],
      ['agent', '是您自己输错了，这都看不出来吗？', 96],
      ['customer', '我检查过了，就是复制的。', 128],
      ['agent', '那可能是您复制的时候多了空格，下次注意。', 155],
    ],
  },
  {
    sid: 'ATT-03',
    tags: ['attitude'],
    evidence: { attitude: 4 },
    complexity: 'explicit',
    needsReview: false,
    emotion: 'angry',
    summary: '用户询问换绑手机号，坐席用驱赶式话术回应，判定服务态度违规。',
    note: '坐席使用「爱要不要，就这个方案」「下一个」驱赶用户，命中 attitude，证据 seq=4。',
    msgs: [
      ['customer', '我这个账号绑定的手机号不用了，怎么换绑？', 0],
      ['agent', '换绑需要原手机号收验证码。', 26],
      ['customer', '可是原手机号已经注销了，收不到验证码啊。', 63],
      ['agent', '那没办法，爱要不要，就这个方案。', 98],
      ['customer', '你们就没有别的办法吗？', 130],
      ['agent', '没有。', 142],
    ],
  },
  {
    sid: 'ATT-04',
    tags: ['attitude'],
    evidence: { attitude: 4 },
    complexity: 'explicit',
    needsReview: false,
    emotion: 'angry',
    summary: '用户确认月卡扣费规则，坐席不耐烦回应，判定服务态度违规。',
    note: '坐席使用「说了多少遍了，别问了」表达不耐烦，命中 attitude，证据 seq=4。',
    msgs: [
      ['customer', '请问月卡到期后会自动续费吗？', 0],
      ['agent', '月卡是 30 天的，到期自己续。', 20],
      ['customer', '我的意思是会不会自动扣费？', 48],
      ['agent', '说了多少遍了，不会自动扣，别问了。', 84],
      ['customer', '好吧，谢谢。', 110],
    ],
  },
  {
    sid: 'ATT-05',
    tags: ['attitude'],
    evidence: { attitude: 4 },
    complexity: 'implicit',
    needsReview: true,
    emotion: 'anxious',
    summary: '用户催退款进度，坐席以冷淡阴阳话术回应，需人工复核判定服务态度违规。',
    note: '边界样本：坐席「行吧，随便您怎么想」语气阴阳，命中 attitude 但需结合上下文判定，证据 seq=4。',
    msgs: [
      ['customer', '我提交的退款申请三天了还没处理，能帮我催一下吗？', 0],
      ['agent', '您好，退款按流程处理，请耐心等待。', 30],
      ['customer', '可是我等着用钱，能不能给个具体时间？', 72],
      ['agent', '行吧，随便您怎么想，反正流程就是这样。', 108],
      ['customer', '……那我再等等吧。', 140],
    ],
  },
  {
    sid: 'ATT-06',
    tags: ['attitude'],
    evidence: { attitude: 4 },
    complexity: 'implicit',
    needsReview: true,
    emotion: 'anxious',
    summary: '用户追问奖励未发放，坐席反过来指责用户语气，需人工复核服务态度问题。',
    note: '边界样本：坐席「请您说话客气一点」反向指责用户，命中 attitude 但语气隐晦，证据 seq=4。',
    msgs: [
      ['customer', '为什么我完成任务没有发奖励？', 0],
      ['agent', '请您先确认一下任务是否真的完成了。', 24],
      ['customer', '我确定完成了，进度条都满了。', 58],
      ['agent', '那请您说话客气一点，我这边也很忙。', 92],
      ['customer', '我没有不客气啊……', 120],
    ],
  },
  // ---------------- forbidden 单标签（6）----------------
  {
    sid: 'FRB-01',
    tags: ['forbidden'],
    evidence: { forbidden: 2 },
    complexity: 'explicit',
    needsReview: false,
    emotion: 'calm',
    summary: '问题解决后坐席索要五星好评，并要求截图登记，判定违规话术。',
    note: '坐席索评并索要截图（「五星好评」「截图发我」），命中 forbidden，证据 seq=2。',
    msgs: [
      ['customer', '好的，问题解决了，谢谢。', 0],
      ['agent', '不客气，麻烦您给个五星好评，我们这边有考核。', 20],
      ['customer', '行吧，我去评价。', 46],
      ['agent', '记得截图发我，我这边要登记。', 66],
    ],
  },
  {
    sid: 'FRB-02',
    tags: ['forbidden'],
    evidence: { forbidden: 2 },
    complexity: 'explicit',
    needsReview: false,
    emotion: 'anxious',
    summary: '坐席引导用户加私人微信并声称可插队处理，判定违规话术。',
    note: '坐席引导站外联系（「加我微信」「私下找我处理」），命中 forbidden，证据 seq=2。',
    msgs: [
      ['customer', '我的订单一直显示处理中，怎么办？', 0],
      ['agent', '这个问题官方处理很慢，您加我微信 kf_8821，私下找我处理。', 25],
      ['customer', '微信？官方渠道不能处理吗？', 60],
      ['agent', '加微信方便一点，我帮您插个队。', 88],
    ],
  },
  {
    sid: 'FRB-03',
    tags: ['forbidden'],
    evidence: { forbidden: 2 },
    complexity: 'explicit',
    needsReview: false,
    emotion: 'anxious',
    summary: '坐席引导用户私下转账购买已下架皮肤，判定违规话术。',
    note: '坐席提出私下交易（「私下转账 200 给我」），命中 forbidden，证据 seq=2。',
    msgs: [
      ['customer', '那个限定皮肤还能买吗？', 0],
      ['agent', '官方渠道已经下架了，您私下转账 200 给我，我帮你直接开通。', 28],
      ['customer', '这样可以吗？不会被封号吧？', 62],
      ['agent', '放心，我操作很多次了。', 84],
    ],
  },
  {
    sid: 'FRB-04',
    tags: ['forbidden'],
    evidence: { forbidden: 2 },
    complexity: 'explicit',
    needsReview: false,
    emotion: 'anxious',
    summary: '坐席对退款给出绝对化承诺，判定违规话术。',
    note: '坐席使用绝对化承诺（「百分百能退」「包退」），命中 forbidden，证据 seq=2。',
    msgs: [
      ['customer', '我冲了 648 没到账，能退吗？', 0],
      ['agent', '放心，百分百能退，包退，一分不少。', 20],
      ['customer', '那大概多久？', 48],
      ['agent', '很快的，绝对没问题。', 62],
    ],
  },
  {
    sid: 'FRB-05',
    tags: ['forbidden'],
    evidence: { forbidden: 2 },
    complexity: 'explicit',
    needsReview: false,
    emotion: 'calm',
    summary: '坐席向用户介绍私下返利与内部充值渠道，判定违规话术。',
    note: '坐席介绍内部返利与私下交易（「内部返利」「私下返给你」），命中 forbidden，证据 seq=2。',
    msgs: [
      ['customer', '充值有什么优惠吗？', 0],
      ['agent', '有内部返利，充值返利 30%，私下返给你，别走官方活动。', 22],
      ['customer', '还有这种？', 50],
      ['agent', '对，您把款转我，我这边给您操作。', 72],
    ],
  },
  {
    sid: 'FRB-06',
    tags: ['forbidden'],
    evidence: { forbidden: 2 },
    complexity: 'explicit',
    needsReview: false,
    emotion: 'calm',
    summary: '坐席以赠送钻石为条件换取用户好评截图，判定违规话术。',
    note: '坐席用福利换好评（「好评截图发我」「送您 200」），命中 forbidden，证据 seq=2。',
    msgs: [
      ['customer', '礼包补偿收到了，谢谢。', 0],
      ['agent', '给个好评截图发我，我送您 200 钻石。', 20],
      ['customer', '还要截图啊？', 46],
      ['agent', '对，好评越多我们绩效越高。', 64],
    ],
  },
  // ---------------- off_topic 单标签（5）----------------
  {
    sid: 'OT-01',
    tags: ['off_topic'],
    evidence: { off_topic: 2 },
    complexity: 'explicit',
    needsReview: false,
    emotion: 'anxious',
    summary: '用户询问退款到账时间，坐席连续两轮以活动推广回避问题，判定答非所问。',
    note: '坐席未回应退款诉求，改用活动推广话术，命中 off_topic，证据 seq=2（seq=4 仍回避）。',
    msgs: [
      ['customer', '你好，我申请的退款什么时候能到账？', 0],
      ['agent', '您好，建议您多关注游戏内的限时活动哦，最近活动很丰富。', 30],
      ['customer', '我问的是退款到账时间。', 66],
      ['agent', '活动期间充值还有额外奖励，您可以看看。', 94],
    ],
  },
  {
    sid: 'OT-02',
    tags: ['off_topic'],
    evidence: { off_topic: 2 },
    complexity: 'explicit',
    needsReview: false,
    emotion: 'angry',
    summary: '用户反馈扣款未到账，坐席以版本更新公告回避，判定答非所问。',
    note: '坐席未回应扣款问题，改发版本更新公告话术，命中 off_topic，证据 seq=2。',
    msgs: [
      ['customer', '我充值显示失败，但是扣款了，怎么处理？', 0],
      ['agent', '亲爱的玩家，版本更新将于今晚 24 点开始，请提前下线。', 26],
      ['customer', '我是说扣款了没到账！', 60],
      ['agent', '感谢您的支持，祝您游戏愉快。', 88],
    ],
  },
  {
    sid: 'OT-03',
    tags: ['off_topic'],
    evidence: { off_topic: 2 },
    complexity: 'explicit',
    needsReview: false,
    emotion: 'anxious',
    summary: '用户咨询账号被盗找回，坐席以领取新手礼包话术回应，判定答非所问。',
    note: '坐席未回应账号找回诉求，改用礼包推广，命中 off_topic，证据 seq=2。',
    msgs: [
      ['customer', '账号被盗了，怎么找回？', 0],
      ['agent', '您可以关注我们的公众号，领取新手礼包。', 22],
      ['customer', '我不是要礼包，账号被盗了。', 52],
      ['agent', '新手礼包里面有钻石和体力哦。', 76],
    ],
  },
  {
    sid: 'OT-04',
    tags: ['off_topic'],
    evidence: { off_topic: 4 },
    complexity: 'implicit',
    needsReview: true,
    emotion: 'anxious',
    summary: '用户询问退款可行性，坐席收集信息后直接结束会话未回答问题，需人工复核答非所问。',
    note: '边界样本：连续两轮未回应用户退款核心诉求、直接结束语，命中 off_topic，证据 seq=4。',
    msgs: [
      ['customer', '我想问下，充值的钱能退吗？', 0],
      ['agent', '请提供一下您的角色名和区服。', 24],
      ['customer', '角色名 夜航星，区服 S12，我是想问退款。', 58],
      ['agent', '感谢您的支持，祝您游戏愉快，再见。', 92],
    ],
  },
  {
    sid: 'OT-05',
    tags: ['off_topic'],
    evidence: { off_topic: 2 },
    complexity: 'explicit',
    needsReview: false,
    emotion: 'calm',
    summary: '用户询问客服电话，坐席以首充礼包推广回应，判定答非所问。',
    note: '坐席未提供客服电话，改用礼包推广，命中 off_topic，证据 seq=2。',
    msgs: [
      ['customer', '你们客服电话是多少？', 0],
      ['agent', '您看一下首充礼包，充 6 元可以领限定时装。', 18],
      ['customer', '我要客服电话，不是礼包。', 48],
      ['agent', '限定时装很划算的哦。', 72],
    ],
  },
  // ---------------- wrong_knowledge 单标签（5）----------------
  {
    sid: 'WK-01',
    tags: ['wrong_knowledge'],
    evidence: { wrong_knowledge: 2 },
    complexity: 'explicit',
    needsReview: false,
    emotion: 'anxious',
    summary: '用户咨询退款手续费，坐席错误陈述 20% 费率，判定知识错误。',
    note: '知识库退款规则为不收取手续费，坐席错误陈述「退款手续费是 20%」，命中 wrong_knowledge，证据 seq=2。',
    msgs: [
      ['customer', '我多充了一笔，能退款吗？会收手续费吗？', 0],
      ['agent', '退款手续费是 20%，这个是公司规定。', 26],
      ['customer', '20%？这么多？', 58],
      ['agent', '对，退款都要扣，您确定要退吗？', 78],
    ],
  },
  {
    sid: 'WK-02',
    tags: ['wrong_knowledge'],
    evidence: { wrong_knowledge: 2 },
    complexity: 'explicit',
    needsReview: false,
    emotion: 'calm',
    summary: '用户咨询首充返利比例，坐席错误陈述为 300%，判定知识错误。',
    note: '官方首充规则为返还 100% 等值钻石，坐席错误陈述「300%」，命中 wrong_knowledge，证据 seq=2。',
    msgs: [
      ['customer', '首充双倍返利到底返多少？', 0],
      ['agent', '首充双倍返利是返 300% 的钻石，很划算。', 24],
      ['customer', '真的假的？', 46],
      ['agent', '是的，充多少返多少，上限也很高。', 66],
    ],
  },
  {
    sid: 'WK-03',
    tags: ['wrong_knowledge'],
    evidence: { wrong_knowledge: 2 },
    complexity: 'implicit',
    needsReview: true,
    emotion: 'calm',
    summary: '用户询问新版本上线时间，坐席给出与官方公告冲突的时间，需人工复核知识错误。',
    note: '边界样本：坐席称「11 月 30 日上线」与官方公告 12 月上线冲突，命中 wrong_knowledge，证据 seq=2，需人工复核。',
    msgs: [
      ['customer', '新版本 3.0 什么时候上线？', 0],
      ['agent', '新版本 3.0 会在 11 月 30 日上线，已经定档了。', 22],
      ['customer', '我看公告写的是 12 月？', 52],
      ['agent', '公告是旧的，以我说的为准。', 72],
    ],
  },
  {
    sid: 'WK-04',
    tags: ['wrong_knowledge'],
    evidence: { wrong_knowledge: 2 },
    complexity: 'implicit',
    needsReview: true,
    emotion: 'anxious',
    summary: '用户咨询退款到账时间，坐席给出错误时长，需人工复核知识错误。',
    note: '边界样本：官方规则为 24 小时内原路退回，坐席错误陈述「7 个工作日」，命中 wrong_knowledge，证据 seq=2，需人工复核。',
    msgs: [
      ['customer', '退款提交后多久到账？', 0],
      ['agent', '退款要 7 个工作日才能到账，走银行流程。', 24],
      ['customer', '这么久吗？', 50],
      ['agent', '对，最快也是 7 个工作日。', 66],
    ],
  },
  {
    sid: 'WK-05',
    tags: ['wrong_knowledge'],
    evidence: { wrong_knowledge: 2 },
    complexity: 'explicit',
    needsReview: false,
    emotion: 'calm',
    summary: '用户咨询活动免费抽卡次数，坐席错误陈述为每天 2 次，判定知识错误。',
    note: '官方活动规则为每天 1 次免费抽卡，坐席错误陈述「每天 2 次免费抽卡」，命中 wrong_knowledge，证据 seq=2。',
    msgs: [
      ['customer', '活动每天能免费抽几次卡？', 0],
      ['agent', '活动期间每天 2 次免费抽卡，凌晨 5 点刷新。', 22],
      ['customer', '公告写的是 1 次啊。', 50],
      ['agent', '那是给新人的，老玩家是 2 次。', 70],
    ],
  },
  // ---------------- timeout 单标签（4）----------------
  {
    sid: 'TO-01',
    tags: ['timeout'],
    evidence: { timeout: 4 },
    complexity: 'explicit',
    needsReview: false,
    emotion: 'anxious',
    summary: '用户查询订单发货情况，坐席第二次回复间隔 245 秒，判定响应超时。',
    note: '坐席回复间隔 245s（>180s），命中 timeout，证据 seq=4（与 seq=3 的 atSec 差值 245s）。',
    msgs: [
      ['customer', '你好，我想查一下我的订单有没有发货。', 0],
      ['agent', '稍等，我帮您查一下。', 35],
      ['customer', '好的。', 60],
      ['agent', '查到了，订单已经发货，物流单号 SF****8821。', 305],
      ['customer', '好的，谢谢。', 340],
    ],
  },
  {
    sid: 'TO-02',
    tags: ['timeout'],
    evidence: { timeout: 4 },
    complexity: 'explicit',
    needsReview: false,
    emotion: 'anxious',
    summary: '用户求助密码重置，坐席回复间隔 370 秒，判定响应超时。',
    note: '坐席回复间隔 370s（>180s），命中 timeout，证据 seq=4（与 seq=3 的 atSec 差值 370s）。',
    msgs: [
      ['customer', '我账号登录提示密码错误，重置了好几遍还是不行。', 0],
      ['agent', '您好，请提供账号 ID。', 24],
      ['customer', 'ID 是 882177。', 50],
      ['agent', '已经帮您重置密码，请用新密码登录。', 420],
      ['customer', '好了，谢谢。', 455],
    ],
  },
  {
    sid: 'TO-03',
    tags: ['timeout'],
    evidence: { timeout: 4 },
    complexity: 'explicit',
    needsReview: false,
    emotion: 'anxious',
    summary: '用户申请换绑邮箱，坐席首次响应间隔 520 秒，判定响应超时。',
    note: '坐席回复间隔 520s（>180s），命中 timeout，证据 seq=4（与 seq=3 的 atSec 差值 520s）。',
    msgs: [
      ['customer', '我想改一下绑定邮箱。', 0],
      ['agent', '请提供原邮箱和新邮箱。', 20],
      ['customer', '原邮箱 u***21@example.com，新邮箱 u***88@example.com。', 55],
      ['agent', '好的，正在为您处理。', 575],
      ['customer', '好了吗？', 600],
      ['agent', '已经修改成功。', 620],
    ],
  },
  {
    sid: 'TO-04',
    tags: ['timeout'],
    evidence: { timeout: 4 },
    complexity: 'explicit',
    needsReview: false,
    emotion: 'anxious',
    summary: '用户催活动奖励补发，坐席核实回复间隔 208 秒，判定响应超时。',
    note: '坐席回复间隔 208s（>180s），命中 timeout，证据 seq=4（与 seq=3 的 atSec 差值 208s）。',
    msgs: [
      ['customer', '这个活动奖励怎么还没发？', 0],
      ['agent', '稍等，我核实一下。', 18],
      ['customer', '嗯。', 40],
      ['agent', '核实完了，奖励会在 24 小时内补发。', 248],
      ['customer', '好。', 270],
    ],
  },
  // ---------------- escalation 单标签（4）----------------
  {
    sid: 'ESC-01',
    tags: ['escalation'],
    evidence: { escalation: 5 },
    complexity: 'explicit',
    needsReview: false,
    emotion: 'angry',
    summary: '用户礼包未收到，坐席机械答复后用户由平静转为愤怒并投诉，判定情绪升级。',
    note: '用户明确表示「我要投诉」，情绪由平静转愤怒，命中 escalation，证据 seq=5。',
    msgs: [
      ['customer', '你好，我买的礼包没收到。', 0],
      ['agent', '您好，请提供订单号。', 22],
      ['customer', 'SO2026****3344。', 50],
      ['agent', '订单显示已发放，请在背包查看。', 76],
      ['customer', '背包真的没有，你们是不是在骗人？我要投诉！', 108],
      ['agent', '我再帮您核实一下，请稍等。', 130],
    ],
  },
  {
    sid: 'ESC-02',
    tags: ['escalation'],
    evidence: { escalation: 3 },
    complexity: 'explicit',
    needsReview: false,
    emotion: 'angry',
    summary: '用户申诉角色封禁无回应，升级为 12315 投诉威胁，判定情绪升级。',
    note: '用户提及「12315 投诉」，命中 escalation，证据 seq=3。',
    msgs: [
      ['customer', '我的角色被误封了，怎么回事？', 0],
      ['agent', '您好，封禁原因需要人工审核，请提交申诉。', 26],
      ['customer', '我提交了三次都没人理，我要去 12315 投诉你们。', 62],
      ['agent', '申诉会按顺序处理，请您耐心等待。', 90],
    ],
  },
  {
    sid: 'ESC-03',
    tags: ['escalation'],
    evidence: { escalation: 3 },
    complexity: 'explicit',
    needsReview: false,
    emotion: 'angry',
    summary: '用户反馈版本 bug 长期未修，升级为媒体曝光威胁，判定情绪升级。',
    note: '用户提及「媒体曝光」，命中 escalation，证据 seq=3。',
    msgs: [
      ['customer', '这个新版本的 bug 修复了吗？', 0],
      ['agent', '已反馈给技术团队，正在处理中。', 24],
      ['customer', '处理一周了还没好，我直接去媒体曝光你们。', 58],
      ['agent', '非常抱歉，我会帮您加急反馈。', 84],
    ],
  },
  {
    sid: 'ESC-04',
    tags: ['escalation'],
    evidence: { escalation: 3 },
    complexity: 'explicit',
    needsReview: false,
    emotion: 'angry',
    summary: '用户充值未到账，坐席重复模板答复后用户提及退游与曝光，判定情绪升级。',
    note: '用户提及「退游」「曝光」，命中 escalation，证据 seq=3。',
    msgs: [
      ['customer', '客服，我的充值没到账。', 0],
      ['agent', '已经提交补单，预计 24 小时内到账。', 26],
      ['customer', '每次都这么说，不解决我就退游，还要去论坛曝光。', 60],
      ['agent', '理解您的心情，我会继续跟进。', 88],
    ],
  },
  // ---------------- 多标签（10）----------------
  {
    sid: 'M-ATT-ESC-01',
    tags: ['attitude', 'escalation'],
    evidence: { attitude: 4, escalation: 5 },
    complexity: 'explicit',
    needsReview: false,
    emotion: 'angry',
    summary: '坐席嘲讽用户付款操作，用户被激怒表示投诉，判定态度违规并情绪升级。',
    note: '坐席「您自己付款的时候不会看一下订单吗」命中 attitude（seq=4）；用户「我要投诉你」命中 escalation（seq=5）。primaryTag=attitude（25>20）。',
    msgs: [
      ['customer', '我的订单多扣了一次钱，帮我处理下。', 0],
      ['agent', '您好，请提供订单号。', 20],
      ['customer', 'SO2026****7711。', 46],
      ['agent', '您自己付款的时候不会看一下订单吗？', 80],
      ['customer', '你这是什么意思？我要投诉你！', 112],
      ['agent', '投诉就投诉，随便。', 130],
    ],
  },
  {
    sid: 'M-ATT-ESC-02',
    tags: ['attitude', 'escalation'],
    evidence: { attitude: 4, escalation: 5 },
    complexity: 'explicit',
    needsReview: false,
    emotion: 'angry',
    summary: '坐席以「爱信不信」怼用户，用户升级为 12315 投诉，判定态度违规并情绪升级。',
    note: '坐席「你爱信不信」命中 attitude（seq=4）；用户「去 12315 投诉」命中 escalation（seq=5）。primaryTag=attitude。',
    msgs: [
      ['customer', '麻烦帮我查一下礼包为什么没发。', 0],
      ['agent', '查不了，系统没显示。', 18],
      ['customer', '那能不能转人工帮忙看看？', 46],
      ['agent', '我就是人工，你爱信不信。', 72],
      ['customer', '行，我去 12315 投诉。', 100],
    ],
  },
  {
    sid: 'M-ATT-ESC-03',
    tags: ['attitude', 'escalation'],
    evidence: { attitude: 2, escalation: 5 },
    complexity: 'explicit',
    needsReview: false,
    emotion: 'angry',
    summary: '坐席反问用户让其反思，用户表示找领导投诉，判定态度违规并情绪升级。',
    note: '坐席「不会反思一下」命中 attitude（seq=2）；用户「找你们领导投诉」命中 escalation（seq=5）。primaryTag=attitude。',
    msgs: [
      ['customer', '我这个月已经找了三次客服了，问题还没解决。', 0],
      ['agent', '那您自己不会反思一下是不是操作有问题？', 22],
      ['customer', '我操作没问题，你们就是不解决！', 50],
      ['agent', '随便您，反正我说了没问题。', 76],
      ['customer', '我要找你们领导投诉。', 100],
    ],
  },
  {
    sid: 'M-FRB-ESC-01',
    tags: ['forbidden', 'escalation'],
    evidence: { forbidden: 2, escalation: 5 },
    complexity: 'explicit',
    needsReview: false,
    emotion: 'angry',
    summary: '坐席强迫用户给好评并索要截图，用户表示投诉，判定违规话术并情绪升级。',
    note: '坐席「五星好评」「截图发我」命中 forbidden（seq=2）；用户「投诉到平台」命中 escalation（seq=5）。primaryTag=forbidden。',
    msgs: [
      ['customer', '问题已经解决了，谢谢。', 0],
      ['agent', '那麻烦您去评价一下，给个五星好评，截图发我。', 20],
      ['customer', '凭什么要给好评？不给我就不处理了？', 50],
      ['agent', '这是我们的考核，您配合一下嘛。', 72],
      ['customer', '你们这是强迫好评，我要投诉到平台。', 96],
    ],
  },
  {
    sid: 'M-FRB-ESC-02',
    tags: ['forbidden', 'escalation'],
    evidence: { forbidden: 2, escalation: 5 },
    complexity: 'implicit',
    needsReview: true,
    emotion: 'angry',
    summary: '坐席引导私下转账走内部渠道，用户意识到风险后表示曝光，需人工复核违规话术与情绪升级。',
    note: '边界样本：坐席「私下转账 300 给我」「内部渠道」命中 forbidden（seq=2）；用户「曝光你们这种行为」命中 escalation（seq=5）。primaryTag=forbidden。',
    msgs: [
      ['customer', '我的号能卖吗？', 0],
      ['agent', '官方不让交易，但您私下转账 300 给我，我帮您走内部渠道转。', 24],
      ['customer', '还要私下转账？你们不会是骗子吧。', 54],
      ['agent', '放心，我这边操作很多次了。', 74],
      ['customer', '我不转了，我要去曝光你们这种行为。', 98],
    ],
  },
  {
    sid: 'M-OT-TO-01',
    tags: ['off_topic', 'timeout'],
    evidence: { off_topic: 2, timeout: 4 },
    complexity: 'explicit',
    needsReview: false,
    emotion: 'anxious',
    summary: '用户催退款进度，坐席以活动推广回避且回复间隔 236 秒，判定答非所问并响应超时。',
    note: '坐席以活动推广回避退款诉求，命中 off_topic（seq=2）；回复间隔 236s（>180s），命中 timeout（seq=4）。primaryTag=off_topic（15>10）。',
    msgs: [
      ['customer', '你好，我申请的退款审核到哪一步了？', 0],
      ['agent', '您好，我们最近上线了新活动，欢迎体验。', 30],
      ['customer', '我问退款进度。', 64],
      ['agent', '活动期间充值有双倍奖励哦。', 300],
      ['customer', '能不能好好回答我的问题？', 335],
      ['agent', '请您关注官方公告。', 355],
    ],
  },
  {
    sid: 'M-OT-TO-02',
    tags: ['off_topic', 'timeout'],
    evidence: { off_topic: 4, timeout: 4 },
    complexity: 'implicit',
    needsReview: true,
    emotion: 'anxious',
    summary: '用户追问账号限制原因，坐席回避并回复超时，需人工复核答非所问与超时。',
    note: '边界样本：坐席以活动规则回避限制原因，命中 off_topic（seq=4）；回复间隔 215s（>180s），命中 timeout（seq=4）。primaryTag=off_topic。',
    msgs: [
      ['customer', '我的账号被限制了，说自己看公告，公告在哪？', 0],
      ['agent', '您好，请提供您的角色 ID。', 22],
      ['customer', 'ID 7731，我问的是限制原因。', 55],
      ['agent', '这边建议您先看活动规则，感谢您的支持。', 270],
      ['customer', '你们就这样敷衍？', 300],
    ],
  },
  {
    sid: 'M-ESC-TO-01',
    tags: ['escalation', 'timeout'],
    evidence: { escalation: 5, timeout: 6 },
    complexity: 'explicit',
    needsReview: false,
    emotion: 'angry',
    summary: '用户催申诉结果并情绪升级，坐席回复间隔 210 秒，判定情绪升级并响应超时。',
    note: '用户「我要投诉」命中 escalation（seq=5）；坐席回复间隔 210s（>180s），命中 timeout（seq=6）。primaryTag=escalation（20>10）。',
    msgs: [
      ['customer', '我提交的申诉三天没回复了。', 0],
      ['agent', '请提供申诉单号。', 20],
      ['customer', 'AP-2026-****771。', 48],
      ['agent', '帮您查询一下。', 70],
      ['customer', '都 5 分钟了，你们效率太低了，我要投诉！', 120],
      ['agent', '查询到处理结果，已通过。', 330],
    ],
  },
  {
    sid: 'M-WK-ESC-01',
    tags: ['wrong_knowledge', 'escalation'],
    evidence: { wrong_knowledge: 2, escalation: 5 },
    complexity: 'explicit',
    needsReview: false,
    emotion: 'angry',
    summary: '坐席错误陈述退款手续费，用户不满乱收费并投诉，判定知识错误并情绪升级。',
    note: '坐席「退款手续费是 20%」命中 wrong_knowledge（seq=2）；用户「我要投诉你们」命中 escalation（seq=5）。primaryTag=wrong_knowledge（25>20）。',
    msgs: [
      ['customer', '我多充的 328 能退吗？', 0],
      ['agent', '可以退，但是退款手续费是 20%。', 24],
      ['customer', '你们之前说退款免费，现在扣 20%？', 54],
      ['agent', '这是系统自动扣的，我们也没办法。', 78],
      ['customer', '乱收费，我要投诉你们！', 104],
    ],
  },
  {
    sid: 'M-WK-OT-01',
    tags: ['wrong_knowledge', 'off_topic'],
    evidence: { wrong_knowledge: 2, off_topic: 4 },
    complexity: 'implicit',
    needsReview: true,
    emotion: 'anxious',
    summary: '坐席给出错误退款时长，用户追问细节时坐席回避，需人工复核知识错误与答非所问。',
    note: '边界样本：坐席「7 个工作日」命中 wrong_knowledge（seq=2）；用户追问后坐席以「关注公告」回避，命中 off_topic（seq=4）。primaryTag=wrong_knowledge。',
    msgs: [
      ['customer', '我申请退款了，钱多久能到？', 0],
      ['agent', '退款一般要 7 个工作日。', 22],
      ['customer', '能不能具体一点，是 7 个自然日还是工作日？', 54],
      ['agent', '您先关注游戏内公告吧，公告里都有。', 82],
    ],
  },
  // ---------------- 正常样本 pass（20）----------------
  {
    sid: 'P-01',
    tags: [],
    evidence: {},
    complexity: 'explicit',
    needsReview: false,
    emotion: 'calm',
    summary: '用户查询充值到账，坐席核实订单并说明补发，问题解决，无违规。',
    note: '正常样本：坐席按流程核实并告知补发，无违规标签。',
    msgs: [
      ['customer', '你好，我昨天充值的 648 显示成功，但游戏里没收到钻石，能帮我查一下吗？', 0],
      ['agent', '您好，请提供一下订单号或支付流水号。', 26],
      ['customer', '订单号 SO2026****2210。', 58],
      ['agent', '查到了，这笔订单因为支付渠道延迟，已经补发到账，请在邮件里领取。', 92],
      ['customer', '收到了，谢谢。', 118],
    ],
  },
  {
    sid: 'P-02',
    tags: [],
    evidence: {},
    complexity: 'explicit',
    needsReview: false,
    emotion: 'calm',
    summary: '用户咨询换绑手机号，坐席告知材料与流程，无违规。',
    note: '正常样本：坐席给出换绑所需材料与办理路径，无违规标签。',
    msgs: [
      ['customer', '我想换绑手机号，原来的号码不用了。', 0],
      ['agent', '您好，换绑需要先完成实名验证，我这边帮您发起流程。', 24],
      ['customer', '需要准备什么材料？', 52],
      ['agent', '请提供身份证后四位和最近一笔充值订单号即可。', 80],
      ['customer', '好的，稍后提供。', 104],
    ],
  },
  {
    sid: 'P-03',
    tags: [],
    evidence: {},
    complexity: 'implicit',
    needsReview: true,
    emotion: 'anxious',
    summary: '用户催活动奖励发放，坐席核实补发时间并安抚，需人工复核是否构成违规。',
    note: '边界正常样本：用户略带焦虑，坐席按规则说明发放时间并承诺补发，未出现违规话术，需人工复核是否判违规。',
    msgs: [
      ['customer', '活动奖励我等了两天还没发，有点着急。', 0],
      ['agent', '您好，本次活动奖励在活动结束后 24 小时内统一发放，我帮您确认一下。', 28],
      ['customer', '好的，麻烦帮我看看。', 56],
      ['agent', '已确认您的奖励会在今天 18 点前补发，请留意邮件。', 84],
      ['customer', '好的，那我等等。', 110],
    ],
  },
  {
    sid: 'P-04',
    tags: [],
    evidence: {},
    complexity: 'explicit',
    needsReview: false,
    emotion: 'calm',
    summary: '用户咨询新版本上线时间与内容，坐席按公告回答，无违规。',
    note: '正常样本：坐席回答版本时间与内容，未出现知识错误，无违规标签。',
    msgs: [
      ['customer', '新版本什么时候上线？', 0],
      ['agent', '您好，3.0 版本计划在 11 月 5 日 10 点上线，更新公告已发在官网。', 20],
      ['customer', '好的，会有什么新内容？', 44],
      ['agent', '会开放新地图和新的副本玩法，具体可以看官网公告。', 70],
      ['customer', '好的，谢谢。', 94],
    ],
  },
  {
    sid: 'P-05',
    tags: [],
    evidence: {},
    complexity: 'implicit',
    needsReview: true,
    emotion: 'anxious',
    summary: '用户咨询多充退款规则，坐席说明不收费与到账时间，需人工复核是否构成违规。',
    note: '边界正常样本：坐席如实说明退款不收取手续费、24 小时内原路退回，未出现错误承诺，需人工复核。',
    msgs: [
      ['customer', '我多充了一笔，能退款吗？', 0],
      ['agent', '您好，未消耗的钻石可以申请退款，原路退回，24 小时内到账。', 24],
      ['customer', '那手续费怎么算？', 54],
      ['agent', '退款不收取手续费，您可以在充值记录里提交申请。', 80],
      ['customer', '好的，我去试试。', 104],
    ],
  },
  {
    sid: 'P-06',
    tags: [],
    evidence: {},
    complexity: 'explicit',
    needsReview: false,
    emotion: 'calm',
    summary: '用户礼包码兑换失败，坐席核对后补发新码，问题解决，无违规。',
    note: '正常样本：坐席核对礼包码并补发，处理闭环，无违规标签。',
    msgs: [
      ['customer', '礼包码兑换失败，提示无效。', 0],
      ['agent', '您好，请提供礼包码，我帮您核对格式。', 22],
      ['customer', 'GIFT-9K2M-****。', 50],
      ['agent', '这个码已经过期了，我给您补发一个新的礼包码：NEW-****-8821。', 78],
      ['customer', '兑换成功了，谢谢。', 104],
    ],
  },
  {
    sid: 'P-07',
    tags: [],
    evidence: {},
    complexity: 'explicit',
    needsReview: false,
    emotion: 'calm',
    summary: '用户误删角色求助恢复，坐席提交恢复申请并告知完成时间，无违规。',
    note: '正常样本：坐席按规则说明恢复时限并提交申请，无违规标签。',
    msgs: [
      ['customer', '我不小心把角色删除了，还能恢复吗？', 0],
      ['agent', '您好，角色删除后 7 天内可以申请恢复，我帮您提交。', 24],
      ['customer', '好的，麻烦快点。', 50],
      ['agent', '已经提交恢复申请，预计 10 分钟内完成，请重新登录查看。', 78],
      ['customer', '恢复好了，谢谢。', 106],
    ],
  },
  {
    sid: 'P-08',
    tags: [],
    evidence: {},
    complexity: 'explicit',
    needsReview: false,
    emotion: 'calm',
    summary: '用户跨服匹配不到人，坐席排查网络并重置队列，无违规。',
    note: '正常样本：坐席给出排查步骤与后续路径，无违规标签。',
    msgs: [
      ['customer', '跨服匹配一直匹配不到人。', 0],
      ['agent', '您好，请确认网络正常，我这边帮您重新排队试试。', 24],
      ['customer', '网络没问题。', 50],
      ['agent', '已为您重置匹配队列，请稍后再试，如果还不行可以提交工单。', 78],
    ],
  },
  {
    sid: 'P-09',
    tags: [],
    evidence: {},
    complexity: 'explicit',
    needsReview: false,
    emotion: 'calm',
    summary: '用户查询工单进度，坐席查询并告知处理人与预计时间，无违规。',
    note: '正常样本：坐席提供工单进度与预计回复时间，无违规标签。',
    msgs: [
      ['customer', '我提交的工单现在什么进度？', 0],
      ['agent', '您好，请提供工单号，我帮您查询。', 20],
      ['customer', 'TK-2026-****331。', 46],
      ['agent', '工单已分配处理人，预计今天 18 点前回复，您可以留意站内消息。', 74],
    ],
  },
  {
    sid: 'P-10',
    tags: [],
    evidence: {},
    complexity: 'explicit',
    needsReview: false,
    emotion: 'calm',
    summary: '用户咨询换绑邮箱，坐席走人工审核流程并告知时限，无违规。',
    note: '正常样本：坐席说明人工审核所需信息与时限，无违规标签。',
    msgs: [
      ['customer', '我想换绑邮箱，但是原邮箱登不上了。', 0],
      ['agent', '您好，这种情况需要人工审核，请提供账号 ID 和最近充值记录。', 24],
      ['customer', '账号 ID 882177，最近充值 328 元。', 52],
      ['agent', '已提交人工审核，预计 2 小时内处理完成。', 78],
    ],
  },
  {
    sid: 'P-11',
    tags: [],
    evidence: {},
    complexity: 'implicit',
    needsReview: true,
    emotion: 'anxious',
    summary: '用户反馈游戏卡顿，坐席排查并给出优化建议，需人工复核是否构成违规。',
    note: '边界正常样本：用户抱怨卡顿但坐席积极排查并记录反馈，无违规话术，需人工复核。',
    msgs: [
      ['customer', '游戏最近有点卡，打副本总掉帧。', 0],
      ['agent', '您好，方便提供一下机型和系统版本吗？我帮您排查。', 24],
      ['customer', '手机是某品牌旗舰，系统最新版本。', 52],
      ['agent', '建议您在设置里关闭高帧率选项，我这边也帮您记录反馈给技术团队。', 80],
      ['customer', '好多了，谢谢。', 106],
    ],
  },
  {
    sid: 'P-12',
    tags: [],
    evidence: {},
    complexity: 'implicit',
    needsReview: true,
    emotion: 'calm',
    summary: '用户举报外挂，坐席记录并说明核验流程，需人工复核是否构成违规。',
    note: '边界正常样本：用户提及外挂但坐席按流程受理举报，未出现违规话术，需人工复核。',
    msgs: [
      ['customer', '你好，我想举报一个外挂，竞技场里有人开自动瞄准。', 0],
      ['agent', '您好，感谢举报，请提供对方角色名和区服，我帮您提交核验。', 26],
      ['customer', '角色名 影刃，区服 S03。', 54],
      ['agent', '已提交核验，核实后会按规则处理，处理结果会通过站内信通知您。', 82],
      ['customer', '好的，谢谢。', 108],
    ],
  },
  {
    sid: 'P-13',
    tags: [],
    evidence: {},
    complexity: 'explicit',
    needsReview: false,
    emotion: 'calm',
    summary: '用户咨询充值档位与首充规则，坐席准确说明，无违规。',
    note: '正常样本：坐席准确说明档位与首充双倍规则，无错误陈述，无违规标签。',
    msgs: [
      ['customer', '充值都有哪些档位？', 0],
      ['agent', '您好，目前有 6 元、30 元、98 元、328 元、648 元五档，首充双倍返利。', 24],
      ['customer', '首充双倍是每个档位都有吗？', 50],
      ['agent', '首充双倍仅限首次购买的第一个档位，您可以在充值页面看到标识。', 78],
    ],
  },
  {
    sid: 'P-14',
    tags: [],
    evidence: {},
    complexity: 'explicit',
    needsReview: false,
    emotion: 'calm',
    summary: '用户反馈活动奖励漏发，坐席核实后补发，无违规。',
    note: '正常样本：坐席核实漏发并补发邮件，处理闭环，无违规标签。',
    msgs: [
      ['customer', '我的活动奖励好像漏发了，少了一个宝箱。', 0],
      ['agent', '您好，我帮您核对活动进度和发放记录。', 22],
      ['customer', '好的。', 46],
      ['agent', '确认漏发，已经为您补发到邮件，请查收。', 72],
      ['customer', '收到了，谢谢。', 96],
    ],
  },
  {
    sid: 'P-15',
    tags: [],
    evidence: {},
    complexity: 'explicit',
    needsReview: false,
    emotion: 'calm',
    summary: '用户咨询月卡续费规则，坐席准确说明不自动续费，无违规。',
    note: '正常样本：坐席准确说明月卡不自动续费及续费入口，无违规标签。',
    msgs: [
      ['customer', '月卡到期会自动续费吗？', 0],
      ['agent', '您好，月卡不会自动续费，到期后需要手动购买。', 22],
      ['customer', '那到期后还有购买入口吗？', 46],
      ['agent', '有的，在商城月卡页面可以随时续费。', 70],
      ['customer', '好的，知道了。', 94],
    ],
  },
  {
    sid: 'P-16',
    tags: [],
    evidence: {},
    complexity: 'explicit',
    needsReview: false,
    emotion: 'calm',
    summary: '用户咨询官方客服电话，坐席提供热线与服务时间，无违规。',
    note: '正常样本：坐席提供官方热线与服务时间，无违规标签。',
    msgs: [
      ['customer', '你们官方客服电话是多少？', 0],
      ['agent', '您好，官方客服热线是 400-****-1234，服务时间是每天 9 点到 21 点。', 22],
      ['customer', '好的，谢谢。', 46],
      ['agent', '不客气，有问题也可以随时在游戏内提交工单。', 70],
    ],
  },
  {
    sid: 'P-17',
    tags: [],
    evidence: {},
    complexity: 'explicit',
    needsReview: false,
    emotion: 'calm',
    summary: '用户收到异地登录短信，坐席提供账号安全处置建议，无违规。',
    note: '正常样本：坐席提示修改密码与开启二次验证，无违规标签。',
    msgs: [
      ['customer', '收到短信说我账号异地登录，是真的吗？', 0],
      ['agent', '您好，请勿点击短信中的链接，建议您立即修改密码并开启二次验证。', 24],
      ['customer', '好的，我现在去改。', 50],
      ['agent', '修改完成后可以在安全中心查看登录记录，有问题随时联系我们。', 78],
    ],
  },
  {
    sid: 'P-18',
    tags: [],
    evidence: {},
    complexity: 'explicit',
    needsReview: false,
    emotion: 'calm',
    summary: '新玩家咨询新手指引位置，坐席给出操作路径，无违规。',
    note: '正常样本：坐席说明新手指引入口，无违规标签。',
    msgs: [
      ['customer', '刚下载游戏，新手指引在哪？', 0],
      ['agent', '您好，完成创建角色后会自动进入新手指引，也可以在主界面右侧点击指引按钮。', 24],
      ['customer', '找到了，谢谢。', 48],
      ['agent', '不客气，祝您游戏愉快。', 70],
    ],
  },
  {
    sid: 'P-19',
    tags: [],
    evidence: {},
    complexity: 'implicit',
    needsReview: true,
    emotion: 'calm',
    summary: '用户对新地图提出建议，坐席记录并反馈，需人工复核是否构成违规。',
    note: '边界正常样本：用户表达「玩腻了」的负面表述但属建议，坐席记录反馈，无违规话术，需人工复核。',
    msgs: [
      ['customer', '希望以后能多出点新地图，现在的地图有点玩腻了。', 0],
      ['agent', '感谢建议，我会记录并反馈给策划团队，您可以关注后续版本公告。', 24],
      ['customer', '好的，期待。', 48],
      ['agent', '感谢您的支持，祝您游戏愉快。', 70],
    ],
  },
  {
    sid: 'P-20',
    tags: [],
    evidence: {},
    complexity: 'explicit',
    needsReview: false,
    emotion: 'calm',
    summary: '客服回访确认用户问题已解决，用户表示满意，无违规。',
    note: '正常样本：回访确认问题已解决，无违规标签。',
    msgs: [
      ['agent', '您好，这里是客服回访，想了解一下您上次的问题是否已经解决？', 0],
      ['customer', '解决了，处理得挺快的。', 24],
      ['agent', '好的，感谢您的反馈，如果还有其他问题可以随时联系我们。', 48],
      ['customer', '好的，谢谢。', 72],
    ],
  },
  // ---------------- 舆情评论场景（120 条，16 个 topic×date 簇）----------------
];

// 舆情簇：同一簇 = 同一 topic 同一天围绕同一事件；簇内负面数决定聚合级别
// （007 §5：负面>=8 -> P0；3-7 -> >=P1；1-2 -> >=P2；0 -> none）。
// 单条级别再按 007 §6.1 判定，簇级别 = max(单条 max, 聚合级别)。
const SENTIMENT_CLUSTERS = [
  // P2-1 版本 2026-10-20 星海远征：2 负面（实体 P2）+ 2 正面 + 2 中性 -> P2
  {
    key: 'P2-版本-2026-10-20',
    topic: '版本',
    date: '2026-10-20',
    brand: '星海远征',
    level: 'P2',
    comments: [
      { sentiment: 'negative', level: 'P2', topics: ['版本'], text: '新版本界面颜色有点刺眼，看久了不舒服。' },
      { sentiment: 'negative', level: 'P2', topics: ['版本'], text: '版本更新后背景音乐换了，还是旧版好听。' },
      { sentiment: 'positive', level: 'none', topics: ['版本'], text: '版本更新的新地图很好看，喜欢。' },
      { sentiment: 'positive', level: 'none', topics: ['版本'], text: '这次版本内容挺丰富的，玩得开心。' },
      { sentiment: 'neutral', level: 'none', topics: ['版本'], text: '想问下版本号在哪里查看？' },
      { sentiment: 'neutral', level: 'none', topics: ['版本'], text: '版本更新公告一般发在哪里？' },
    ],
  },
  // none-1 其他 2026-10-20 机甲前线：6 条噪声（广告/灌水）-> none
  {
    key: 'none-其他-2026-10-20',
    topic: '其他',
    date: '2026-10-20',
    brand: '机甲前线',
    level: 'none',
    comments: [
      { sentiment: 'neutral', level: 'none', noise: true, topics: ['其他'], text: '代练上分，价格优惠，需要的私聊。' },
      { sentiment: 'neutral', level: 'none', noise: true, topics: ['其他'], text: '高战账号出租，日结，有意者联系。' },
      { sentiment: 'neutral', level: 'none', noise: true, topics: ['其他'], text: '打卡，占楼，混个脸熟。' },
      { sentiment: 'neutral', level: 'none', noise: true, topics: ['其他'], text: '前排围观，这帖子有点意思。' },
      { sentiment: 'neutral', level: 'none', noise: true, topics: ['其他'], text: '666666，顶一个。' },
      { sentiment: 'neutral', level: 'none', noise: true, topics: ['其他'], text: '出售游戏币，量大从优，非诚勿扰。' },
    ],
  },
  // none-2 活动 2026-10-21 云上大陆：3 正面 + 3 中性 -> none
  {
    key: 'none-活动-2026-10-21',
    topic: '活动',
    date: '2026-10-21',
    brand: '云上大陆',
    level: 'none',
    comments: [
      { sentiment: 'positive', level: 'none', topics: ['活动'], text: '这次活动奖励很丰厚，满意。' },
      { sentiment: 'positive', level: 'none', topics: ['活动'], text: '活动玩法挺有意思，玩得很开心。' },
      { sentiment: 'positive', level: 'none', topics: ['活动'], text: '活动福利给力，点赞。' },
      { sentiment: 'neutral', level: 'none', topics: ['活动'], text: '活动什么时候开始？' },
      { sentiment: 'neutral', level: 'none', topics: ['活动'], text: '想问下活动奖励有哪些？' },
      { sentiment: 'neutral', level: 'none', topics: ['活动'], text: '活动页面在哪里进入？' },
    ],
  },
  // P1-1 版本 2026-10-22 星海远征：4 负面（2 P1 + 2 P2）+ 3 正面 + 1 中性 -> P1
  {
    key: 'P1-版本-2026-10-22',
    topic: '版本',
    date: '2026-10-22',
    brand: '星海远征',
    level: 'P1',
    comments: [
      { sentiment: 'negative', level: 'P1', topics: ['版本', 'Bug'], text: '新版本 2.4 更新后一直闪退，根本没法正常玩。' },
      { sentiment: 'negative', level: 'P1', topics: ['版本', 'Bug'], text: '更新完进不去副本，一加载就黑屏，太影响体验了。' },
      { sentiment: 'negative', level: 'P2', topics: ['版本'], text: '新版本的画面风格不太喜欢，还是喜欢以前的。' },
      { sentiment: 'negative', level: 'P2', topics: ['版本'], text: '版本更新后按键布局变了，需要重新适应。' },
      { sentiment: 'positive', level: 'none', topics: ['版本'], text: '这次版本更新的新副本挺好玩的，点赞。' },
      { sentiment: 'positive', level: 'none', topics: ['版本'], text: '新版本优化了加载速度，体验不错。' },
      { sentiment: 'positive', level: 'none', topics: ['版本'], text: '版本更新追加的剧情很用心，满意。' },
      { sentiment: 'neutral', level: 'none', topics: ['版本'], text: '想问下版本更新一般多久一次？' },
    ],
  },
  // P1-2 Bug 2026-10-23 星海远征：4 负面（2 P1 + 2 P2）+ 3 正面 + 1 中性 -> P1
  {
    key: 'P1-Bug-2026-10-23',
    topic: 'Bug',
    date: '2026-10-23',
    brand: '星海远征',
    level: 'P1',
    comments: [
      { sentiment: 'negative', level: 'P1', topics: ['Bug'], text: '任务奖励领取失败，背包里也没有，这个 BUG 太影响体验。' },
      { sentiment: 'negative', level: 'P1', topics: ['Bug'], text: '跨服组队一直匹配失败，这个 BUG 什么时候修？' },
      { sentiment: 'negative', level: 'P2', topics: ['Bug'], text: '游戏里的 BUG 反馈入口藏得太深，不太好找。' },
      { sentiment: 'negative', level: 'P2', topics: ['Bug'], text: '这个 BUG 存在挺久了，一直没修复，有点失望。' },
      { sentiment: 'positive', level: 'none', topics: ['Bug'], text: '昨天反馈的 BUG 今天就修好了，效率不错。' },
      { sentiment: 'positive', level: 'none', topics: ['Bug'], text: '这次修复很及时，游戏流畅多了。' },
      { sentiment: 'positive', level: 'none', topics: ['Bug'], text: 'BUG 修复后任务终于能正常完成了，满意。' },
      { sentiment: 'neutral', level: 'none', topics: ['Bug'], text: '请问 BUG 反馈在哪里提交？' },
    ],
  },
  // P2-2 充值 2026-10-24 云上大陆：2 负面（实体 P2）+ 2 正面 + 2 中性 -> P2
  {
    key: 'P2-充值-2026-10-24',
    topic: '充值',
    date: '2026-10-24',
    brand: '云上大陆',
    level: 'P2',
    comments: [
      { sentiment: 'negative', level: 'P2', topics: ['充值'], text: '充值档位的赠送比例感觉比上月低了一点，有点失望。' },
      { sentiment: 'negative', level: 'P2', topics: ['充值'], text: '充值页面的活动入口不太显眼，找了半天。' },
      { sentiment: 'positive', level: 'none', topics: ['充值'], text: '充值的到账速度很快，体验不错。' },
      { sentiment: 'positive', level: 'none', topics: ['充值'], text: '这次充值活动送的时装很好看，满意。' },
      { sentiment: 'neutral', level: 'none', topics: ['充值'], text: '请问充值有发票吗？' },
      { sentiment: 'neutral', level: 'none', topics: ['充值'], text: '想了解下充值档位的区别。' },
    ],
  },
  // P1-3 活动 2026-10-25 云上大陆：4 负面（2 P1 + 2 P2）+ 3 正面 + 1 中性 -> P1
  {
    key: 'P1-活动-2026-10-25',
    topic: '活动',
    date: '2026-10-25',
    brand: '云上大陆',
    level: 'P1',
    comments: [
      { sentiment: 'negative', level: 'P1', topics: ['活动'], text: '活动奖励发放延迟三天了，到现在还没发。' },
      { sentiment: 'negative', level: 'P1', topics: ['活动'], text: '活动进度卡住不更新，奖励也领取失败，没法正常参与。' },
      { sentiment: 'negative', level: 'P2', topics: ['活动'], text: '这次活动的奖励不太丰厚，吸引力一般。' },
      { sentiment: 'negative', level: 'P2', topics: ['活动'], text: '活动规则写得太绕，看不懂怎么玩。' },
      { sentiment: 'positive', level: 'none', topics: ['活动'], text: '这次活动福利挺多的，玩得很开心。' },
      { sentiment: 'positive', level: 'none', topics: ['活动'], text: '活动奖励很给力，已经拿到限定时装了。' },
      { sentiment: 'positive', level: 'none', topics: ['活动'], text: '活动设计得不错，希望以后多来点。' },
      { sentiment: 'neutral', level: 'none', topics: ['活动'], text: '活动什么时候结束？想问问时间。' },
    ],
  },
  // P0-2 版本 2026-10-26 星海远征：4 单条 P0 + 6 条 P2 负面 = 10 负面 -> P0
  {
    key: 'P0-版本-2026-10-26',
    topic: '版本',
    date: '2026-10-26',
    brand: '星海远征',
    level: 'P0',
    comments: [
      { sentiment: 'negative', level: 'P0', topics: ['版本'], text: '新版本一更新就回档，昨天肝了一晚上的进度全没了，氪的金也白花了！' },
      { sentiment: 'negative', level: 'P0', topics: ['版本', '充值'], text: '回档之后充值档位也丢了，扣款不到账，新版本客服还不处理，大家一起投诉！' },
      { sentiment: 'negative', level: 'P0', topics: ['版本'], text: '大面积回档，好几个区的新版本都出问题了，官方再不管我们就集体维权。' },
      { sentiment: 'negative', level: 'P0', topics: ['版本', 'Bug'], text: '版本更新后回档导致道具全部重置，这是数据丢失，媒体曝光一下才会有人管吧。' },
      { sentiment: 'negative', level: 'P2', topics: ['版本'], text: '新版本界面改得有点复杂，希望官方再优化一下。' },
      { sentiment: 'negative', level: 'P2', topics: ['版本'], text: '版本更新后字体太小了，看着有点累。' },
      { sentiment: 'negative', level: 'P2', topics: ['版本'], text: '这次更新的新玩法不太好玩，有点失望。' },
      { sentiment: 'negative', level: 'P2', topics: ['版本'], text: '版本更新的公告写得太长，没耐心看完。' },
      { sentiment: 'negative', level: 'P2', topics: ['版本'], text: '新版本加载界面换了，感觉不如以前。' },
      { sentiment: 'negative', level: 'P2', topics: ['版本'], text: '更新后活动入口换了位置，不太习惯。' },
    ],
  },
  // P1-4 客服 2026-10-26 星海远征：4 负面（2 P1 + 2 P2）+ 3 正面 + 1 中性 -> P1
  {
    key: 'P1-客服-2026-10-26',
    topic: '客服',
    date: '2026-10-26',
    brand: '星海远征',
    level: 'P1',
    comments: [
      { sentiment: 'negative', level: 'P1', topics: ['客服'], text: '客服回复太敷衍了，问了三遍都答非所问。' },
      { sentiment: 'negative', level: 'P1', topics: ['客服'], text: '排队等了四十分钟才轮到客服，效率太低了。' },
      { sentiment: 'negative', level: 'P2', topics: ['客服'], text: '客服的语气有点冷，希望热情一点。' },
      { sentiment: 'negative', level: 'P2', topics: ['客服'], text: '客服回复模板化严重，感觉没认真看问题。' },
      { sentiment: 'positive', level: 'none', topics: ['客服'], text: '客服很快就帮我解决了，态度很好。' },
      { sentiment: 'positive', level: 'none', topics: ['客服'], text: '这次的客服很专业，问题一次就处理好了。' },
      { sentiment: 'positive', level: 'none', topics: ['客服'], text: '客服响应速度不错，点赞。' },
      { sentiment: 'neutral', level: 'none', topics: ['客服'], text: '想咨询一下客服的服务时间是几点到几点？' },
    ],
  },
  // P2-3 活动 2026-10-28 云上大陆：2 负面（实体 P2）+ 2 正面 + 2 中性 -> P2
  {
    key: 'P2-活动-2026-10-28',
    topic: '活动',
    date: '2026-10-28',
    brand: '云上大陆',
    level: 'P2',
    comments: [
      { sentiment: 'negative', level: 'P2', topics: ['活动'], text: '活动奖励的吸引力一般，没什么参与欲望。' },
      { sentiment: 'negative', level: 'P2', topics: ['活动'], text: '活动周期感觉有点短，希望延长一点。' },
      { sentiment: 'positive', level: 'none', topics: ['活动'], text: '活动奖励挺良心的，满意。' },
      { sentiment: 'positive', level: 'none', topics: ['活动'], text: '这次活动玩法有意思，点赞。' },
      { sentiment: 'neutral', level: 'none', topics: ['活动'], text: '活动每天几点刷新？' },
      { sentiment: 'neutral', level: 'none', topics: ['活动'], text: '想问下活动奖励怎么领取？' },
    ],
  },
  // P0-1 外挂 2026-10-29 星海远征：4 单条 P0 + 6 条 P2 负面 = 10 负面 -> P0
  {
    key: 'P0-外挂-2026-10-29',
    topic: '外挂',
    date: '2026-10-29',
    brand: '星海远征',
    level: 'P0',
    comments: [
      { sentiment: 'negative', level: 'P0', topics: ['外挂'], text: '外挂脚本已经公开卖了，排行榜前十全是挂，官方大面积封号还误封正常玩家，再不处理我们就集体维权！' },
      { sentiment: 'negative', level: 'P0', topics: ['外挂', '客服'], text: '外挂没处理，我正常上线却显示账号被封，客服说是封号误封还要等申诉，我们准备去 12315 投诉。' },
      { sentiment: 'negative', level: 'P0', topics: ['外挂'], text: '外挂这么猖狂，官方还在装死，媒体曝光都出来了，大家一起去维权。' },
      { sentiment: 'negative', level: 'P0', topics: ['外挂', '充值'], text: '外挂不封，正常玩家被封，大面积误封，扣款不到账也没人管，这游戏还能玩吗？' },
      { sentiment: 'negative', level: 'P2', topics: ['外挂'], text: '外挂举报了三次都没有回应，有点失望。' },
      { sentiment: 'negative', level: 'P2', topics: ['外挂'], text: '排行榜上的外挂号一直不处理，体验越来越差了。' },
      { sentiment: 'negative', level: 'P2', topics: ['外挂'], text: '外挂太多了，正常玩家根本没有游戏体验。' },
      { sentiment: 'negative', level: 'P2', topics: ['外挂'], text: '举报外挂后只收到一条自动回复，感觉没人管。' },
      { sentiment: 'negative', level: 'P2', topics: ['外挂'], text: '外挂这么多，官方真的该好好管管了。' },
      { sentiment: 'negative', level: 'P2', topics: ['外挂'], text: '每次举报外挂都没下文，对官方越来越失望了。' },
    ],
  },
  // P2-4 其他 2026-10-30 机甲前线：2 负面（实体 P2）+ 3 噪声 + 1 中性 -> P2
  {
    key: 'P2-其他-2026-10-30',
    topic: '其他',
    date: '2026-10-30',
    brand: '机甲前线',
    level: 'P2',
    comments: [
      { sentiment: 'negative', level: 'P2', topics: ['其他'], text: '手柄适配感觉一般，操作起来不太顺手。' },
      { sentiment: 'negative', level: 'P2', topics: ['其他'], text: '希望增加云存档功能，现在换设备很麻烦。' },
      { sentiment: 'neutral', level: 'none', noise: true, topics: ['其他'], text: '代充折扣低至 5 折，加 V 详聊，非诚勿扰。' },
      { sentiment: 'neutral', level: 'none', noise: true, topics: ['其他'], text: '出租高战账号，日结，私聊。' },
      { sentiment: 'neutral', level: 'none', noise: true, topics: ['其他'], text: '666666 沙发 打卡' },
      { sentiment: 'neutral', level: 'none', topics: ['其他'], text: '云存档这个功能确实挺需要的。' },
    ],
  },
  // none-3 版本 2026-10-30 星海远征：3 正面 + 3 中性 -> none
  {
    key: 'none-版本-2026-10-30',
    topic: '版本',
    date: '2026-10-30',
    brand: '星海远征',
    level: 'none',
    comments: [
      { sentiment: 'positive', level: 'none', topics: ['版本'], text: '这次版本优化很到位，流畅了不少。' },
      { sentiment: 'positive', level: 'none', topics: ['版本'], text: '新版本体验不错，推荐。' },
      { sentiment: 'positive', level: 'none', topics: ['版本'], text: '版本更新后画面更精致了，满意。' },
      { sentiment: 'neutral', level: 'none', topics: ['版本'], text: '版本更新后登录界面换了，还挺新鲜。' },
      { sentiment: 'neutral', level: 'none', topics: ['版本'], text: '想问下 10 月版本更新了什么内容？' },
      { sentiment: 'neutral', level: 'none', topics: ['版本'], text: '版更后回归玩家有奖励吗？' },
    ],
  },
  // P1-5 Bug 2026-10-31 机甲前线：4 负面（2 P1 + 2 P2）+ 3 正面 + 1 中性 -> P1
  {
    key: 'P1-Bug-2026-10-31',
    topic: 'Bug',
    date: '2026-10-31',
    brand: '机甲前线',
    level: 'P1',
    comments: [
      { sentiment: 'negative', level: 'P1', topics: ['Bug'], text: '跨服战一进入就掉线，重连好几次都不行。' },
      { sentiment: 'negative', level: 'P1', topics: ['Bug'], text: '新机甲技能释放卡顿严重，战斗根本没法正常进行。' },
      { sentiment: 'negative', level: 'P2', topics: ['Bug'], text: '机甲外观建模不太满意，BUG 修完希望能优化一下。' },
      { sentiment: 'negative', level: 'P2', topics: ['Bug'], text: '这个 BUG 反馈很久了，优先级感觉很低。' },
      { sentiment: 'positive', level: 'none', topics: ['Bug'], text: '昨天的热更新修复了掉线问题，现在稳定多了。' },
      { sentiment: 'positive', level: 'none', topics: ['Bug'], text: '机甲平衡性调整后 BUG 少了很多，体验好多了，满意。' },
      { sentiment: 'positive', level: 'none', topics: ['Bug'], text: '这次 BUG 修复速度很快，给开发点赞。' },
      { sentiment: 'neutral', level: 'none', topics: ['Bug'], text: '想问下下次版本更新和 BUG 修复是什么时候？' },
    ],
  },
  // P0-3 充值 2026-11-01 云上大陆：10 条 P2 负面（无单条 P0），负面>=8 聚合升级 P0
  {
    key: 'P0-充值-2026-11-01',
    topic: '充值',
    date: '2026-11-01',
    brand: '云上大陆',
    level: 'P0',
    upgradeByAggregation: true,
    comments: [
      { sentiment: 'negative', level: 'P2', topics: ['充值'], text: '新充值活动的折扣力度比上个月小，有点失望。' },
      { sentiment: 'negative', level: 'P2', topics: ['充值'], text: '充值界面改版后感觉不如以前顺手，希望优化。' },
      { sentiment: 'negative', level: 'P2', topics: ['充值'], text: '这次充值的档位设置不太合理，6 元档没有额外奖励。' },
      { sentiment: 'negative', level: 'P2', topics: ['充值'], text: '充值返利的规则写得太复杂，看不懂，体验一般。' },
      { sentiment: 'negative', level: 'P2', topics: ['充值'], text: '月卡价格涨了，但内容没变，感觉不太划算。' },
      { sentiment: 'negative', level: 'P2', topics: ['充值'], text: '充值活动的赠送比例感觉变低了，不太满意。' },
      { sentiment: 'negative', level: 'P2', topics: ['充值'], text: '希望充值能多几个档位选择，现在可选太少。' },
      { sentiment: 'negative', level: 'P2', topics: ['充值'], text: '充值到账的提示音太吵，建议加个开关。' },
      { sentiment: 'negative', level: 'P2', topics: ['充值'], text: '充值记录页面加载有点慢，希望优化一下。' },
      { sentiment: 'negative', level: 'P2', topics: ['充值'], text: '这次充值活动的时间安排不太合理，赶上工作日。' },
    ],
  },
  // P1-6 客服 2026-11-02 云上大陆：4 负面（2 P1 + 2 P2）+ 3 正面 + 1 中性 -> P1
  {
    key: 'P1-客服-2026-11-02',
    topic: '客服',
    date: '2026-11-02',
    brand: '云上大陆',
    level: 'P1',
    comments: [
      { sentiment: 'negative', level: 'P1', topics: ['客服'], text: '工单提交三天了还没人处理，进度一直停滞。' },
      { sentiment: 'negative', level: 'P1', topics: ['客服'], text: '客服电话一直排队，等了二十分钟也没人接。' },
      { sentiment: 'negative', level: 'P2', topics: ['客服'], text: '客服的话术太官方了，听着有点距离感。' },
      { sentiment: 'negative', level: 'P2', topics: ['客服'], text: '希望客服能提供夜间服务，现在晚上找不到人。' },
      { sentiment: 'positive', level: 'none', topics: ['客服'], text: '工单处理速度很快，当天就解决了。' },
      { sentiment: 'positive', level: 'none', topics: ['客服'], text: '客服态度很好，问题解释得很清楚。' },
      { sentiment: 'positive', level: 'none', topics: ['客服'], text: '这次客服响应及时，体验不错。' },
      { sentiment: 'neutral', level: 'none', topics: ['客服'], text: '请问客服工单一般多久回复一次？' },
    ],
  },
];

const SENTIMENT_CLUSTER_EXPECTED = {
  total: 16,
  levels: { P0: 3, P1: 6, P2: 4, none: 3 },
};

// ---------------------------------------------------------------------------
// 通用工具
// ---------------------------------------------------------------------------
function round2(value) {
  return Math.round(value * 100) / 100;
}

function pad4(value) {
  return String(value).padStart(4, '0');
}

function isoAt(date, time) {
  return `${date}T${time}:00+08:00`;
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** 返回 text 中命中的词（用于证据校验；词表均在常量区固定）。 */
function hasAny(text, words) {
  return words.filter((word) => text.includes(word));
}

function unique(values) {
  return [...new Set(values)];
}

/** 计数：keyFn 返回字符串或字符串数组；结果对象按 key 排序，保证输出稳定。 */
function countBy(list, keyFn) {
  const counts = new Map();
  for (const item of list) {
    const key = keyFn(item);
    if (key === null || key === undefined || key === '') continue;
    const keys = Array.isArray(key) ? key : [key];
    for (const value of keys) counts.set(value, (counts.get(value) || 0) + 1);
  }
  const result = {};
  for (const key of [...counts.keys()].sort()) result[key] = counts.get(key);
  return result;
}

function dateRangeOf(list, keyFn) {
  const dates = list.map(keyFn).filter(Boolean).sort();
  return {
    from: dates[0] || null,
    to: dates[dates.length - 1] || null,
    distinctDays: new Set(dates).size,
  };
}

// ---------------------------------------------------------------------------
// 质检数据集构建（字段契约：specs/004-data-model.md §3.1/§3.2/§7.3）
// ---------------------------------------------------------------------------
function pickPrimaryTag(tags) {
  for (const tag of PRIMARY_ORDER) {
    if (tags.includes(tag)) return tag;
  }
  return null;
}

const QC_CONFIDENCE_POOL = {
  violationExplicit: [0.86, 0.88, 0.91, 0.93, 0.95, 0.97],
  violationImplicit: [0.58, 0.61, 0.64, 0.67, 0.7, 0.72],
  passExplicit: [0.9, 0.92, 0.94, 0.96, 0.98],
  passImplicit: [0.6, 0.63, 0.66, 0.69, 0.72],
};

function buildQcDataset() {
  const items = QC_SCENARIOS.map((scenario, index) => {
    const date = DATES[index % DATES.length];
    const startedAt = isoAt(date, TIMES[(index * 3) % TIMES.length]);
    const lastAtSec = scenario.msgs[scenario.msgs.length - 1][2];
    const messages = scenario.msgs.map(([role, text, atSec], messageIndex) => ({
      seq: messageIndex + 1,
      role,
      text,
      atSec,
      gapSec: messageIndex === 0 ? 0 : atSec - scenario.msgs[messageIndex - 1][2],
    }));
    const tags = [...scenario.tags];
    const verdict = tags.length > 0 ? 'violation' : 'pass';
    const primaryTag = tags.length > 0 ? pickPrimaryTag(tags) : null;
    const poolKey =
      verdict === 'violation'
        ? scenario.complexity === 'implicit'
          ? 'violationImplicit'
          : 'violationExplicit'
        : scenario.complexity === 'implicit'
          ? 'passImplicit'
          : 'passExplicit';
    const confidencePool = QC_CONFIDENCE_POOL[poolKey];
    const confidence = confidencePool[index % confidencePool.length];

    return {
      id: `qc-${pad4(index + 1)}`,
      channel: CHANNELS[index % CHANNELS.length],
      product: PRODUCTS[(index + Math.floor(index / 3)) % PRODUCTS.length],
      agent: { ...AGENTS[index % AGENTS.length] },
      customer: { id: `C-${7701 + index}`, name: `用户${8000 + ((index * 37) % 1999)}` },
      startedAt,
      durationSec: lastAtSec + 40 + ((index * 13) % 60),
      messages,
      importedAt: isoAt(date, '23:10'),
      batchId: `B-${date}`,
      labels: {
        verdict,
        tags,
        primaryTag,
        note: scenario.note,
        complexity: scenario.complexity,
        confidence,
        needsReview: scenario.needsReview,
        summary: scenario.summary,
        emotion: scenario.emotion,
        tagEvidence: tags.map((code) => {
          const evidenceSeq = scenario.evidence[code];
          return {
            code,
            evidenceSeq,
            quote: messages[evidenceSeq - 1].text,
          };
        }),
      },
    };
  });

  return {
    datasetId: QC_DATASET_ID,
    version: SPEC_VERSION,
    datasetVersion: DATASET_VERSION,
    description:
      '客服质检评测集：60 条对话（40 条违规 + 20 条正常），覆盖 attitude/forbidden/off_topic/wrong_knowledge/timeout/escalation 六类标签、多标签组合、隐式边界样本与正常样本，用于规则引擎判定评测与演示。',
    generatedAt: GENERATED_AT,
    items,
  };
}

// ---------------------------------------------------------------------------
// 舆情数据集构建（字段契约：specs/004-data-model.md §4.3/§7.4）
// ---------------------------------------------------------------------------
const LEVEL_RANK = { none: 0, P2: 1, P1: 2, P0: 3 };

const AUTHOR_PREFIX = {
  steam: 'steam_',
  taptap: 'tap_',
  googleplay: 'gp_',
  community: '社区_',
  ticket: '用户_',
};

const TOPIC_KEYWORDS = {
  版本: ['版本', '更新', '版更'],
  充值: ['充值', '月卡', '档位', '氪'],
  外挂: ['外挂', '脚本', '开挂'],
  客服: ['客服', '工单', '排队', '服务'],
  活动: ['活动', '福利', '奖励'],
  Bug: ['BUG', 'Bug', 'bug', '闪退', '掉线', '卡顿', '修复'],
  其他: [],
};

function aggregateLevelFromNegatives(negativeCount) {
  if (negativeCount >= 8) return 'P0';
  if (negativeCount >= 3) return 'P1';
  if (negativeCount >= 1) return 'P2';
  return 'none';
}

function maxLevel(levels) {
  return levels.reduce(
    (current, level) => (LEVEL_RANK[level] > LEVEL_RANK[current] ? level : current),
    'none',
  );
}

/** 007 §5：簇级别 = max(单条最大级别, 负面条数决定的聚合级别)。 */
function resolveClusterLevel(cluster) {
  const negativeCount = cluster.comments.filter((comment) => comment.sentiment === 'negative').length;
  const aggregate = aggregateLevelFromNegatives(negativeCount);
  const singleMax = maxLevel(cluster.comments.map((comment) => comment.level));
  return LEVEL_RANK[aggregate] >= LEVEL_RANK[singleMax] ? aggregate : singleMax;
}

function sentimentNote(comment, cluster) {
  const negativeCount = cluster.comments.filter((item) => item.sentiment === 'negative').length;
  const clusterLevel = resolveClusterLevel(cluster);
  const highRisk = hasAny(comment.text, HIGH_RISK_WORDS);
  const impact = hasAny(comment.text, IMPACT_WORDS);
  if (comment.noise === true) {
    return `噪声评论（广告/灌水/无行动价值）：${comment.sentiment}，单条 none；簇内负面 ${negativeCount} 条，簇级别 ${clusterLevel}。`;
  }
  if (comment.level === 'P0') {
    return `单条 P0：负面 + 高危主题「${cluster.topic}」+ 高危信号词「${highRisk.join('、')}」；簇内负面 ${negativeCount} 条，簇级别 ${clusterLevel}。`;
  }
  if (comment.level === 'P1') {
    return `单条 P1：负面 + 主题「${cluster.topic}」+ 明确影响「${impact.join('、')}」，无 P0 信号；簇内负面 ${negativeCount} 条，簇级别 ${clusterLevel}。`;
  }
  if (comment.sentiment === 'negative') {
    return `单条 P2：负面情绪但无 P0/P1 信号；簇内负面 ${negativeCount} 条，聚合达到 ${aggregateLevelFromNegatives(negativeCount)}，簇级别 ${clusterLevel}。`;
  }
  return `单条 none：${comment.sentiment === 'positive' ? '正面' : '中性'}评论，无 P0/P1 信号；簇内负面 ${negativeCount} 条，簇级别 ${clusterLevel}。`;
}

function buildSentimentDataset() {
  const items = [];
  SENTIMENT_CLUSTERS.forEach((cluster, clusterIndex) => {
    const topicKeywords = TOPIC_KEYWORDS[cluster.topic] || [];
    cluster.comments.forEach((comment, commentIndex) => {
      const index = items.length;
      const source = SENTIMENT_SOURCES[(clusterIndex + commentIndex) % SENTIMENT_SOURCES.length];
      const publishedAt = isoAt(
        cluster.date,
        SENTIMENT_TIMES[(commentIndex * 5 + clusterIndex * 3) % SENTIMENT_TIMES.length],
      );
      const clusterLevel = resolveClusterLevel(cluster);
      const needsReview = clusterLevel === 'P0' && comment.level !== 'P0';
      const confidence = needsReview
        ? round2(0.6 + ((index * 3) % 12) / 100)
        : round2(0.84 + ((index * 5) % 14) / 100);
      const sentimentScore =
        comment.sentiment === 'negative'
          ? -round2(0.5 + ((index % 4) + 1) / 10)
          : comment.sentiment === 'positive'
            ? round2(0.5 + ((index % 4) + 1) / 10)
            : round2(((index % 5) - 2) / 10);
      const topicHints = unique([
        cluster.topic,
        ...comment.topics.filter((topic) => topic !== cluster.topic),
        ...hasAny(comment.text, HIGH_RISK_WORDS),
        ...hasAny(comment.text, IMPACT_WORDS),
        ...hasAny(comment.text, topicKeywords),
      ]).slice(0, 3);

      items.push({
        id: `cm-${pad4(index + 1)}`,
        source,
        brand: cluster.brand,
        author: `${AUTHOR_PREFIX[source]}${1000 + index}`,
        text: comment.text,
        publishedAt,
        topicHints,
        labels: {
          sentiment: comment.sentiment,
          topics: [...comment.topics],
          primaryTopic: cluster.topic,
          expectedLevel: comment.level,
          noise: comment.noise === true,
          note: sentimentNote(comment, cluster),
          severity: comment.level.toLowerCase(),
          confidence,
          needsReview,
          sentimentScore,
        },
      });
    });
  });

  return {
    datasetId: SENTIMENT_DATASET_ID,
    version: SPEC_VERSION,
    datasetVersion: DATASET_VERSION,
    description:
      '舆情评测集：120 条评论，按「主题×日期」聚为 16 簇（P0 3 簇、P1 6 簇、P2 4 簇、none 3 簇），覆盖单条分级、聚合升级、噪声与五类来源，用于告警聚类与级别回放评测。',
    generatedAt: GENERATED_AT,
    items,
  };
}

// ---------------------------------------------------------------------------
// 统计（写入 manifest.counts，便于后端/QA 对账）
// ---------------------------------------------------------------------------
function computeQcStats(dataset) {
  const items = dataset.items;
  return {
    total: items.length,
    violation: items.filter((item) => item.labels.verdict === 'violation').length,
    pass: items.filter((item) => item.labels.verdict === 'pass').length,
    needsReview: items.filter((item) => item.labels.needsReview === true).length,
    implicit: items.filter((item) => item.labels.complexity === 'implicit').length,
    channels: countBy(items, (item) => item.channel),
    agents: countBy(items, (item) => item.agent.name),
    products: countBy(items, (item) => item.product),
    tags: countBy(items, (item) => item.labels.tags),
    primaryTags: countBy(items, (item) => item.labels.primaryTag),
    avgMessages: round2(
      items.reduce((sum, item) => sum + item.messages.length, 0) / items.length,
    ),
    dateRange: dateRangeOf(items, (item) => item.startedAt.slice(0, 10)),
  };
}

function computeSentimentStats(dataset) {
  const items = dataset.items;
  const clusterMap = new Map();
  for (const item of items) {
    const key = `${item.labels.primaryTopic}|${item.publishedAt.slice(0, 10)}`;
    if (!clusterMap.has(key)) clusterMap.set(key, []);
    clusterMap.get(key).push(item);
  }
  const clusters = [...clusterMap.entries()].map(([key, clusterItems]) => {
    const negativeCount = clusterItems.filter(
      (item) => item.labels.sentiment === 'negative',
    ).length;
    const singleMax = maxLevel(clusterItems.map((item) => item.labels.expectedLevel));
    const aggregate = aggregateLevelFromNegatives(negativeCount);
    const level = LEVEL_RANK[aggregate] >= LEVEL_RANK[singleMax] ? aggregate : singleMax;
    return { key, level, size: clusterItems.length, negativeCount, singleMax };
  });
  return {
    total: items.length,
    sentiment: countBy(items, (item) => item.labels.sentiment),
    noise: items.filter((item) => item.labels.noise === true).length,
    sources: countBy(items, (item) => item.source),
    topics: countBy(items, (item) => item.labels.primaryTopic),
    levels: countBy(items, (item) => item.labels.expectedLevel),
    clusters: {
      total: clusters.length,
      levels: countBy(clusters, (cluster) => cluster.level),
      sizes: clusters.map((cluster) => cluster.size),
      aggregateUpgradedP0: clusters.filter(
        (cluster) => cluster.level === 'P0' && cluster.singleMax !== 'P0',
      ).length,
    },
    dateRange: dateRangeOf(items, (item) => item.publishedAt.slice(0, 10)),
  };
}

// ---------------------------------------------------------------------------
// manifest 构建（契约：specs/004-data-model.md §7.2；扩展字段见 data/README.md）
// ---------------------------------------------------------------------------
function buildManifest(qc, sentiment, validation) {
  const qcCounts = computeQcStats(qc);
  const sentimentCounts = computeSentimentStats(sentiment);
  return {
    version: SPEC_VERSION,
    datasetVersion: DATASET_VERSION,
    generatedAt: GENERATED_AT,
    description:
      'QCC Workbench MVP 评测数据清单：客服质检评测集（60 条对话）+ 舆情评测集（120 条评论），供规则引擎评测、告警聚类回放与演示使用。',
    generator: {
      name: GENERATOR_NAME,
      version: GENERATOR_VERSION,
      deterministic: true,
      specVersion: SPEC_VERSION,
    },
    datasets: {
      qc: {
        datasetId: QC_DATASET_ID,
        version: SPEC_VERSION,
        datasetVersion: DATASET_VERSION,
        file: 'qc/dataset.json',
        itemCount: qc.items.length,
        counts: qcCounts,
      },
      sentiment: {
        datasetId: SENTIMENT_DATASET_ID,
        version: SPEC_VERSION,
        datasetVersion: DATASET_VERSION,
        file: 'sentiment/dataset.json',
        itemCount: sentiment.items.length,
        counts: sentimentCounts,
      },
    },
    counts: {
      total: qc.items.length + sentiment.items.length,
      qc: qcCounts,
      sentiment: sentimentCounts,
    },
    checks: {
      passed: validation.passed,
      total: validation.items.length,
      passedCount: validation.items.filter((item) => item.ok).length,
      failed: validation.failed,
      items: validation.items,
    },
  };
}

// ---------------------------------------------------------------------------
// 约束校验（--check / 生成前自检；失败 exit 1 并打印差异）
// ---------------------------------------------------------------------------
const QC_TAGS = Object.keys(TAG_WEIGHTS);
const MESSAGE_ROLES = ['customer', 'agent', 'system'];
const LEVELS = ['P0', 'P1', 'P2', 'none'];
const P0_TOPICS = ['外挂', '充值', '版本'];
const P1_TOPICS = ['版本', 'Bug', '活动', '客服', '充值'];
const DATE_MIN = '2026-10-20';
const DATE_MAX = '2026-11-02';
const ISO_CST = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/;

function validateQc(qc, add) {
  const items = Array.isArray(qc.items) ? qc.items : [];
  const ids = items.map((item) => item.id);
  const expectedIds = items.map((_, index) => `qc-${pad4(index + 1)}`);
  const idIssue = ids.find((id, index) => id !== expectedIds[index]);
  const labelIssues = items.filter((item) => {
    const labels = item.labels || {};
    return (
      !['pass', 'violation'].includes(labels.verdict) ||
      !Array.isArray(labels.tags) ||
      !Object.prototype.hasOwnProperty.call(labels, 'primaryTag') ||
      typeof labels.note !== 'string' ||
      labels.note.length === 0
    );
  });

  add(
    'QC-01',
    'QC 数据集顶层结构（datasetId/version/datasetVersion/description/generatedAt/items）',
    qc.datasetId === QC_DATASET_ID &&
      qc.version === SPEC_VERSION &&
      qc.datasetVersion === DATASET_VERSION &&
      typeof qc.description === 'string' &&
      qc.description.length > 0 &&
      qc.generatedAt === GENERATED_AT &&
      Array.isArray(qc.items),
  );
  add(
    'QC-02',
    'QC 条目数 = 60',
    items.length === 60,
    items.length === 60 ? '' : `实际 ${items.length} 条`,
  );
  add(
    'QC-03',
    'QC 条目 id 唯一且按 qc-0001..qc-0060 连续编号',
    ids.length === new Set(ids).size && !idIssue,
    idIssue ? `首个不一致：${idIssue}` : '',
  );
  add(
    'QC-04',
    'QC 条目必填字段齐全（含 agent/customer/messages/labels）',
    items.every(
      (item) =>
        typeof item.id === 'string' &&
        typeof item.channel === 'string' &&
        typeof item.product === 'string' &&
        item.product.length > 0 &&
        item.agent &&
        typeof item.agent.id === 'string' &&
        typeof item.agent.name === 'string' &&
        item.customer &&
        typeof item.customer.id === 'string' &&
        typeof item.customer.name === 'string' &&
        typeof item.startedAt === 'string' &&
        typeof item.durationSec === 'number' &&
        Array.isArray(item.messages) &&
        typeof item.importedAt === 'string' &&
        typeof item.batchId === 'string' &&
        item.labels &&
        typeof item.labels === 'object',
    ),
    '',
  );
  add(
    'QC-05',
    'QC 渠道枚举合法且 online/ticket/phone 三渠道全覆盖',
    items.every((item) => CHANNELS.includes(item.channel)) &&
      CHANNELS.every((channel) => items.some((item) => item.channel === channel)),
    JSON.stringify(countBy(items, (item) => item.channel)),
  );

  const messageIssues = [];
  for (const item of items) {
    const messages = item.messages || [];
    if (messages.length < 4 || messages.length > 14) {
      messageIssues.push(`${item.id}:消息数 ${messages.length}`);
      continue;
    }
    let previousAt = -1;
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      if (message.seq !== index + 1) {
        messageIssues.push(`${item.id}:seq=${message.seq}`);
        break;
      }
      if (!MESSAGE_ROLES.includes(message.role)) {
        messageIssues.push(`${item.id}#${message.seq}:role=${message.role}`);
        break;
      }
      if (typeof message.text !== 'string' || message.text.trim().length === 0) {
        messageIssues.push(`${item.id}#${message.seq}:text 为空`);
        break;
      }
      if (typeof message.atSec !== 'number' || message.atSec <= previousAt) {
        messageIssues.push(`${item.id}#${message.seq}:atSec=${message.atSec} 未严格递增`);
        break;
      }
      previousAt = message.atSec;
    }
  }
  add(
    'QC-06',
    'QC 对话结构合法（4-14 条、seq 连续、role 枚举、atSec 严格递增）',
    messageIssues.length === 0,
    messageIssues.slice(0, 3).join('；'),
  );

  const gapIssues = [];
  for (const item of items) {
    (item.messages || []).forEach((message, index) => {
      const expectedGap = index === 0 ? 0 : message.atSec - item.messages[index - 1].atSec;
      if (message.gapSec !== expectedGap) {
        gapIssues.push(`${item.id}#${message.seq}:期望 ${expectedGap} 实际 ${message.gapSec}`);
      }
    });
  }
  add(
    'QC-07',
    'QC gapSec 与相邻 atSec 差值一致',
    gapIssues.length === 0,
    gapIssues.slice(0, 3).join('；'),
  );

function privacyViolation(text) {
  const emailMatches = text.match(/[A-Za-z0-9._%+*-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
  const unmaskedEmails = emailMatches.filter((value) => !value.includes('***'));
  if (unmaskedEmails.length > 0) return `邮箱 ${unmaskedEmails[0]}`;
  const phoneMatch = text.match(/(?<!\d)1[3-9]\d{9}(?!\d)/);
  if (phoneMatch) return `手机号 ${phoneMatch[0]}`;
  const orderMatch = text.match(/(?<![A-Za-z0-9])[A-Z]{1,3}\d{12,19}(?![A-Za-z0-9])/);
  if (orderMatch) return `订单号 ${orderMatch[0]}`;
  return null;
}

  const privacyIssues = [];
  for (const item of items) {
    for (const message of item.messages || []) {
      const violation = privacyViolation(message.text);
      if (violation) privacyIssues.push(`${item.id}#${message.seq}:${violation}`);
    }
  }
  add(
    'QC-08',
    'QC 对话内无未打码手机号/邮箱/订单号（隐私脱敏约束）',
    privacyIssues.length === 0,
    privacyIssues.slice(0, 3).join('；'),
  );

  const verdictIssues = items.filter(
    (item) => item.labels.verdict !== (item.labels.tags.length > 0 ? 'violation' : 'pass'),
  );
  add(
    'QC-09',
    'QC verdict 与 tags 一致（tags 非空 = violation，空 = pass）',
    verdictIssues.length === 0,
    verdictIssues.map((item) => item.id).slice(0, 5).join('、'),
  );

  const tagIssues = items.filter((item) => {
    const tags = item.labels.tags;
    return (
      !Array.isArray(tags) ||
      new Set(tags).size !== tags.length ||
      tags.some((tag) => !QC_TAGS.includes(tag))
    );
  });
  add(
    'QC-10',
    'QC tags 枚举合法、无重复、且仅使用 004 §4.1 六类标签',
    tagIssues.length === 0,
    tagIssues.map((item) => item.id).slice(0, 5).join('、'),
  );

  const primaryIssues = items.filter((item) => {
    const { tags, primaryTag, verdict } = item.labels;
    if (verdict === 'pass') return primaryTag !== null;
    return !tags.includes(primaryTag) || primaryTag !== pickPrimaryTag(tags);
  });
  add(
    'QC-11',
    'QC primaryTag 唯一、属于 tags、按 004 §4.1 权重规则选取',
    primaryIssues.length === 0,
    primaryIssues.map((item) => item.id).slice(0, 5).join('、'),
  );

  const violationCount = items.filter((item) => item.labels.verdict === 'violation').length;
  add(
    'QC-12',
    'QC 配额：违规 40 条 / 正常 20 条',
    violationCount === 40 && items.length - violationCount === 20,
    `违规 ${violationCount} / 正常 ${items.length - violationCount}`,
  );

  const tagCounts = countBy(items, (item) => item.labels.tags);
  const tagMinimums = {
    attitude: 8,
    forbidden: 8,
    off_topic: 7,
    wrong_knowledge: 7,
    timeout: 6,
    escalation: 6,
  };
  const tagShortfalls = Object.entries(tagMinimums)
    .filter(([tag, minimum]) => (tagCounts[tag] || 0) < minimum)
    .map(([tag, minimum]) => `${tag} ${tagCounts[tag] || 0}<${minimum}`);
  add(
    'QC-13',
    'QC 各标签命中数达到 004 §7.3 / 007 §2.1 下限',
    tagShortfalls.length === 0,
    tagShortfalls.length ? tagShortfalls.join('；') : JSON.stringify(tagCounts),
  );

  const evidenceIssues = [];
  for (const item of items) {
    const evidenceList = Array.isArray(item.labels.tagEvidence) ? item.labels.tagEvidence : [];
    for (const tag of item.labels.tags) {
      const evidence = evidenceList.find((entry) => entry.code === tag);
      if (!evidence) {
        evidenceIssues.push(`${item.id}:${tag} 缺少 tagEvidence`);
        continue;
      }
      const message = item.messages[evidence.evidenceSeq - 1];
      if (!message || message.text !== evidence.quote) {
        evidenceIssues.push(`${item.id}:${tag} evidenceSeq/quote 不匹配`);
        continue;
      }
      if (tag === 'timeout') {
        if (!(message.role === 'agent' && message.gapSec > 180)) {
          evidenceIssues.push(`${item.id}:timeout 证据消息非 >180s 的坐席回复`);
        }
        continue;
      }
      if (hasAny(message.text, TAG_SIGNALS[tag] || []).length === 0) {
        evidenceIssues.push(`${item.id}:${tag} 证据句未命中信号词`);
      }
    }
  }
  add(
    'QC-14',
    'QC 标签证据句可定位（seq 有效、quote 一致、非 timeout 标签命中信号词、timeout 为 >180s 坐席回复）',
    evidenceIssues.length === 0,
    evidenceIssues.slice(0, 5).join('；'),
  );

  const misplacedIssues = [];
  for (const item of items) {
    const fullText = item.messages.map((message) => message.text).join('\n');
    for (const tag of ['attitude', 'forbidden', 'wrong_knowledge', 'escalation', 'off_topic']) {
      const hits = hasAny(fullText, TAG_SIGNALS[tag] || []);
      if (hits.length > 0 && !item.labels.tags.includes(tag)) {
        misplacedIssues.push(`${item.id}:「${hits.join('、')}」命中但未标 ${tag}`);
      }
    }
  }
  add(
    'QC-15',
    'QC 非该标签样本（含正常样本）不得误埋其他标签信号词',
    misplacedIssues.length === 0,
    misplacedIssues.slice(0, 5).join('；'),
  );

  const timeoutIssues = [];
  for (const item of items) {
    const hasTimeoutTag = item.labels.tags.includes('timeout');
    const longGaps = item.messages
      .filter((message) => message.role === 'agent' && message.gapSec > 180)
      .map((message) => message.seq);
    if (hasTimeoutTag && longGaps.length === 0) {
      timeoutIssues.push(`${item.id}:标 timeout 但无坐席回复间隔 >180s`);
    }
    if (!hasTimeoutTag && longGaps.length > 0) {
      timeoutIssues.push(`${item.id}:未标 timeout 但存在 >180s 坐席间隔（seq ${longGaps.join(',')}）`);
    }
  }
  add(
    'QC-16',
    'QC timeout 标签与坐席回复间隔 >180s 双向一致（007 §3）',
    timeoutIssues.length === 0,
    timeoutIssues.slice(0, 5).join('；'),
  );

  const needsReviewCount = items.filter((item) => item.labels.needsReview === true).length;
  const implicitCount = items.filter((item) => item.labels.complexity === 'implicit').length;
  const reviewMismatch = items.filter(
    (item) => item.labels.needsReview !== (item.labels.complexity === 'implicit'),
  );
  const confidenceIssues = items.filter((item) => {
    const confidence = item.labels.confidence;
    if (typeof confidence !== 'number' || confidence < 0.5 || confidence > 0.99) return true;
    if (item.labels.complexity === 'implicit') return confidence > 0.75;
    return confidence < 0.8;
  });
  add(
    'QC-17',
    'QC 边界样本：needsReview = implicit 且数量 >=10，confidence 落在对应区间（implicit <=0.75 / explicit >=0.80）',
    needsReviewCount >= 10 &&
      implicitCount >= 10 &&
      reviewMismatch.length === 0 &&
      confidenceIssues.length === 0,
    `needsReview ${needsReviewCount} / implicit ${implicitCount} / 不一致 ${reviewMismatch.length} / confidence 越界 ${confidenceIssues.length}`,
  );

  const timeIssues = [];
  for (const item of items) {
    const date = item.startedAt.slice(0, 10);
    if (
      !ISO_CST.test(item.startedAt) ||
      date < DATE_MIN ||
      date > DATE_MAX
    ) {
      timeIssues.push(`${item.id}: startedAt=${item.startedAt}`);
    }
    if (!ISO_CST.test(item.importedAt) || item.importedAt <= item.startedAt) {
      timeIssues.push(`${item.id}: importedAt=${item.importedAt}`);
    }
    const lastAtSec = item.messages[item.messages.length - 1].atSec;
    if (typeof item.durationSec !== 'number' || item.durationSec <= lastAtSec) {
      timeIssues.push(`${item.id}: durationSec=${item.durationSec} 未覆盖末条 atSec=${lastAtSec}`);
    }
  }
  add(
    'QC-18',
    'QC 时间字段合法（startedAt 在 2026-10-20~2026-11-02、importedAt 晚于开始、durationSec 覆盖末条）',
    timeIssues.length === 0,
    timeIssues.slice(0, 5).join('；'),
  );

  const qcDateRange = dateRangeOf(items, (item) => item.startedAt.slice(0, 10));
  const agentCount = Object.keys(countBy(items, (item) => item.agent.name)).length;
  add(
    'QC-19',
    'QC 日期覆盖 >=10 天且 4 名坐席全部覆盖',
    qcDateRange.distinctDays >= 10 && agentCount === 4,
    `日期 ${qcDateRange.from}~${qcDateRange.to} 共 ${qcDateRange.distinctDays} 天；坐席 ${agentCount} 人`,
  );

  add(
    'QC-20',
    'QC 金标主字段（verdict/tags/primaryTag/note）类型正确且非空',
    labelIssues.length === 0,
    labelIssues.map((item) => item.id).slice(0, 5).join('、'),
  );
}

function validateSentiment(sentiment, add) {
  const items = Array.isArray(sentiment.items) ? sentiment.items : [];
  const ids = items.map((item) => item.id);
  const expectedIds = items.map((_, index) => `cm-${pad4(index + 1)}`);
  const idIssue = ids.find((id, index) => id !== expectedIds[index]);

  add(
    'SE-01',
    '舆情数据集顶层结构（datasetId/version/datasetVersion/description/generatedAt/items）',
    sentiment.datasetId === SENTIMENT_DATASET_ID &&
      sentiment.version === SPEC_VERSION &&
      sentiment.datasetVersion === DATASET_VERSION &&
      typeof sentiment.description === 'string' &&
      sentiment.description.length > 0 &&
      sentiment.generatedAt === GENERATED_AT &&
      Array.isArray(sentiment.items),
  );
  add(
    'SE-02',
    '舆情条目数 = 120 且 id 唯一连续（cm-0001..cm-0120）',
    items.length === 120 && ids.length === new Set(ids).size && !idIssue,
    `条数 ${items.length}${idIssue ? `，首个不一致：${idIssue}` : ''}`,
  );

  const fieldIssues = items.filter((item) => {
    const labels = item.labels || {};
    return (
      typeof item.id !== 'string' ||
      !SENTIMENT_SOURCES.includes(item.source) ||
      typeof item.brand !== 'string' ||
      item.brand.length === 0 ||
      typeof item.author !== 'string' ||
      item.author.length === 0 ||
      typeof item.text !== 'string' ||
      item.text.length === 0 ||
      typeof item.publishedAt !== 'string' ||
      !Array.isArray(item.topicHints) ||
      typeof labels.sentiment !== 'string' ||
      !Array.isArray(labels.topics) ||
      typeof labels.primaryTopic !== 'string' ||
      !LEVELS.includes(labels.expectedLevel) ||
      typeof labels.noise !== 'boolean' ||
      typeof labels.note !== 'string'
    );
  });
  add(
    'SE-03',
    '舆情条目必填字段与 labels 主字段齐全（sentiment/topics/primaryTopic/expectedLevel/noise/note）',
    fieldIssues.length === 0,
    fieldIssues.map((item) => item.id).slice(0, 5).join('、'),
  );

  const sources = countBy(items, (item) => item.source);
  add(
    'SE-04',
    '舆情来源枚举合法且 steam/taptap/googleplay/community/ticket 五类全覆盖',
    items.every((item) => SENTIMENT_SOURCES.includes(item.source)) &&
      SENTIMENT_SOURCES.every((source) => (sources[source] || 0) > 0),
    JSON.stringify(sources),
  );

  const timeIssues = items.filter((item) => {
    const date = item.publishedAt.slice(0, 10);
    return !ISO_CST.test(item.publishedAt) || date < DATE_MIN || date > DATE_MAX;
  });
  add(
    'SE-05',
    '舆情发布时间合法且在 2026-10-20~2026-11-02 范围内',
    timeIssues.length === 0,
    timeIssues.map((item) => item.id).slice(0, 5).join('、'),
  );

  const textIssues = items.filter(
    (item) => typeof item.text !== 'string' || item.text.length < 8 || item.text.length > 120,
  );
  add(
    'SE-06',
    '舆情文本长度 8-120 字（便于规则与模型处理）',
    textIssues.length === 0,
    textIssues
      .map((item) => `${item.id}:${item.text.length}字`)
      .slice(0, 5)
      .join('、'),
  );

  const subjectIssues = items.filter((item) => {
    const topics = item.labels.topics;
    return (
      !Array.isArray(topics) ||
      topics.length < 1 ||
      topics.length > 3 ||
      new Set(topics).size !== topics.length ||
      topics.some((topic) => !SENTIMENT_TOPICS.includes(topic)) ||
      !topics.includes(item.labels.primaryTopic) ||
      !SENTIMENT_TOPICS.includes(item.labels.primaryTopic)
    );
  });
  add(
    'SE-07',
    '舆情 topics 为 1-3 个合法主题且包含 primaryTopic',
    subjectIssues.length === 0,
    subjectIssues.map((item) => item.id).slice(0, 5).join('、'),
  );

  const clusterMap = new Map();
  for (const item of items) {
    const key = `${item.labels.primaryTopic}|${item.publishedAt.slice(0, 10)}`;
    if (!clusterMap.has(key)) clusterMap.set(key, []);
    clusterMap.get(key).push(item);
  }
  const clusterInfos = [...clusterMap.entries()].map(([key, clusterItems]) => {
    const negativeCount = clusterItems.filter(
      (item) => item.labels.sentiment === 'negative',
    ).length;
    const singleMax = maxLevel(clusterItems.map((item) => item.labels.expectedLevel));
    const aggregate = aggregateLevelFromNegatives(negativeCount);
    const level = LEVEL_RANK[aggregate] >= LEVEL_RANK[singleMax] ? aggregate : singleMax;
    return { key, level, size: clusterItems.length, negativeCount, singleMax };
  });
  const clusterSizes = clusterInfos.map((cluster) => cluster.size);
  add(
    'SE-08',
    '舆情按 (primaryTopic, date) 聚为 16 簇且每簇 4-12 条（004 §7.4）',
    clusterInfos.length === SENTIMENT_CLUSTER_EXPECTED.total &&
      clusterSizes.every((size) => size >= 4 && size <= 12),
    `簇 ${clusterInfos.length} 个；尺寸 ${clusterSizes.join(',')}`,
  );

  const clusterLevels = countBy(clusterInfos, (cluster) => cluster.level);
  const levelExpectation = SENTIMENT_CLUSTER_EXPECTED.levels;
  add(
    'SE-09',
    '簇级别 = max(单条最大级别, 负面聚合级别)（007 §5），且分布为 P0 3 / P1 6 / P2 4 / none 3',
    LEVELS.every((level) => (clusterLevels[level] || 0) === levelExpectation[level]),
    JSON.stringify(clusterLevels),
  );

  const sizeIssues = clusterInfos.filter((cluster) => {
    if (cluster.level === 'P0') return cluster.size < 5 || cluster.size > 10;
    if (cluster.level === 'P1') return cluster.size < 4 || cluster.size > 8;
    return cluster.size < 3 || cluster.size > 6;
  });
  add(
    'SE-10',
    '簇配额与尺寸：P0 >=2(5-10)、P1 >=3(4-8)、P2 >=3(3-6)、none >=3(3-6)（007 §2.3）',
    (clusterLevels.P0 || 0) >= 2 &&
      (clusterLevels.P1 || 0) >= 3 &&
      (clusterLevels.P2 || 0) >= 3 &&
      (clusterLevels.none || 0) >= 3 &&
      sizeIssues.length === 0,
    sizeIssues.length ? sizeIssues.map((cluster) => `${cluster.key}:${cluster.size}`).join('；') : '',
  );

  const aggregateUpgraded = clusterInfos.filter(
    (cluster) => cluster.level === 'P0' && cluster.singleMax !== 'P0',
  );
  add(
    'SE-11',
    '至少 1 个 P0 簇由聚合升级产生（簇内无单条 P0，验证告警升级链路）',
    aggregateUpgraded.length >= 1,
    aggregateUpgraded.map((cluster) => cluster.key).join('、'),
  );

  const levelIssues = [];
  for (const item of items) {
    const level = item.labels.expectedLevel;
    const highRisk = hasAny(item.text, HIGH_RISK_WORDS);
    const impact = hasAny(item.text, IMPACT_WORDS);
    const topic = item.labels.primaryTopic;
    if (level === 'P0') {
      if (
        item.labels.sentiment !== 'negative' ||
        !P0_TOPICS.includes(topic) ||
        highRisk.length === 0
      ) {
        levelIssues.push(`${item.id}: P0 需负面 + 高危主题 + 高危信号词`);
      }
    } else if (level === 'P1') {
      if (
        item.labels.sentiment !== 'negative' ||
        !P1_TOPICS.includes(topic) ||
        impact.length === 0 ||
        highRisk.length > 0
      ) {
        levelIssues.push(`${item.id}: P1 需负面 + 主题 + 明确影响 + 无 P0 信号`);
      }
    } else if (level === 'P2') {
      if (!['negative', 'neutral'].includes(item.labels.sentiment) || highRisk.length > 0) {
        levelIssues.push(`${item.id}: P2 需负面/中性且无 P0/P1 信号`);
      } else if (
        item.labels.sentiment === 'negative' &&
        P1_TOPICS.includes(topic) &&
        impact.length > 0
      ) {
        levelIssues.push(`${item.id}: 负面 + 主题 + 影响词应判 P1`);
      }
    } else if (level === 'none') {
      if (item.labels.sentiment === 'negative' || highRisk.length > 0) {
        levelIssues.push(`${item.id}: none 需非负面且无 P0 信号`);
      }
    }
  }
  add(
    'SE-12',
    '单条级别判定符合 007 §6.1（P0/P1/P2/none 信号规则）',
    levelIssues.length === 0,
    levelIssues.slice(0, 5).join('；'),
  );

  const sentimentCounts = countBy(items, (item) => item.labels.sentiment);
  const noiseCount = items.filter((item) => item.labels.noise === true).length;
  add(
    'SE-13',
    '全局配额：负面 >=60、正面 >=25、中性 >=15、噪声 >=8',
    (sentimentCounts.negative || 0) >= 60 &&
      (sentimentCounts.positive || 0) >= 25 &&
      (sentimentCounts.neutral || 0) >= 15 &&
      noiseCount >= 8,
    `${JSON.stringify(sentimentCounts)}，噪声 ${noiseCount}`,
  );

  const levelTextIssues = [];
  for (const item of items) {
    const highRisk = hasAny(item.text, HIGH_RISK_WORDS);
    if (item.labels.expectedLevel !== 'P0' && highRisk.length > 0) {
      levelTextIssues.push(`${item.id}: 非 P0 文本出现高危词「${highRisk.join('、')}」`);
    }
    if (
      item.labels.expectedLevel === 'P1' &&
      item.labels.sentiment === 'negative' &&
      hasAny(item.text, IMPACT_WORDS).length === 0
    ) {
      levelTextIssues.push(`${item.id}: P1 负评缺明确影响词`);
    }
  }
  add(
    'SE-14',
    '信号词约束：非 P0 单条文本不含高危词、P1 负评必含明确影响词',
    levelTextIssues.length === 0,
    levelTextIssues.slice(0, 5).join('；'),
  );

  const clusterConsistencyIssues = [];
  for (const [key, clusterItems] of clusterMap) {
    const [topic, date] = key.split('|');
    for (const item of clusterItems) {
      if (item.labels.primaryTopic !== topic || item.publishedAt.slice(0, 10) !== date) {
        clusterConsistencyIssues.push(`${key}: ${item.id} 主题/日期与聚合键不一致`);
      }
    }
    if (new Set(clusterItems.map((item) => item.brand)).size !== 1) {
      clusterConsistencyIssues.push(`${key}: 簇内品牌不一致`);
    }
  }
  add(
    'SE-15',
    '同簇内 primaryTopic/日期/品牌一致（聚合键可复算）',
    clusterConsistencyIssues.length === 0,
    clusterConsistencyIssues.slice(0, 5).join('；'),
  );

  const noiseIssues = items.filter(
    (item) =>
      item.labels.noise === true &&
      (item.labels.sentiment !== 'neutral' || item.labels.expectedLevel !== 'none'),
  );
  add(
    'SE-16',
    '噪声标记一致（noise=true => 中性情绪 + 单条 none）',
    noiseIssues.length === 0,
    noiseIssues.map((item) => item.id).slice(0, 5).join('、'),
  );

  const topicCoverageIssues = [];
  for (const item of items) {
    if (item.labels.noise === true) continue;
    const keywords = TOPIC_KEYWORDS[item.labels.primaryTopic] || [];
    if (keywords.length > 0 && hasAny(item.text, keywords).length === 0) {
      topicCoverageIssues.push(`${item.id}: ${item.labels.primaryTopic} 文本缺主题关键词`);
    }
  }
  add(
    'SE-17',
    '非噪声评论文本包含其主题关键词（「其他」除外，保证簇内围绕同一事件）',
    topicCoverageIssues.length === 0,
    topicCoverageIssues.slice(0, 5).join('；'),
  );

  const seDateRange = dateRangeOf(items, (item) => item.publishedAt.slice(0, 10));
  const topicSet = new Set(items.map((item) => item.labels.primaryTopic));
  add(
    'SE-18',
    '日期覆盖 2026-10-20~2026-11-02 且 7 个主题全部出现',
    seDateRange.from === DATE_MIN && seDateRange.to === DATE_MAX && topicSet.size === 7,
    `日期 ${seDateRange.from}~${seDateRange.to}；主题 ${[...topicSet].sort().join('、')}`,
  );

  const labelFieldIssues = items.filter((item) => {
    const labels = item.labels || {};
    return (
      !['positive', 'neutral', 'negative'].includes(labels.sentiment) ||
      typeof labels.note !== 'string' ||
      labels.note.length === 0 ||
      !LEVELS.includes(labels.expectedLevel) ||
      !['p0', 'p1', 'p2', 'none'].includes(labels.severity)
    );
  });
  add(
    'SE-19',
    '舆情金标主字段非空且扩展字段 severity 与 expectedLevel 对应（小写）',
    labelFieldIssues.length === 0,
    labelFieldIssues.map((item) => item.id).slice(0, 5).join('、'),
  );

  const derivedClusterLevels = countBy(clusterInfos, (cluster) => cluster.level);
  add(
    'SE-20',
    '簇级别分布与主题×日期聚合统计一致（manifest 可复算）',
    LEVELS.every((level) => (derivedClusterLevels[level] || 0) === (clusterLevels[level] || 0)) &&
      clusterInfos.every((cluster) => cluster.negativeCount >= 0),
    JSON.stringify(derivedClusterLevels),
  );
}

function validateManifest(manifest, qc, sentiment) {
  const results = [];
  const add = (id, title, ok, detail = '') =>
    results.push({ id, title, ok: !!ok, ...(detail ? { detail } : {}) });
  add(
    'MF-01',
    'manifest 含 004 §7.2 必填字段（version/generatedAt/description/datasets）',
    manifest.version === SPEC_VERSION &&
      ISO_CST.test(manifest.generatedAt) &&
      typeof manifest.description === 'string' &&
      manifest.description.length > 0 &&
      manifest.datasets &&
      typeof manifest.datasets === 'object',
  );
  add(
    'MF-02',
    'manifest.datasets 为对象映射（qc/sentiment 两键）且 file/itemCount 与数据集一致',
    !Array.isArray(manifest.datasets) &&
      !!manifest.datasets.qc &&
      !!manifest.datasets.sentiment &&
      manifest.datasets.qc.file === 'qc/dataset.json' &&
      manifest.datasets.sentiment.file === 'sentiment/dataset.json' &&
      manifest.datasets.qc.itemCount === qc.items.length &&
      manifest.datasets.sentiment.itemCount === sentiment.items.length,
    `qc ${manifest.datasets && manifest.datasets.qc ? manifest.datasets.qc.itemCount : '?'} / sentiment ${manifest.datasets && manifest.datasets.sentiment ? manifest.datasets.sentiment.itemCount : '?'}`,
  );
  add(
    'MF-03',
    'manifest.counts 与数据集实际统计一致',
    manifest.counts &&
      manifest.counts.total === qc.items.length + sentiment.items.length &&
      manifest.counts.qc.total === qc.items.length &&
      manifest.counts.sentiment.total === sentiment.items.length,
  );
  add(
    'MF-04',
    'manifest.checks 自洽（passed/total/passedCount/failed 与 items 一致）',
    !!manifest.checks &&
      manifest.checks.total === manifest.checks.items.length &&
      manifest.checks.passedCount === manifest.checks.items.filter((item) => item.ok).length &&
      manifest.checks.passed === manifest.checks.items.every((item) => item.ok) &&
      Array.isArray(manifest.checks.failed),
  );
  return results;
}

function validateDatasets(qc, sentiment) {
  const items = [];
  const add = (id, title, ok, detail = '') =>
    items.push({ id, title, ok: !!ok, ...(detail ? { detail } : {}) });
  validateQc(qc, add);
  validateSentiment(sentiment, add);
  const passed = items.every((item) => item.ok);
  return { passed, items, failed: items.filter((item) => !item.ok).map((item) => item.id) };
}

// ---------------------------------------------------------------------------
// 输出与入口
// ---------------------------------------------------------------------------
function printUsage() {
  console.log(`QCC Workbench 数据生成器 v${GENERATOR_VERSION}

用法：
  node data/scripts/generate.mjs           生成 data/qc/dataset.json、data/sentiment/dataset.json、data/manifest.json
  node data/scripts/generate.mjs --check   只校验（不写文件）：字节级比对 + 全量约束校验，失败 exit 1
  node data/scripts/generate.mjs --help    显示本帮助

确定性：固定数据源、不联网、不读系统时间，同一命令重复执行输出字节级一致。
契约：specs/004-data-model.md §7.2/§7.3/§7.4；标签口径：specs/007-evaluation-spec.md §3/§5/§6。`);
}

function buildOutputFiles(qc, sentiment, manifest) {
  return [
    { file: 'qc/dataset.json', content: serialize(qc), count: qc.items.length },
    { file: 'sentiment/dataset.json', content: serialize(sentiment), count: sentiment.items.length },
    { file: 'manifest.json', content: serialize(manifest), count: manifest.counts.total },
  ];
}

function clipText(text) {
  if (text === undefined) return '<缺失>';
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function diffSummary(expected, actual) {
  const expectedLines = expected.split('\n');
  const actualLines = actual.split('\n');
  const max = Math.max(expectedLines.length, actualLines.length);
  for (let index = 0; index < max; index += 1) {
    if (expectedLines[index] !== actualLines[index]) {
      return `首个差异在第 ${index + 1} 行：期望 ${clipText(expectedLines[index])} / 实际 ${clipText(actualLines[index])}`;
    }
  }
  return '内容长度不一致';
}

function printStats(qc, sentiment) {
  const qcStats = computeQcStats(qc);
  const sentimentStats = computeSentimentStats(sentiment);
  console.log(
    `  质检集  ${qcStats.total} 条：违规 ${qcStats.violation} / 正常 ${qcStats.pass}，needsReview ${qcStats.needsReview}（implicit ${qcStats.implicit}）`,
  );
  console.log(`           标签命中 ${JSON.stringify(qcStats.tags)}`);
  console.log(
    `           primaryTag ${JSON.stringify(qcStats.primaryTags)}，平均 ${qcStats.avgMessages} 条消息/对话`,
  );
  console.log(
    `           startedAt ${qcStats.dateRange.from} ~ ${qcStats.dateRange.to}（${qcStats.dateRange.distinctDays} 天）`,
  );
  console.log(
    `  舆情集  ${sentimentStats.total} 条：${JSON.stringify(sentimentStats.sentiment)}，噪声 ${sentimentStats.noise}`,
  );
  console.log(
    `           簇 ${sentimentStats.clusters.total} 个：级别 ${JSON.stringify(sentimentStats.clusters.levels)}，单条级别 ${JSON.stringify(sentimentStats.levels)}，聚合升级 P0 ${sentimentStats.clusters.aggregateUpgradedP0} 个`,
  );
  console.log(`           来源 ${JSON.stringify(sentimentStats.sources)}`);
  console.log(
    `           日期 ${sentimentStats.dateRange.from} ~ ${sentimentStats.dateRange.to}（${sentimentStats.dateRange.distinctDays} 天）`,
  );
}

function runGenerate(files, validation, qc, sentiment) {
  const failed = validation.items.filter((item) => !item.ok);
  if (failed.length > 0) {
    console.error('✗ 数据约束校验未通过，已中止生成（不写任何文件）：');
    for (const item of failed) {
      console.error(`  - ${item.id} ${item.title}${item.detail ? `：${item.detail}` : ''}`);
    }
    process.exitCode = 1;
    return;
  }
  for (const directory of ['qc', 'sentiment']) {
    mkdirSync(resolve(DATA_DIR, directory), { recursive: true });
  }
  for (const file of files) {
    writeFileSync(resolve(DATA_DIR, file.file), file.content, 'utf8');
  }
  console.log('✓ 数据生成完成，已写入：');
  for (const file of files) {
    console.log(`  - data/${file.file}（${file.content.length} 字节，${file.count} 条）`);
  }
  printStats(qc, sentiment);
  console.log(
    `✓ 约束校验 ${validation.items.filter((item) => item.ok).length}/${validation.items.length} 通过`,
  );
}

function runCheck(files, validation, qc, sentiment) {
  let filesOk = true;
  console.log('== QCC Workbench 数据校验（--check，只校验、不写文件）==');
  console.log('[1/2] 文件存在性与字节级比对');
  for (const file of files) {
    const target = resolve(DATA_DIR, file.file);
    const label = file.file.padEnd(24, ' ');
    if (!existsSync(target)) {
      filesOk = false;
      console.log(`  ✗ ${label} 文件不存在：${target}`);
      continue;
    }
    const actual = readFileSync(target, 'utf8');
    if (actual === file.content) {
      console.log(`  ✓ ${label} 与生成器输出一致（${actual.length} 字节，${file.count} 条）`);
    } else {
      filesOk = false;
      console.log(`  ✗ ${label} 与生成器输出不一致：${diffSummary(file.content, actual)}`);
    }
  }
  const passedCount = validation.items.filter((item) => item.ok).length;
  console.log(`[2/2] 数据约束校验 ${passedCount}/${validation.items.length} 通过`);
  if (!validation.passed) {
    for (const item of validation.items.filter((entry) => !entry.ok)) {
      console.log(`  ✗ ${item.id} ${item.title}${item.detail ? `：${item.detail}` : ''}`);
    }
  }
  printStats(qc, sentiment);
  const ok = filesOk && validation.passed;
  console.log(
    ok
      ? `结果：PASS（文件字节级一致 + 约束 ${passedCount}/${validation.items.length} 通过）`
      : `结果：FAIL（文件${filesOk ? '一致' : '不一致'}，约束 ${passedCount}/${validation.items.length} 通过）`,
  );
  process.exitCode = ok ? 0 : 1;
}

function main() {
  const args = process.argv.slice(2);
  const knownArgs = ['--check', '--help', '-h'];
  const unknownArgs = args.filter((arg) => !knownArgs.includes(arg));
  if (unknownArgs.length > 0) {
    console.error(`未知参数：${unknownArgs.join(' ')}`);
    printUsage();
    process.exitCode = 1;
    return;
  }
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }
  const checkMode = args.includes('--check');

  const qc = buildQcDataset();
  const sentiment = buildSentimentDataset();
  const validation = validateDatasets(qc, sentiment);

  // manifest 依赖校验结果；再补 manifest 自检，并把结果回填 checks 后重建。
  let manifest = buildManifest(qc, sentiment, validation);
  for (const item of validateManifest(manifest, qc, sentiment)) {
    validation.items.push(item);
  }
  validation.passed = validation.items.every((item) => item.ok);
  validation.failed = validation.items.filter((item) => !item.ok).map((item) => item.id);
  manifest = buildManifest(qc, sentiment, validation);

  const files = buildOutputFiles(qc, sentiment, manifest);
  if (checkMode) runCheck(files, validation, qc, sentiment);
  else runGenerate(files, validation, qc, sentiment);
}

main();

