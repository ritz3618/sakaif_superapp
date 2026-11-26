import { describe, expect, it } from "vitest";
import { diaperAlert, expiryAlert, feedExpiry, feedingAlert } from "../src/features/piyolog/server/alerts";
import { recordsToCsv } from "../src/features/piyolog/server/csv";
import { FeedError, fetchFeed, parseFeed, type Feed } from "../src/features/piyolog/server/feed";
import { computeStats, sleepIntervals, type StatRecord } from "../src/features/piyolog/server/stats";
import { feedToSnapshot } from "../src/features/piyolog/server/service";
import type { DataRecord } from "../src/core/server/data";
import { formatMinutes } from "../src/features/piyolog/shared/format";
import { compare } from "../src/features/piyolog/web/compare";

// 公式のデータ仕様のレスポンス例(架空の記録)をもとにした例
const SAMPLE = {
  schema_version: 1,
  generated_at: "2026-09-09T03:00:00.000Z",
  range: { from: "2026-09-08T03:00:00.000Z", to: "2026-09-09T03:00:00.000Z" },
  records: [
    { event_id: "example-001", datetime: "2026-09-08T07:00:00.000Z", type: "Formula", value: { value: 120, unit: "ml" }, memo: "Finished the bottle." },
    { event_id: "example-003", datetime: "2026-09-09T01:00:00.000Z", type: "Poop", details: { amount: "normal", color: "yellow" } },
    { event_id: "example-004", datetime: "2026-09-09T02:00:00.000Z", type: "Memo", memo: "Packed a spare outfit." },
  ],
};
const SECRET_URL = "https://feed.piyolog.com/v1/feed/24h/feedid123/secretpart456";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("フィードの検査", () => {
  it("公式の例を読み、日時を UTC の ISO にそろえる", () => {
    const feed = parseFeed(SAMPLE);
    expect(feed.records).toHaveLength(3);
    expect(feed.from).toBe("2026-09-08T03:00:00.000Z");
    expect(feed.skipped).toBe(0);
  });

  it("未対応の版や、形式の崩れたものは受け付けない(エラーを0件として扱わない)", () => {
    expect(() => parseFeed({ ...SAMPLE, schema_version: 2 })).toThrow(FeedError);
    expect(() => parseFeed({ ...SAMPLE, records: undefined })).toThrow(FeedError);
    expect(() => parseFeed({ ...SAMPLE, range: {} })).toThrow(FeedError);
  });

  it("おかしな記録は読み飛ばして数える", () => {
    const feed = parseFeed({ ...SAMPLE, records: [...SAMPLE.records, { event_id: "x", type: "Pee" }] });
    expect(feed.records).toHaveLength(3);
    expect(feed.skipped).toBe(1);
  });
});

describe("フィードの取得", () => {
  const errorOf = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (e) {
      return e as FeedError;
    }
    throw new Error("エラーになりませんでした");
  };

  it("URLの形式が違えば、取得しない", async () => {
    const e = await errorOf(fetchFeed("https://example.com/feed", async () => jsonResponse(200, SAMPLE)));
    expect(e.kind).toBe("config");
  });

  it("状態コードごとに分類し、エラーの文にURLを含めない", async () => {
    const cases: [number, string][] = [
      [404, "unavailable"],
      [429, "rate_limited"],
      [500, "server"],
    ];
    for (const [status, kind] of cases) {
      const e = await errorOf(fetchFeed(SECRET_URL, async () => jsonResponse(status, { error: { code: "feed_unavailable" } })));
      expect(e.kind).toBe(kind);
      expect(e.message).not.toContain("secretpart456");
      expect(e.message).not.toContain("feedid123");
    }
    const network = await errorOf(fetchFeed(SECRET_URL, async () => { throw new TypeError(`fetch failed: ${SECRET_URL}`); }));
    expect(network.kind).toBe("network");
    expect(network.message).not.toContain("secretpart456");
  });

  it("200 なら記録を返す", async () => {
    const feed = await fetchFeed(SECRET_URL, async () => jsonResponse(200, SAMPLE));
    expect(feed.records.map((r) => r.event_id)).toEqual(["example-001", "example-003", "example-004"]);
  });
});

describe("共通データへの変換", () => {
  it("フィードの記録を、共通データの形(id=event_id、kind=type、note=メモ、payload=記録そのもの)にする", () => {
    const snapshot = feedToSnapshot(parseFeed(SAMPLE));
    expect(snapshot.from).toBe("2026-09-08T03:00:00.000Z");
    const formula = snapshot.records.find((r) => r.id === "example-001")!;
    expect([formula.kind, formula.value, formula.unit, formula.note]).toEqual(["Formula", 120, "ml", "Finished the bottle."]);
    expect(JSON.parse(formula.payload!).event_id).toBe("example-001");
    expect(snapshot.records.find((r) => r.id === "example-004")?.value).toBeNull();
  });
});

// 日本時間の日時(例: "11-25 23:00")を UTC のミリ秒にする
const jst = (mmdd_hhmm: string) => Date.parse(`2026-${mmdd_hhmm.replace(" ", "T")}:00+09:00`);
const rec = (type: string, at: string, value: number | null = null): StatRecord => ({
  type,
  at: jst(at),
  value,
  unit: value === null ? null : "ml",
});

describe("集計", () => {
  it("睡眠は「寝る」〜「起きる」の時間帯で、最後が「寝る」なら今まで寝ている", () => {
    const now = jst("11-26 10:00");
    const intervals = sleepIntervals([rec("Sleep", "11-26 08:00"), rec("WakeUp", "11-26 09:00"), rec("Sleep", "11-26 09:30")], now);
    expect(intervals.map((i) => (i.end - i.start) / 60000)).toEqual([60, 30]);
  });

  it("日付をまたぐ睡眠は、日ごとに分ける(23時〜翌6時 → 今日は6時間)", () => {
    const now = jst("11-26 12:00");
    const records = [rec("Sleep", "11-25 23:00"), rec("WakeUp", "11-26 06:00"), rec("Formula", "11-26 07:00", 120), rec("Formula", "11-26 10:30", 140), rec("Pee", "11-26 08:00"), rec("Poop", "11-26 09:00")];
    const stats = computeStats(records, now, jst("11-26 00:00"));
    expect(stats.today).toEqual({ feedingCount: 2, feedingMl: 260, sleepMinutes: 360, peeCount: 1, poopCount: 1 });
    expect(stats.comparison).toBeNull(); // 前日より前のデータが無いので比較しない
  });

  it("過去との比較は、データがある日の「同じ時刻まで」の平均", () => {
    const now = jst("11-26 12:00");
    const records = [
      rec("Formula", "11-24 08:00", 100),
      rec("Formula", "11-24 13:00", 999), // 12時より後なので比較に入らない
      rec("Formula", "11-25 08:00", 140),
      rec("Formula", "11-25 11:00", 120),
      rec("Formula", "11-26 09:00", 150),
    ];
    const stats = computeStats(records, now, jst("11-24 00:00"));
    expect(stats.comparison?.days).toBe(2);
    expect(stats.comparison?.average.feedingCount).toBe(1.5);
    expect(stats.comparison?.average.feedingMl).toBe(180);
  });
});

describe("通知", () => {
  const last = { eventId: "e1", type: "Formula", at: jst("11-26 10:05"), value: 120, unit: "ml" };

  it("授乳は、間隔に達するまでは通知しない", () => {
    expect(feedingAlert(last, 240, jst("11-26 14:04"))).toBeNull();
  });

  it("授乳の通知の文面と、重複防止のキー(最後の記録のID)", () => {
    expect(feedingAlert(last, 240, jst("11-26 14:05"))).toEqual({
      type: "feeding_due",
      dedupeKey: "feeding:e1",
      title: "授乳から4時間たちました",
      body: "前回は120ml(10:05に飲み始め)",
    });
  });

  it("おむつ替えの通知の文面", () => {
    const pee = { eventId: "p1", type: "Pee", at: jst("11-26 09:00"), value: null, unit: null };
    expect(diaperAlert(pee, 240, jst("11-26 13:10"))?.title).toBe("おむつ替えから4時間10分たちました");
    expect(diaperAlert(pee, 240, jst("11-26 13:10"))?.body).toBe("最後の記録はおしっこ(09:00)");
  });

  it("フィードの期限は作成日から89日。7日前から1回だけ知らせる", () => {
    expect(feedExpiry("2026-11-26", jst("11-26 12:00"))).toEqual({ expiresOn: "2027-02-23", daysLeft: 89 });
    expect(expiryAlert("2026-11-26", jst("11-26 12:00"))).toBeNull();
    const alert = expiryAlert("2026-09-01", jst("11-26 12:00")); // 期限 11/29、あと3日
    expect(alert?.dedupeKey).toBe("feed-expiring:2026-09-01");
    expect(alert?.body).toContain("11/29(あと3日)");
  });
});

describe("表示", () => {
  it("経過時間の書き方", () => {
    expect([formatMinutes(45), formatMinutes(240), formatMinutes(250)]).toEqual(["45分", "4時間", "4時間10分"]);
  });

  it("過去との比較の書き方(差が小さければ「ほぼ同じ」)", () => {
    expect(compare(520, 460, "ml")).toEqual({ direction: "more", diffText: "+60ml" });
    expect(compare(5, 6, "count")).toEqual({ direction: "less", diffText: "-1回" });
    expect(compare(480, 475, "minutes").direction).toBe("same");
    expect(compare(450, 480, "minutes")).toEqual({ direction: "less", diffText: "-30分" });
  });

  it("CSV は BOM 付き、日本時間、カンマや引用符を含むメモも正しく書く", () => {
    const base = { source: "piyolog", payload: null, firstSeenAt: "", updatedAt: "" };
    const rows: DataRecord[] = [
      { ...base, id: "e1", kind: "Formula", recordedAt: "2026-11-26T01:05:00.000Z", value: 120, unit: "ml", note: 'よく飲んだ, "完飲"', deletedAt: null },
      { ...base, id: "e2", kind: "Custom3", recordedAt: "2026-11-26T02:00:00.000Z", value: null, unit: null, note: null, deletedAt: "2026-11-26T03:00:00.000Z" },
    ];
    const csv = recordsToCsv(rows);
    expect(csv.startsWith("﻿日時(日本時間),種類")).toBe(true);
    expect(csv).toContain('2026-11-26 10:05:00,ミルク,Formula,120,ml,"よく飲んだ, ""完飲""",e1,');
    expect(csv).toContain("2026-11-26 11:00:00,カスタム3,Custom3,,,,e2,削除済み");
  });
});
