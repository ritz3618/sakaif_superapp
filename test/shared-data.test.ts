import { describe, expect, it } from "vitest";
import { planSnapshot, sharedData, type DataRecordInput, type StoredRef } from "../src/core/server/data";
import { validateFeatures, type FeatureMeta } from "../src/core/shared/feature";

const rec = (id: string, at: string, value: number | null = null): DataRecordInput => ({
  id,
  kind: "Formula",
  recordedAt: at,
  value,
  unit: value === null ? null : "ml",
  payload: JSON.stringify({ id, at, value }),
});
const snapshot = {
  from: "2026-09-08T03:00:00.000Z",
  to: "2026-09-09T03:00:00.000Z",
  records: [rec("a", "2026-09-08T07:00:00.000Z", 120), rec("b", "2026-09-09T01:00:00.000Z", 100)],
};

function stored(input: DataRecordInput, deleted: string | null = null): StoredRef {
  const [n] = planSnapshot({ from: "1970-01-01T00:00:00Z", to: "1970-01-01T00:00:00Z", records: [input] }, []).upserts;
  return { id: input.id, fingerprint: n!.fingerprint, recorded_at: n!.recordedAt, deleted_at: deleted };
}

describe("共通データ: スナップショットの反映の計画", () => {
  it("新しい記録と、内容が変わった記録だけを書く", () => {
    const plan = planSnapshot(snapshot, [stored(rec("a", "2026-09-08T07:00:00.000Z", 120)), stored(rec("b", "2026-09-09T01:00:00.000Z", 90))]);
    expect(plan.upserts.map((r) => r.id)).toEqual(["b"]);
    expect(plan.deletes).toEqual([]);
  });

  it("期間の中で無くなった記録は論理削除、期間の外の記録や削除済みはそのまま", () => {
    const plan = planSnapshot(snapshot, [
      stored(rec("gone", "2026-09-08T10:00:00.000Z")),
      stored(rec("old", "2026-09-07T10:00:00.000Z")),
      stored(rec("deleted", "2026-09-08T11:00:00.000Z"), "2026-09-08T12:00:00.000Z"),
    ]);
    expect(plan.deletes).toEqual(["gone"]);
  });

  it("削除の印が付いた記録が再び現れたら、書き直して印を外す", () => {
    const plan = planSnapshot(snapshot, [stored(rec("a", "2026-09-08T07:00:00.000Z", 120), "2026-09-08T09:00:00.000Z")]);
    expect(plan.upserts.map((r) => r.id)).toContain("a");
  });
});

describe("共通データ: 書き込みの権限", () => {
  const db = {} as D1Database; // 権限の確認は D1 に触る前に行うので、中身は使わない

  it("宣言していない出どころには書き込めない", async () => {
    const data = sharedData(db, ["mine"]);
    await expect(data.applySnapshot("others", snapshot)).rejects.toThrow("宣言した機能だけ");
    await expect(data.upsert("others", snapshot.records)).rejects.toThrow("宣言した機能だけ");
  });

  it("同じ出どころを2つの機能が宣言すると、宣言の誤りになる", () => {
    const f = (id: string): FeatureMeta => ({ id, name: id, kind: "internal", color: "#000000", order: 1, dataSources: [{ id: "weather", label: "天気" }] });
    expect(validateFeatures([f("aa"), f("bb")]).some((e) => e.includes("両方が宣言"))).toBe(true);
  });
});
