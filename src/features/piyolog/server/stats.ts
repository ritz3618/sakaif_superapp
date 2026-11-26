/**
 * 集計(純粋な計算。テストで確認している)。
 * - 「今日」は日本時間の0時から今まで。
 * - 睡眠は「寝る」と「起きる」の記録の組から時間帯を作り、日付をまたぐ分は日ごとに分ける(23時〜翌6時なら、前日1時間・当日6時間)。
 * - 過去との比較は、過去7日それぞれの「0時から、今と同じ時刻まで」の値の平均。データが無い日は数えない。
 */
import { DAY_MS, jstStartOfDay } from "../../../core/shared/time";
import type { DayMetrics } from "../shared/api";
import { FEEDING_TYPES, SLEEP_TYPE, WAKE_TYPE } from "../shared/records";

export interface StatRecord {
  type: string;
  at: number;
  value: number | null;
  unit: string | null;
}

export interface Interval {
  start: number;
  end: number;
}

const feedingTypes = new Set<string>(FEEDING_TYPES);

/** 「寝る」〜「起きる」の時間帯の一覧。最後が「寝る」なら、今まで寝ているとみなす。 */
export function sleepIntervals(records: readonly StatRecord[], now: number): Interval[] {
  const events = records.filter((r) => r.type === SLEEP_TYPE || r.type === WAKE_TYPE).sort((a, b) => a.at - b.at);
  const intervals: Interval[] = [];
  let open: number | null = null;
  for (const e of events) {
    if (e.type === SLEEP_TYPE) {
      if (open === null) open = e.at; // 「寝る」が続いたときは、最初の「寝る」から数える
    } else if (open !== null) {
      if (e.at > open) intervals.push({ start: open, end: e.at });
      open = null;
    }
  }
  if (open !== null && now > open) intervals.push({ start: open, end: now });
  return intervals;
}

function overlapMs(intervals: readonly Interval[], start: number, end: number): number {
  let total = 0;
  for (const i of intervals) {
    const s = Math.max(i.start, start);
    const e = Math.min(i.end, end);
    if (e > s) total += e - s;
  }
  return total;
}

/** [start, end) の間の値 */
export function metricsBetween(
  records: readonly StatRecord[],
  intervals: readonly Interval[],
  start: number,
  end: number,
): DayMetrics {
  const m: DayMetrics = { feedingCount: 0, feedingMl: 0, sleepMinutes: 0, peeCount: 0, poopCount: 0 };
  for (const r of records) {
    if (r.at < start || r.at >= end) continue;
    if (feedingTypes.has(r.type)) {
      m.feedingCount++;
      if (r.value !== null && r.unit === "ml") m.feedingMl += r.value;
    } else if (r.type === "Pee") {
      m.peeCount++;
    } else if (r.type === "Poop") {
      m.poopCount++;
    }
  }
  m.sleepMinutes = Math.round(overlapMs(intervals, start, end) / 60000);
  return m;
}

export interface Stats {
  today: DayMetrics;
  comparison: { days: number; average: DayMetrics } | null;
}

/**
 * records は、今日の0時の8日前より後の記録(削除の印が付いたものを除く)。
 * earliestAt は、保存されている最も古い記録の時刻(比較に使える日を決める)。
 */
export function computeStats(records: readonly StatRecord[], now: number, earliestAt: number | null): Stats {
  const intervals = sleepIntervals(records, now);
  const todayStart = jstStartOfDay(new Date(now)).getTime();
  const elapsed = now - todayStart;
  const today = metricsBetween(records, intervals, todayStart, now);

  const past: DayMetrics[] = [];
  for (let d = 1; d <= 7; d++) {
    const dayStart = todayStart - d * DAY_MS;
    // その日の0時より前からデータがある日だけを比べる(途中から記録が始まった日は、少なく見えるため除く)
    if (earliestAt === null || earliestAt > dayStart) continue;
    past.push(metricsBetween(records, intervals, dayStart, dayStart + elapsed));
  }
  if (past.length === 0) return { today, comparison: null };
  const avg = (pick: (m: DayMetrics) => number) => past.reduce((sum, m) => sum + pick(m), 0) / past.length;
  return {
    today,
    comparison: {
      days: past.length,
      average: {
        feedingCount: avg((m) => m.feedingCount),
        feedingMl: avg((m) => m.feedingMl),
        sleepMinutes: avg((m) => m.sleepMinutes),
        peeCount: avg((m) => m.peeCount),
        poopCount: avg((m) => m.poopCount),
      },
    },
  };
}
