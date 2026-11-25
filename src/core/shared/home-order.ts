/**
 * ホームのカードの並び順(ユーザーごと)。
 * 保存された順に並べ、保存後に増えた機能は、既定の順で最後に足す。消えた機能は無視する。
 */
export function applyHomeOrder(defaultIds: readonly string[], saved: readonly string[] | null): string[] {
  if (!saved) return [...defaultIds];
  const known = new Set(defaultIds);
  const ordered: string[] = [];
  for (const id of saved) {
    if (known.has(id) && !ordered.includes(id)) ordered.push(id);
  }
  return [...ordered, ...defaultIds.filter((id) => !ordered.includes(id))];
}

/** 保存する並び順の検査。すべて既知の機能IDで、重複が無いこと。 */
export function isValidHomeOrder(defaultIds: readonly string[], order: unknown): order is string[] {
  if (!Array.isArray(order) || order.length > defaultIds.length) return false;
  const known = new Set(defaultIds);
  return order.every((id, i) => typeof id === "string" && known.has(id) && order.indexOf(id) === i);
}
