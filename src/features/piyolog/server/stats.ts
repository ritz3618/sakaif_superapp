/**
 * 集計(純粋な計算。テストで確認している)。
 * - 「今日」は日本時間の0時から今まで。
 * - 睡眠は「寝る」と「起きる」の記録の組から時間帯を作り、日付をまたぐ分は日ごとに分ける(23時〜翌6時なら、前日1時間・当日6時間)。
 * - 過去との比較の決まりは、computeStats の説明を参照。
 */
import { DAY_MS, jstDate, jstStartOfDay } from "../../../core/shared/time";
import type { Comparison, DayMetrics, MinuteSpan, TimelineDay } from "../shared/api";
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
  const m: DayMetrics = { feedingCount: 0, feedingMl: 0, feedingMlCount: 0, sleepMinutes: 0, peeCount: 0, poopCount: 0 };
  for (const r of records) {
    if (r.at < start || r.at >= end) continue;
    if (feedingTypes.has(r.type)) {
      m.feedingCount++;
      if (r.value !== null && r.unit === "ml") {
        m.feedingMl += r.value;
        m.feedingMlCount++;
      }
    } else if (r.type === "Pee") {
      m.peeCount++;
    } else if (r.type === "Poop") {
      m.poopCount++;
    }
  }
  m.sleepMinutes = Math.round(overlapMs(intervals, start, end) / 60000);
  return m;
}

const METRIC_KEYS = ["feedingCount", "feedingMl", "feedingMlCount", "sleepMinutes", "peeCount", "poopCount"] as const;

function average(days: readonly DayMetrics[]): Comparison | null {
  if (days.length === 0) return null;
  const avg = {} as DayMetrics;
  for (const key of METRIC_KEYS) avg[key] = days.reduce((sum, m) => sum + m[key], 0) / days.length;
  return { days: days.length, average: avg };
}

export interface Stats {
  today: DayMetrics;
  yesterday: DayMetrics | null;
  sameTime: Comparison | null;
  fullDay: Comparison | null;
  perFeedingMl: number | null;
}

/**
 * records は、今日の0時の9日前より後の記録(削除の印が付いたものを除く)。
 * earliestAt は、保存されている最も古い記録の時刻(比較に使える日を決める)。
 *
 * 比べ方(2026-11-26):
 * - 今日(0時〜今)は、過去7日(昨日〜7日前)それぞれの「0時〜今と同じ時刻」の平均と比べる。
 * - 昨日(1日分)は、その前の7日(2日前〜8日前)の1日分の平均と比べる。
 * - 比較に使う日は、その日の0時より前から記録があり、その日に1件以上の記録がある日だけ
 *   (記録を始めた日や、記録の抜けている日は、少なく見えるため除く)。
 */
export function computeStats(records: readonly StatRecord[], now: number, earliestAt: number | null): Stats {
  const intervals = sleepIntervals(records, now);
  const todayStart = jstStartOfDay(new Date(now)).getTime();
  const elapsed = now - todayStart;
  const today = metricsBetween(records, intervals, todayStart, now);

  const usable = (dayStart: number) =>
    earliestAt !== null && earliestAt <= dayStart && records.some((r) => r.at >= dayStart && r.at < dayStart + DAY_MS);

  const sameTimeDays: DayMetrics[] = [];
  const recentFullDays: DayMetrics[] = [];
  for (let d = 1; d <= 7; d++) {
    const dayStart = todayStart - d * DAY_MS;
    if (!usable(dayStart)) continue;
    sameTimeDays.push(metricsBetween(records, intervals, dayStart, dayStart + elapsed));
    recentFullDays.push(metricsBetween(records, intervals, dayStart, dayStart + DAY_MS));
  }
  const olderFullDays: DayMetrics[] = [];
  for (let d = 2; d <= 8; d++) {
    const dayStart = todayStart - d * DAY_MS;
    if (usable(dayStart)) olderFullDays.push(metricsBetween(records, intervals, dayStart, dayStart + DAY_MS));
  }

  const yesterdayStart = todayStart - DAY_MS;
  const hasYesterday = records.some((r) => r.at >= yesterdayStart && r.at < todayStart);
  const mlTotal = recentFullDays.reduce((sum, m) => sum + m.feedingMl, 0);
  const mlCount = recentFullDays.reduce((sum, m) => sum + m.feedingMlCount, 0);

  return {
    today,
    yesterday: hasYesterday ? metricsBetween(records, intervals, yesterdayStart, todayStart) : null,
    sameTime: average(sameTimeDays),
    fullDay: average(olderFullDays),
    perFeedingMl: mlCount > 0 ? mlTotal / mlCount : null,
  };
}

/** 授乳の帯の長さ(飲み始めから30分)と、うんちの帯の長さ(15分)。表示だけに使う(2026-11-26 ユーザー指定) */
export const FEEDING_SPAN_MINUTES = 30;
export const POOP_SPAN_MINUTES = 15;

/**
 * 時間の帯の表示のための、1日分の記録(0時からの分)。
 * 起きている時間は、記録がある範囲(最初の記録の時刻、または0時〜 until)のうち、寝ていない時間。
 */
export function timelineDay(
  records: readonly StatRecord[],
  intervals: readonly Interval[],
  dayStart: number,
  until: number,
  earliestAt: number | null,
): TimelineDay {
  const toMinute = (t: number) => Math.max(0, Math.min(1440, Math.round((t - dayStart) / 60000)));
  const end = Math.min(dayStart + DAY_MS, until);
  const knownFrom = earliestAt === null ? end : Math.max(dayStart, earliestAt);

  const sleep: MinuteSpan[] = [];
  for (const i of intervals) {
    const s = Math.max(i.start, dayStart);
    const e = Math.min(i.end, end);
    if (e > s) sleep.push({ start: toMinute(s), end: toMinute(e) });
  }
  sleep.sort((a, b) => a.start - b.start);

  const awake: MinuteSpan[] = [];
  let cursor = toMinute(knownFrom);
  const last = toMinute(end);
  for (const s of sleep) {
    if (s.start > cursor) awake.push({ start: cursor, end: s.start });
    cursor = Math.max(cursor, s.end);
  }
  if (last > cursor) awake.push({ start: cursor, end: last });

  const inDay = records.filter((r) => r.at >= dayStart && r.at < end);
  return {
    date: jstDate(new Date(dayStart)),
    until: toMinute(end),
    sleep,
    awake,
    feedings: inDay
      .filter((r) => feedingTypes.has(r.type))
      .map((r) => ({ at: toMinute(r.at), ml: r.value !== null && r.unit === "ml" ? r.value : null })),
    poops: inDay.filter((r) => r.type === "Poop").map((r) => toMinute(r.at)),
  };
}

/** 今日と昨日の時間の帯 */
export function computeTimeline(records: readonly StatRecord[], now: number, earliestAt: number | null): TimelineDay[] {
  const intervals = sleepIntervals(records, now);
  const todayStart = jstStartOfDay(new Date(now)).getTime();
  return [
    timelineDay(records, intervals, todayStart, now, earliestAt),
    timelineDay(records, intervals, todayStart - DAY_MS, todayStart, earliestAt),
  ];
}
