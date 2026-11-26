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
