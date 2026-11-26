/**
 * 月ごとのテキストの取り込み。テキストは架空のもの(実際の書き出しと同じ書式で作った例)。
 */
import { describe, expect, it } from "vitest";
import { planSnapshot, type DataRecord, type DataRecordInput, type SharedData, type StoredRef } from "../src/core/server/data";
import { importMonthlyText, planImport } from "../src/features/piyolog/server/import";
import { countByLabel, parseMonthlyText, splitByDays, TextImportError } from "../src/features/piyolog/shared/text-import";

const SAMPLE = [
  "【ぴよログ】2026年10月",
  "",
  "----------",
  "2026/10/3(土)",
  "あかちゃん (1か月12日)",
  "",
  "00:10   ミルク 60ml   ",
  "01:00   寝る   ",
  "02:30   起きる (1時間30分)   よく寝た",
  "とても",
  "",
  "05:00   うんち (多め/ふつう/黄)   ",
  "05:05   おしっこ   ",
  "06:00   体温 36.8°C   ",
  "07:00   爪切り   ",
  "07:00   爪切り   ",
  "09:00   身長 49.5cm   ",
  "09:00   体重 3.05kg   ",
  "",
  "母乳合計　　   左 0分 / 右 0分",
  "ミルク合計　   1回 60ml",
  "睡眠合計　　   1時間30分",
  "おしっこ合計   1回",
  "うんち合計　   1回",
  "",
  "----------",
  "2026/10/4(日)",
  "あかちゃん (1か月13日)",
  "",
  "10:00   ミルク 80ml   ",
  "4:30くらいから泣いた",
  "",
  "ミルク合計　   1回 80ml",
  "",
].join("\n");

describe("月ごとのテキストの読み取り", () => {
  it("日付・時刻・種類・値・メモを読み、名前やまとめの行は使わない", () => {
    const parsed = parseMonthlyText(SAMPLE);
    expect([parsed.year, parsed.month]).toEqual([2026, 10]);
    expect(parsed.days).toEqual(["2026-10-03", "2026-10-04"]);
    expect(parsed.skipped).toEqual([]);
    expect(parsed.records.map((r) => r.kind)).toEqual([
      "Formula", "Sleep", "WakeUp", "Poop", "Pee", "Temperature", "Custom", "Custom", "Height", "Weight", "Formula",
    ]);
    const [milk, , wake, poop, , temp] = parsed.records;
    expect(milk).toMatchObject({ at: "2026-10-02T15:10:00.000Z", value: 60, unit: "ml", note: null, label: "ミルク" });
    expect(wake?.note).toBe("よく寝た\nとても");
    expect(poop?.details).toEqual({ amount: "large", hardness: "normal", color: "yellow" });
    expect(temp).toMatchObject({ value: 36.8, unit: "celsius" });
    expect(parsed.records[6]?.label).toBe("爪切り");
    expect(parsed.records.at(-1)).toMatchObject({ value: 80, note: "4:30くらいから泣いた" }); // 「時刻:分」で始まるメモの続き
    expect(JSON.stringify(parsed)).not.toContain("あかちゃん");
  });

  it("ぴよログの書き出しでなければ、エラーにする", () => {
    expect(() => parseMonthlyText("hello")).toThrow(TextImportError);
  });

  it("日ごとに分けても、同じ記録になる(先頭の行はそれぞれに付く)", () => {
    const chunks = splitByDays(SAMPLE, 1);
    expect(chunks).toHaveLength(2);
    const parts = chunks.map(parseMonthlyText);
    expect(parts.flatMap((p) => p.records)).toEqual(parseMonthlyText(SAMPLE).records);
  });

  it("種類ごとの件数", () => {
    expect(countByLabel(parseMonthlyText(SAMPLE).records).slice(0, 2)).toEqual([
      { label: "ミルク", count: 2 },
      { label: "爪切り", count: 2 },
    ]);
  });
});

function stored(id: string, kind: string, jst: string, extra: Partial<DataRecord> = {}): DataRecord {
  return {
    source: "piyolog",
    id,
    kind,
    recordedAt: new Date(`${jst}+09:00`).toISOString(),
    value: null,
    unit: null,
    note: null,
    payload: JSON.stringify({ event_id: id }),
    firstSeenAt: "",
    updatedAt: "",
    deletedAt: null,
    ...extra,
  };
}

describe("取り込みの計画", () => {
  it("フィードの記録と、同じ種類・同じ分のものは一致とみなし、フィードの記録をそのまま残す", () => {
    const records = parseMonthlyText(SAMPLE).records.filter((r) => r.at < "2026-10-03T15:00:00.000Z");
    const existing = [
      stored("f1", "Formula", "2026-10-03T00:10:00", { value: 60, unit: "ml" }),
      stored("f2", "Custom2", "2026-10-03T07:00:30"), // カスタム記録は、番号が違っても同じ「カスタム」として扱う
      stored("f3", "Medicine", "2026-10-03T08:00:00"), // テキストに無いフィードの記録も消さない
    ];
    const plan = planImport(records, existing);
    expect(plan.matched).toBe(2);
    const ids = plan.records.map((r) => r.id);
    expect(ids).toContain("f1");
    expect(ids).toContain("f2");
    expect(ids).toContain("f3");
    expect(ids).toContain("text:202610030700:Custom:0"); // 2つめの爪切り
    expect(ids).toContain("text:202610030505:Pee:0");
    expect(plan.records).toHaveLength(records.length + 1);
    // 一致したフィードの記録は、保存している内容のまま(書き直さない)
    expect(plan.records.find((r) => r.id === "f1")?.payload).toBe(JSON.stringify({ event_id: "f1" }));
  });
});

/** 記憶の中だけで動く共通データ(取り込みの流れの確認用) */
function memoryData(initial: DataRecord[] = []): SharedData & { rows: DataRecord[] } {
  const rows = [...initial];
  const fingerprint = (r: DataRecord) => JSON.stringify([r.kind, r.recordedAt, r.value, r.unit, r.note, r.payload]);
  const toRow = (r: DataRecordInput): DataRecord => ({
    source: "piyolog",
    id: r.id,
    kind: r.kind,
    recordedAt: new Date(r.recordedAt).toISOString(),
    value: r.value ?? null,
    unit: r.unit ?? null,
    note: r.note ?? null,
    payload: r.payload ?? null,
    firstSeenAt: "",
    updatedAt: "",
    deletedAt: null,
  });
  const data: SharedData & { rows: DataRecord[] } = {
    rows,
    async query(_source, q = {}) {
      return rows
        .filter((r) => (q.includeDeleted || !r.deletedAt) && (!q.from || r.recordedAt >= q.from) && (!q.to || r.recordedAt < q.to))
        .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
    },
    async latest() {
      return null;
    },
    async earliestAt() {
      return null;
    },
    async stats() {
      return { count: rows.filter((r) => !r.deletedAt).length, earliestAt: null, latestAt: null };
    },
    async applySnapshot(_source, snapshot) {
      const refs: StoredRef[] = rows.map((r) => ({ id: r.id, fingerprint: fingerprint(r), recorded_at: r.recordedAt, deleted_at: r.deletedAt }));
      const plan = planSnapshot(snapshot, refs);
      for (const u of plan.upserts) {
        const i = rows.findIndex((r) => r.id === u.id);
        const row = toRow(u);
        if (i === -1) rows.push(row);
        else rows[i] = row;
      }
      for (const id of plan.deletes) rows.find((r) => r.id === id)!.deletedAt = "deleted";
      return { received: snapshot.records.length, written: plan.upserts.length, deleted: plan.deletes.length };
    },
    async upsert() {
      return { written: 0 };
    },
  };
  return data;
}

describe("取り込みの流れ", () => {
  it("フィードの範囲(cutoff)以降は取り込まない。同じテキストを2回取り込んでも、2回目は何も書かない", async () => {
    const data = memoryData([stored("f1", "Formula", "2026-10-03T00:10:00", { value: 60, unit: "ml" })]);
    const cutoff = new Date("2026-10-04T09:00:00+09:00");
    const first = await importMonthlyText(data, SAMPLE, cutoff);
    expect(first).toMatchObject({ firstDay: "2026-10-03", lastDay: "2026-10-04", received: 10, matched: 1, written: 9, deleted: 0, ignored: 1 });
    const second = await importMonthlyText(data, SAMPLE, cutoff);
    expect(second).toMatchObject({ received: 10, matched: 1, written: 0, deleted: 0 });
    expect(data.rows.filter((r) => !r.deletedAt)).toHaveLength(10);
  });

  it("前回の取り込みにあって、今回のテキストに無い記録は、削除の印を付ける(フィードの記録は消さない)", async () => {
    const data = memoryData([stored("f9", "Medicine", "2026-10-03T08:00:00")]);
    const cutoff = new Date("2026-11-01T00:00:00+09:00");
    await importMonthlyText(data, SAMPLE, cutoff);
    const edited = SAMPLE.replace("05:05   おしっこ   \n", "");
    const result = await importMonthlyText(data, edited, cutoff);
    expect(result.deleted).toBe(1);
    expect(data.rows.find((r) => r.id === "text:202610030505:Pee:0")?.deletedAt).toBe("deleted");
    expect(data.rows.find((r) => r.id === "f9")?.deletedAt).toBeNull();
  });

  it("1回に送れる日数には上限がある", async () => {
    const many = ["【ぴよログ】2026年10月", ...Array.from({ length: 11 }, (_, i) => `2026/10/${i + 1}(火)`)].join("\n");
    await expect(importMonthlyText(memoryData(), many, new Date())).rejects.toThrow(TextImportError);
  });
});
