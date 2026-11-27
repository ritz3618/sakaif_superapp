/**
 * グラフのデータ(GET /charts?unit=day|week|month&end=YYYY-MM-DD)。
 * - 日ごと: end までの28日。週ごと: end までの7日ずつ12区切り。月ごと: end の月までの12か月。
 * - 週・月の値は「1日あたりの平均」。平均に使うのは、記録がある、終わった日だけ(今日は途中なので入れない)。
 * - 室温・湿度は、30日以内は細かい値から日ごとに、それより前は1日ごとのまとめから読む。
 */
import type { FeatureSettings, SharedData } from "../../../core/server/feature-api";
import { DAY_MS, addDays, jstDate, jstDayStart } from "../../../core/shared/time";
import { CHART_UNITS, type ChartBucket, type ChartData, type ChartPoint, type ChartUnit } from "../shared/charts-api";
import { PIYOLOG_SOURCE, ROOM_SOURCE } from "../shared/records";
import { dailyRange, daysBetween, type DailyMetrics } from "./daily";

interface Range {
  from: string;
  to: string;
  label: string;
}

const md = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;

/** 区切りの一覧(古い順) */
export function chartRanges(unit: ChartUnit, end: string): Range[] {
  const count = CHART_UNITS.find((u) => u.unit === unit)!.count;
  const out: Range[] = [];
  if (unit === "day") {
    for (let i = count - 1; i >= 0; i--) {
      const d = addDays(end, -i);
      out.push({ from: d, to: d, label: md(d) });
    }
  } else if (unit === "week") {
    for (let i = count - 1; i >= 0; i--) {
      const to = addDays(end, -7 * i);
      const from = addDays(to, -6);
      out.push({ from, to, label: `${md(from)}〜` });
    }
  } else {
    const [y, m] = end.split("-").map(Number) as [number, number];
    for (let i = count - 1; i >= 0; i--) {
      const first = new Date(Date.UTC(y, m - 1 - i, 1));
      const last = new Date(Date.UTC(y, m - i, 0));
      const from = first.toISOString().slice(0, 10);
      const to = last.toISOString().slice(0, 10);
      out.push({ from, to: to > end ? end : to, label: `${first.getUTCMonth() + 1}月` });
    }
  }
  return out;
}

type RoomDay = Record<"temperature" | "humidity", { avg: number; min: number; max: number } | undefined>;

async function roomDays(data: SharedData, from: string, to: string): Promise<Record<string, RoomDay>> {
  const start = jstDayStart(from).toISOString();
  const end = new Date(jstDayStart(to).getTime() + DAY_MS).toISOString();
  const [raw, daily] = await Promise.all([
    data.aggregate(ROOM_SOURCE, { kinds: ["temperature", "humidity"], from: start, to: end, byJstDay: true }),
    data.query(ROOM_SOURCE, { kinds: ["temperature_daily", "humidity_daily"], from: start, to: end }),
  ]);
  const out: Record<string, RoomDay> = {};
  const put = (day: string, metric: "temperature" | "humidity", v: { avg: number; min: number; max: number }) => {
    out[day] ??= { temperature: undefined, humidity: undefined };
    out[day]![metric] = v;
  };
  for (const r of daily) {
    try {
      const p = JSON.parse(r.payload ?? "{}") as { avg?: number; min?: number; max?: number };
      if (typeof p.avg === "number" && typeof p.min === "number" && typeof p.max === "number") {
        put(jstDate(new Date(r.recordedAt)), r.kind.replace(/_daily$/, "") as "temperature" | "humidity", { avg: p.avg, min: p.min, max: p.max });
      }
    } catch {
      // 読めない記録は使わない
    }
  }
  for (const a of raw) {
    if (a.day && a.avg !== null && a.min !== null && a.max !== null) put(a.day, a.kind as "temperature" | "humidity", { avg: a.avg, min: a.min, max: a.max });
  }
  return out;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** 区切りの値(純粋な計算。テストで確認している) */
export function toBucket(range: Range, days: Record<string, DailyMetrics>, room: Record<string, RoomDay>, today: string): ChartBucket {
  const list = daysBetween(range.from, range.to);
  const partial = list.includes(today) && list.length === 1;
  // 日ごとの今日は途中の値をそのまま出す。週・月は、終わった日だけで平均する
  const usable = list.filter((d) => days[d]?.hasData && (partial || d < today));
  const avg = (pick: (m: DailyMetrics) => number) =>
    usable.length ? round1(usable.reduce((s, d) => s + pick(days[d]!), 0) / usable.length) : null;
  const intervalCount = usable.reduce((s, d) => s + days[d]!.intervalCount, 0);
  const intervalSum = usable.reduce((s, d) => s + days[d]!.intervalSum, 0);
  const roomOf = (metric: "temperature" | "humidity") => {
    const vals = list.map((d) => room[d]?.[metric]).filter((v): v is { avg: number; min: number; max: number } => !!v);
    if (!vals.length) return null;
    return {
      avg: round1(vals.reduce((s, v) => s + v.avg, 0) / vals.length),
      min: Math.min(...vals.map((v) => v.min)),
      max: Math.max(...vals.map((v) => v.max)),
    };
  };
  return {
    from: range.from,
    to: range.to,
    label: range.label,
    days: usable.length,
    partial,
    feedingMl: avg((m) => m.feedingMl),
    feedingCount: avg((m) => m.feedingCount),
    feedingIntervalMinutes: intervalCount ? Math.round(intervalSum / intervalCount) : null,
    sleepMinutes: avg((m) => m.sleepMinutes),
    poopCount: avg((m) => m.poopCount),
    peeCount: avg((m) => m.peeCount),
    temperature: roomOf("temperature"),
    humidity: roomOf("humidity"),
  };
}

export async function buildChartData(
  db: D1Database,
  data: SharedData,
  settings: FeatureSettings,
  unit: ChartUnit,
  end: string,
  now: Date,
): Promise<ChartData> {
  const today = jstDate(now);
  const ranges = chartRanges(unit, end);
  const from = ranges[0]!.from;
  const to = ranges.at(-1)!.to;
  const start = jstDayStart(from).toISOString();
  const stop = new Date(jstDayStart(to).getTime() + DAY_MS).toISOString();
  const [{ days, pending }, room, vitals, target] = await Promise.all([
    dailyRange(db, data, from, to, now),
    roomDays(data, from, to),
    data.query(PIYOLOG_SOURCE, { kinds: ["Weight", "Height", "Temperature"], from: start, to: stop }),
    settings.get("dailyFeedingTargetMl"),
  ]);
  const points = (kind: string): ChartPoint[] =>
    vitals.filter((r) => r.kind === kind && r.value !== null).map((r) => ({ at: r.recordedAt, value: r.value! }));
  return {
    unit,
    end,
    buckets: ranges.map((r) => toBucket(r, days, room, today)),
    weight: points("Weight"),
    height: points("Height"),
    temperature: points("Temperature"),
    dailyTargetMl: typeof target === "number" ? target : null,
    pending,
  };
}
