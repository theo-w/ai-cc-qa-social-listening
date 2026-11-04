/**
 * 敏感信息脱敏：手机号 / 邮箱 / 身份证号 / 订单号 / 银行卡号。
 *
 * 原则：入库（种子化）时即脱敏，读接口再兜底脱敏一次（幂等），
 * 保证任何 API 响应都不会出现完整号码（FR-QC-010）。
 */

const PHONE_PATTERN = /(?<!\d)(1[3-9]\d)(\d{4})(\d{4})(?!\d)/g;
const EMAIL_PATTERN = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*(@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const ID_CARD_PATTERN = /(?<![\dA-Za-z])(\d{6})(\d{8})(\d{3}[\dXx])(?![\dA-Za-z])/g;
const ORDER_PATTERN = /(订单号?|order(?:\s*id)?|Order(?:\s*ID)?)\s*[:：]?\s*([A-Za-z0-9]{6,})/g;
const BANK_CARD_PATTERN = /(?<!\d)(\d{4})\d{8,11}(\d{4})(?!\d)/g;

/** 13812345678 → 138****5678 */
function maskPhone(match: string, head: string, _middle: string, tail: string): string {
  return `${head}****${tail}`;
}

/** zhangsan@example.com → z***@example.com */
function maskEmail(match: string, head: string, domain: string): string {
  return `${head}***${domain}`;
}

/** 110101199001011234 → 110101********1234 */
function maskIdCard(match: string, head: string, _birth: string, tail: string): string {
  return `${head}********${tail}`;
}

/** 订单号 ABC123456789 → 订单号 ABC****6789 */
function maskOrder(match: string, label: string, value: string): string {
  if (value.length <= 7) {
    return match;
  }
  const head = value.slice(0, 3);
  const tail = value.slice(-4);
  return `${label} ${head}****${tail}`;
}

/** 6222021234567890 → 6222********7890 */
function maskBankCard(match: string, head: string, tail: string): string {
  return `${head}********${tail}`;
}

/**
 * 对文本做脱敏。已经是掩码形式（含 `*`）的内容不会被二次破坏。
 */
export function maskText(input: string): string {
  return input
    .replace(PHONE_PATTERN, maskPhone)
    .replace(EMAIL_PATTERN, maskEmail)
    .replace(ID_CARD_PATTERN, maskIdCard)
    .replace(ORDER_PATTERN, maskOrder)
    .replace(BANK_CARD_PATTERN, maskBankCard);
}

/** 客户名等短文本的兜底脱敏（与正文同规则）。 */
export function maskName(input: string): string {
  return maskText(input);
}
