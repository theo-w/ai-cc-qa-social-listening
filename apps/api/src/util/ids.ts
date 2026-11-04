/** 顺序 ID 生成：前缀 + 4 位序号（确定性，取已有最大序号 +1）。 */
export function nextSequentialId(prefix: string, existing: readonly string[], digits = 4): string {
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`);
  let max = 0;
  for (const id of existing) {
    const matched = pattern.exec(id);
    if (matched) {
      const value = Number(matched[1]);
      if (Number.isInteger(value) && value > max) {
        max = value;
      }
    }
  }
  return `${prefix}${String(max + 1).padStart(digits, '0')}`;
}
