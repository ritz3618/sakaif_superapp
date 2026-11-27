/** グラフの画面とサーバーがやり取りするデータの型(2026-11-27 ユーザー決定)。 */

export type ChartUnit = "day" | "week" | "month";

/** 期間の切り替えの設定: 日ごと(直近4週)・週ごと(直近12週)・月ごと(直近12か月) */
export const CHART_UNITS: readonly { unit: ChartUnit; label: string; count: number }[] = [
  { unit: "day", label: "日ごと", count: 28 },
  { unit: "week", label: "週ごと", count: 12 },
  { unit: "month", label: "月ごと", count: 12 },
];

/** グラフの1区切り(日・週・月)。値は、週・月では「1日あたりの平均」 */
export interface ChartBucket {
  /** 区切りの始まりと終わり(日本時間の日付、終わりを含む) */
  from: string;
  to: string;
  /** 横軸の短い名前(例: 「11/27」「11/21〜」「11月」) */
  label: string;
  /** 平均に使えた日数(記録がそろった日)。0 なら値は null */
  days: number;
  /** 今日を含み、まだ途中の区切り(日ごとの今日) */
  partial: boolean;
  feedingMl: number | null;
  feedingCount: number | null;
  /** 授乳の平均の間隔(分) */
  feedingIntervalMinutes: number | null;
  sleepMinutes: number | null;
  poopCount: number | null;
  peeCount: number | null;
  /** 室温・湿度の平均・最低・最高 */
  temperature: { avg: number; min: number; max: number } | null;
  humidity: { avg: number; min: number; max: number } | null;
}

/** 記録した日の点(体重・身長・体温) */
export interface ChartPoint {
  at: string;
  value: number;
}

export interface ChartData {
  unit: ChartUnit;
  /** 期間の最後の日(日本時間) */
  end: string;
  buckets: ChartBucket[];
  weight: ChartPoint[];
  height: ChartPoint[];
  temperature: ChartPoint[];
  dailyTargetMl: number | null;
  /** まだ集計が終わっていない日の数。0 より大きければ、少し待ってもう一度読む */
  pending: number;
}
