/**
 * 過去1週間との比較の表示(純粋な計算。テストで確認している)。
 * 差が小さいとき(回数は0.5回未満、量は5%未満、時間は10分未満)は「ほぼ同じ」にする。
 */

export type CompareDirection = "more" | "less" | "same";

export interface CompareResult {
  direction: CompareDirection;
  /** 例: 「+60ml」「-1回」「+30分」 */
  diffText: string;
}

export type CompareUnit = "count" | "ml" | "minutes";

function formatDiff(diff: number, unit: CompareUnit): string {
  const sign = diff > 0 ? "+" : "-";
  const abs = Math.abs(diff);
  if (unit === "count") return `${sign}${Number.isInteger(abs) ? abs : abs.toFixed(1)}回`;
  if (unit === "ml") return `${sign}${Math.round(abs)}ml`;
  const minutes = Math.round(abs);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${sign}${h > 0 ? `${h}時間${m > 0 ? `${m}分` : ""}` : `${m}分`}`;
}

export function compare(today: number, average: number, unit: CompareUnit): CompareResult {
  const diff = today - average;
  const threshold = unit === "count" ? 0.5 : unit === "ml" ? Math.max(5, average * 0.05) : 10;
  if (Math.abs(diff) < threshold) return { direction: "same", diffText: "ほぼ同じ" };
  return { direction: diff > 0 ? "more" : "less", diffText: formatDiff(Math.round(diff * 10) / 10, unit) };
}

/**
 * 「いつもより少ない」の目安(2026-11-26 提案。ユーザーの確認待ち)。
 * ふだんの 85% 未満で、差が一定以上(量は30ml以上、睡眠は30分以上)のとき。
 * 回数では使わない(回数は日によってばらつくため、警告しない。2026-11-26 ユーザー)。
 */
export const SHORTAGE_RATIO = 0.85;
const SHORTAGE_MIN_DIFF: Record<"ml" | "minutes", number> = { ml: 30, minutes: 30 };

export function isShort(today: number, average: number, unit: "ml" | "minutes"): boolean {
  return average > 0 && today < average * SHORTAGE_RATIO && average - today >= SHORTAGE_MIN_DIFF[unit];
}
