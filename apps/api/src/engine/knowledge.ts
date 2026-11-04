/**
 * 知识库校验引擎（009 / R-QC-KNW-KB）。
 *
 * 纯函数、确定性：给定消息与已发布知识条目，输出可解释的知识错误命中。
 * - 结构化事实：数值（number）、时效（duration_minutes）、日期（date）按提取值与标准值比对；
 * - 文本口径：直接按 violationPatterns 命中；
 * - 只能由「已发布」条目参与判定；草稿/下线条目不生效；
 * - 不读系统时间、不随机，同一输入输出完全一致。
 */
import type {
  KnowledgeEntry,
  KnowledgeFact,
  KnowledgeRef,
  MessageRole,
} from '../types.js';

/** 供给质检引擎的消息最小结构。 */
export interface KnowledgeInputMessage {
  seq: number;
  role: MessageRole;
  text: string;
}

export interface KnowledgeMatch extends FactCheckResult {
  entry: KnowledgeEntry;
}

export interface FactCheckResult {
  fact: KnowledgeFact;
  /** true=冲突；false=一致；null=已被事实覆盖但缺少可比较的标准值。 */
  violation: boolean | null;
  expected: string;
  actual: string;
  /** 命中方式：结构化陈述 / 文本违规。 */
  via: 'claim' | 'text';
}

export interface KnowledgeHit {
  seq: number;
  quote: string;
  confidence: number;
  ruleId: string;
  note: string;
  ref: KnowledgeRef;
}

const KB_RULE_ID = 'R-QC-KNW-KB';
const MAX_QUOTE_LENGTH = 60;

/** 编译后的正则缓存：同一进程内重复使用，避免每次分析都重新编译。 */
const patternCache = new Map<string, RegExp | null>();

function compile(source: string): RegExp | null {
  const cached = patternCache.get(source);
  if (cached !== undefined) {
    return cached;
  }
  let compiled: RegExp | null = null;
  try {
    compiled = new RegExp(source);
  } catch {
    compiled = null;
  }
  patternCache.set(source, compiled);
  return compiled;
}

function clip(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= MAX_QUOTE_LENGTH ? trimmed : trimmed.slice(0, MAX_QUOTE_LENGTH);
}

/** 时效单位换算为分钟（工作日按 8 小时折算）。无法识别返回 null。 */
function unitToMinutes(unit: string): number | null {
  switch (unit) {
    case '分钟':
      return 1;
    case '小时':
      return 60;
    case '天':
    case '自然日':
      return 24 * 60;
    case '工作日':
      return 8 * 60;
    default:
      return null;
  }
}

function firstMatch(patterns: readonly string[], text: string): RegExpExecArray | null {
  for (const source of patterns) {
    const pattern = compile(source);
    if (pattern === null) {
      continue;
    }
    const match = pattern.exec(text);
    if (match !== null) {
      return match;
    }
  }
  return null;
}

/** 已发布条目才参与质检。 */
export function publishedKnowledge(entries: readonly KnowledgeEntry[]): KnowledgeEntry[] {
  return entries.filter((entry) => entry.status === 'published');
}

/**
 * 用单个事实检查一段文本。
 * 返回 null 表示该文本未被此事实的规则覆盖；否则给出是否冲突与实际陈述。
 */
export function checkFact(fact: KnowledgeFact, text: string): FactCheckResult | null {
  // 1) 直接违规口径优先（如「公告是旧的」「不存在误封」）。
  const violationMatch = firstMatch(fact.violationPatterns, text);
  if (violationMatch !== null) {
    return {
      fact,
      violation: true,
      expected: fact.expected,
      actual: clip(violationMatch[0]),
      via: 'text',
    };
  }

  // 2) 结构化陈述提取与比对。
  if (fact.compare === 'text') {
    return null;
  }

  const match = firstMatch(fact.claimPatterns, text);
  if (match === null) {
    return null;
  }

  if (fact.compare === 'number') {
    const value = Number(match[1]);
    if (!Number.isFinite(value)) {
      return null;
    }
    const actual = `${match[1]}${fact.unit ?? ''}`;
    if (fact.expectedNumber === undefined || fact.expectedNumber === null) {
      return {
        fact,
        violation: null,
        expected: fact.expected,
        actual,
        via: 'claim',
      };
    }
    return {
      fact,
      violation: value !== fact.expectedNumber,
      expected: fact.expected,
      actual,
      via: 'claim',
    };
  }

  if (fact.compare === 'duration_minutes') {
    const value = Number(match[1]);
    const unit = match[2] ?? '';
    const unitMinutes = unitToMinutes(unit);
    if (!Number.isFinite(value) || unitMinutes === null) {
      return null;
    }
    const actual = `${match[1]}${unit}`;
    if (fact.expectedMinutes === undefined || fact.expectedMinutes === null) {
      return {
        fact,
        violation: null,
        expected: fact.expected,
        actual,
        via: 'claim',
      };
    }
    return {
      fact,
      violation: value * unitMinutes !== fact.expectedMinutes,
      expected: fact.expected,
      actual,
      via: 'claim',
    };
  }

  // date
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (!Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  const actual = `${month} 月 ${day} 日`;
  if (
    fact.expectedMonth === undefined ||
    fact.expectedMonth === null ||
    fact.expectedDay === undefined ||
    fact.expectedDay === null
  ) {
    return {
      fact,
      violation: null,
      expected: fact.expected,
      actual,
      via: 'claim',
    };
  }
  return {
    fact,
    violation: month !== fact.expectedMonth || day !== fact.expectedDay,
    expected: fact.expected,
    actual,
    via: 'claim',
  };
}

/**
 * 在全部已发布条目中查找能覆盖某段文本的事实。
 * 用于把旧兜底规则命中绑定到知识条目，或判定旧规则是否应被知识库推翻。
 */
export function matchKnowledge(
  text: string,
  entries: readonly KnowledgeEntry[],
): KnowledgeMatch | null {
  for (const entry of publishedKnowledge(entries)) {
    for (const fact of entry.facts) {
      const result = checkFact(fact, text);
      if (result !== null) {
        return { ...result, entry };
      }
    }
  }
  return null;
}

/** 由匹配结果构造 QcTag.knowledge 引用。 */
export function knowledgeRefFromMatch(match: KnowledgeMatch, ruleId: string = KB_RULE_ID): KnowledgeRef {
  return {
    entryId: match.entry.id,
    code: match.entry.code,
    title: match.entry.title,
    factKey: match.fact.key,
    factLabel: match.fact.label,
    expected: match.expected,
    actual: match.actual,
    ruleId,
  };
}

/**
 * 扫描坐席消息，产出知识库驱动的 wrong_knowledge 命中。
 * 只产出「冲突」命中；一致或无标准值不产出。
 */
export function detectKnowledgeHits(
  messages: readonly KnowledgeInputMessage[],
  entries: readonly KnowledgeEntry[],
): KnowledgeHit[] {
  const published = publishedKnowledge(entries);
  if (published.length === 0) {
    return [];
  }
  const hits: KnowledgeHit[] = [];
  const seen = new Set<string>();

  for (const message of messages) {
    if (message.role !== 'agent') {
      continue;
    }
    for (const entry of published) {
      for (const fact of entry.facts) {
        const result = checkFact(fact, message.text);
        if (result === null || result.violation !== true) {
          continue;
        }
        const key = `${entry.id}|${fact.key}|${message.seq}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        const ref = knowledgeRefFromMatch({ ...result, entry });
        hits.push({
          seq: message.seq,
          quote: clip(message.text),
          confidence: result.via === 'text' ? 0.86 : 0.9,
          ruleId: KB_RULE_ID,
          note: `${entry.code} ${fact.label}：标准「${result.expected}」，坐席「${result.actual}」`,
          ref,
        });
      }
    }
  }
  return hits;
}
