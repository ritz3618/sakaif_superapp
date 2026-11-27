/**
 * グラフ用の、1日ごとの集計。
 * - 記録から計算し、昨日より前の日は piyolog_daily に控えておく(1年分をその場で計算すると、1回の処理が重くなるため)。
 * - 1回の計算は最大 MAX_COMPUTE_DAYS 日分。残りは pending として返し、画面がもう一度読む。定期実行でも少しずつ埋める。
 * - 月ごとのテキストを取り込んだときは、その期間の控えを消す(作り直される)。
 */
import type { SharedData } from "../../../core/server/feature-api";
import { DAY_MS, addDays, jstDate, jstDayStart } from "../../../core/shared/time";
import type { DayMetrics } from "../shared/api";
import { FEEDING_TYPES, PIYOLOG_SOURCE } from "../shared/records";
import { metricsBetween, sleepIntervals, type StatRecord } from "./stats";

export const MAX_COMPUTE_DAYS = 45;

export interface DailyMetrics extends DayMetrics {
  /** その日に記録が1件以上あるか(無い日は平均に入れない) */
  hasData: boolean;
  /** 授乳の間隔の合計(分)と数。間隔は、その日の授乳と、直前の授乳(前の日でもよい)の飲み始めの差 */
  intervalSum: number;
  intervalCount: number;
}

const feedingTypes = new Set<string>(FEEDING_TYPES);
/** これより長い間隔は、記録の抜けとみなして間隔の平均に入れない */
const MAX_INTERVAL_MINUTES = 12 * 60;

/** 記録から、日ごとの集計を作る(純粋な計算。テストで確認している) */
export function computeDays(records: readonly StatRecord[], days: readonly string[], now: number): Record<string, DailyMetrics> {
  const intervals = sleepIntervals(records, now);
  const feedings = records.filter((r) => feedingTypes.has(r.type)).map((r) => r.at).sort((a, b) => a - b);
  const result: Record<string, DailyMetrics> = {};
  for (const day of days) {
    const start = jstDayStart(day).getTime();
    const end = Math.min(start + DAY_MS, now);
    const m = metricsBetween(records, intervals, start, end);
    let intervalSum = 0;
    let intervalCount = 0;
    for (let i = 1; i < feedings.length; i++) {
      const at = feedings[i]!;
      if (at < start || at >= end) continue;
      const minutes = (at - feedings[i - 1]!) / 60000;
      if (minutes > 0 && minutes <= MAX_INTERVAL_MINUTES) {
        intervalSum += minutes;
        intervalCount++;
      }
    }
    result[day] = {
      ...m,
      hasData: records.some((r) => r.at >= start && r.at < end),
      intervalSum: Math.round(intervalSum),
      intervalCount,
    };
  }
  return result;
}

const EMPTY_DAY: DailyMetrics = {
  feedingCount: 0,
  feedingMl: 0,
  feedingMlCount: 0,
  sleepMinutes: 0,
  peeCount: 0,
  poopCount: 0,
  hasData: false,
  intervalSum: 0,
  intervalCount: 0,
};

/** 控えてよい日(昨日より前。直近はフィードの更新で変わりうる) */
const cacheable = (day: string, today: string) => day < addDays(today, -1);

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * from〜to(日本時間の日付、両端を含む)の日ごとの集計。
 * 控えがある日は控えを使い、無い日は新しい日から最大 MAX_COMPUTE_DAYS 日分を計算する。
 */
export async function dailyRange(
  db: D1Database,
  data: SharedData,
  from: string,
  to: string,
  now: Date,
): Promise<{ days: Record<string, DailyMetrics>; pending: number }> {
  const today = jstDate(now);
  const all = daysBetween(from, to > today ? today : to);
  const [rows, earliest] = await Promise.all([
    db
      .prepare("SELECT date, metrics FROM piyolog_daily WHERE date >= ? AND date <= ?")
      .bind(from, to)
      .all<{ date: string; metrics: string }>(),
    data.earliestAt(PIYOLOG_SOURCE),
  ]);
  const days: Record<string, DailyMetrics> = {};
  for (const r of rows.results) days[r.date] = JSON.parse(r.metrics) as DailyMetrics;
  // 最も古い記録より前の日は、記録が無いと分かっているので計算しない
  const firstDay = earliest ? jstDate(new Date(earliest)) : addDays(today, 1);
  for (const d of all) if (d < firstDay) days[d] = EMPTY_DAY;

  const missing = all.filter((d) => d >= firstDay && (!days[d] || !cacheable(d, today))).reverse(); // 新しい日から
  const batch = missing.slice(0, MAX_COMPUTE_DAYS);
  if (batch.length > 0) {
    const lo = batch.at(-1)!;
    const hi = batch[0]!;
    // 前の夜からの睡眠と、直前の授乳のため、1日前から読む
    const records = (
      await data.query(PIYOLOG_SOURCE, {
        from: new Date(jstDayStart(lo).getTime() - DAY_MS).toISOString(),
        to: new Date(jstDayStart(hi).getTime() + DAY_MS).toISOString(),
      })
    ).map((r) => ({ type: r.kind, at: Date.parse(r.recordedAt), value: r.value, unit: r.unit }));
    const computed = computeDays(records, batch, now.getTime());
    Object.assign(days, computed);
    const at = now.toISOString();
    const stmts = batch
      .filter((d) => cacheable(d, today))
      .map((d) =>
        db
          .prepare(
            "INSERT INTO piyolog_daily (date, metrics, computed_at) VALUES (?, ?, ?) " +
              "ON CONFLICT(date) DO UPDATE SET metrics = excluded.metrics, computed_at = excluded.computed_at",
          )
          .bind(d, JSON.stringify(computed[d]), at),
      );
    if (stmts.length > 0) await db.batch(stmts);
  }
  return { days, pending: Math.max(0, missing.length - batch.length) };
}

/** 定期実行で、まだ控えの無い過去の日を少しずつ埋める(最も古い記録の日まで) */
export async function warmDailyCache(db: D1Database, data: SharedData, now: Date): Promise<number> {
  const earliest = await data.earliestAt(PIYOLOG_SOURCE);
  if (!earliest) return 0;
  const today = jstDate(now);
  const last = addDays(today, -2);
  const first = jstDate(new Date(earliest));
  if (first > last) return 0;
  // 控えが無い日のうち、新しい日から30日分
  const rows = await db.prepare("SELECT date FROM piyolog_daily WHERE date >= ?").bind(first).all<{ date: string }>();
  const have = new Set(rows.results.map((r) => r.date));
  const todo = daysBetween(first, last).filter((d) => !have.has(d)).slice(-30);
  if (todo.length === 0) return 0;
  await dailyRange(db, data, todo[0]!, todo.at(-1)!, now);
  return todo.length;
}

/** 取り込みなどで記録が変わった期間の控えを消す */
export async function invalidateDaily(db: D1Database, from: string, to: string): Promise<void> {
  await db.prepare("DELETE FROM piyolog_daily WHERE date >= ? AND date <= ?").bind(from, to).run();
}
