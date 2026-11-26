/**
 * 過去1週間との比較の表示(純粋な計算。テストで確認している)。
 * 数値そのものを比べる(2026-11-26 ユーザー: 通知ではなく、画面で状況を示すのが目的なので、差の大小で「ほぼ同じ」にしない)。
 * 比べるのは、画面に出す単位にそろえた値(量は1ml、時間は1分、回数は0.1回)。
 */

export type CompareDirection = "more" | "less" | "same";

export interface CompareResult {
  direction: CompareDirection;
  /** 例: 「+60ml」「-1回」「+30分」「同じ」 */
  diffText: string;
}

export type CompareUnit = "count" | "ml" | "minutes";

/** 画面に出す単位にそろえる */
function round(value: number, unit: CompareUnit): number {
  return unit === "count" ? Math.round(value * 10) / 10 : Math.round(value);
}

function formatDiff(diff: number, unit: CompareUnit): string {
  const sign = diff > 0 ? "+" : "-";
  const abs = Math.abs(diff);
  if (unit === "count") return `${sign}${Number.isInteger(abs) ? abs : abs.toFixed(1)}回`;
  if (unit === "ml") return `${sign}${abs}ml`;
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h > 0 ? `${h}時間${m > 0 ? `${m}分` : ""}` : `${m}分`}`;
}

export function compare(today: number, average: number, unit: CompareUnit): CompareResult {
  const diff = round(round(today, unit) - round(average, unit), unit);
  if (diff === 0) return { direction: "same", diffText: "同じ" };
  return { direction: diff > 0 ? "more" : "less", diffText: formatDiff(diff, unit) };
}

/** 「少なめ」: ふだんの値より少ないとき(回数には使わない。2026-11-26 ユーザー) */
export function isShort(today: number, average: number, unit: "ml" | "minutes"): boolean {
  return compare(today, average, unit).direction === "less";
}
