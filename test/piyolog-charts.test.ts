/** グラフのデータ(1日ごとの集計と、日・週・月の区切り) */
import { describe, expect, it } from "vitest";
import { chartRanges, toBucket } from "../src/features/piyolog/server/charts";
import { computeDays, type DailyMetrics } from "../src/features/piyolog/server/daily";
import type { StatRecord } from "../src/features/piyolog/server/stats";

const jst = (s: string) => Date.parse(`2026-${s.replace(" ", "T")}:00+09:00`);
const rec = (type: string, at: string, value: number | null = null): StatRecord => ({ type, at: jst(at), value, unit: value === null ? null : "ml" });

describe("1日ごとの集計", () => {
  it("量・回数・睡眠と、授乳の間隔(前の日の最後の授乳からも数える)", () => {
    const records = [
      rec("Formula", "11-24 22:00", 100),
      rec("Sleep", "11-24 23:00"),
      rec("WakeUp", "11-25 05:00"),
      rec("Formula", "11-25 01:00", 120),
      rec("Formula", "11-25 04:00", 140),
      rec("Poop", "11-25 06:00"),
    ];
    const days = computeDays(records, ["2026-11-25", "2026-11-26"], jst("11-27 12:00"));
    expect(days["2026-11-25"]).toMatchObject({
      hasData: true,
      feedingCount: 2,
      feedingMl: 260,
      sleepMinutes: 300,
      poopCount: 1,
      intervalSum: 180 + 180,
      intervalCount: 2,
    });
    expect(days["2026-11-26"]?.hasData).toBe(false);
  });
});

describe("グラフの区切り", () => {
  it("日ごとは28日、週ごとは7日ずつ12区切り、月ごとは12か月(最後の月は end まで)", () => {
    const day = chartRanges("day", "2026-11-27");
    expect([day.length, day[0]!.from, day.at(-1)!.to, day.at(-1)!.label]).toEqual([28, "2026-10-31", "2026-11-27", "11/27"]);
    const week = chartRanges("week", "2026-11-27");
    expect([week.length, week.at(-1)!.from, week.at(-1)!.to, week[0]!.from]).toEqual([12, "2026-11-21", "2026-11-27", "2026-09-05"]);
    const month = chartRanges("month", "2026-11-27");
    expect([month.length, month[0]!.from, month[0]!.label, month.at(-1)!.from, month.at(-1)!.to]).toEqual([
      12, "2025-12-01", "12月", "2026-11-01", "2026-11-27",
    ]);
  });

  it("週・月は、記録のある終わった日の1日平均(今日は入れない)。日ごとの今日は途中の値をそのまま", () => {
    const m = (feedingMl: number, hasData = true): DailyMetrics => ({
      feedingCount: 1, feedingMl, feedingMlCount: 1, sleepMinutes: 600, peeCount: 5, poopCount: 2,
      hasData, intervalSum: 180, intervalCount: 1,
    });
    const days = { "2026-11-25": m(800), "2026-11-26": m(900), "2026-11-27": m(300), "2026-11-24": m(0, false) };
    const room = { "2026-11-26": { temperature: { avg: 21, min: 19, max: 23 }, humidity: undefined } };
    const week = toBucket({ from: "2026-11-21", to: "2026-11-27", label: "" }, days, room, "2026-11-27");
    expect([week.days, week.feedingMl, week.partial, week.feedingIntervalMinutes]).toEqual([2, 850, false, 180]);
    expect(week.temperature).toEqual({ avg: 21, min: 19, max: 23 });
    const today = toBucket({ from: "2026-11-27", to: "2026-11-27", label: "" }, days, {}, "2026-11-27");
    expect([today.feedingMl, today.partial]).toEqual([300, true]);
    const empty = toBucket({ from: "2026-11-24", to: "2026-11-24", label: "" }, days, {}, "2026-11-27");
    expect([empty.days, empty.feedingMl]).toEqual([0, null]);
  });
});
