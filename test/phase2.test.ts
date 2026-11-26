import { describe, expect, it } from "vitest";
import { decideNotification } from "../src/core/server/notify";
import { parsePngSize, renderDefaultIcon } from "../src/core/server/png";
import { buildSettingsRegistry } from "../src/core/server/settings";
import { jstMinuteOfDay } from "../src/core/server/time";
import { applyHomeOrder, isValidHomeOrder } from "../src/core/shared/home-order";
import {
  CORE_SETTINGS,
  FEATURE_NOTIFY_KEY,
  isWithinTimeRanges,
  validateSettingDefs,
  validateSettingValue,
  type SettingDef,
} from "../src/core/shared/settings";
import { clampCrop, cropRect, initialCrop, panCrop, setZoom, zoomOf } from "../src/core/web/settings/crop";
import { features } from "../src/features/registry";

const minutes: SettingDef = { key: "interval", label: "間隔", scope: "shared", type: "minutes", default: 180, min: 30, max: 720 };
const ranges: SettingDef = { key: "quiet", label: "時間帯", scope: "shared", type: "timeRanges", default: [] };
const secret: SettingDef = { key: "url", label: "URL", scope: "shared", type: "secret" };
const date: SettingDef = { key: "since", label: "作成日", scope: "shared", type: "date", default: null };

describe("設定の値の検査", () => {
  it("分は、範囲内の整数だけ受け付ける", () => {
    expect(validateSettingValue(minutes, 240)).toEqual({ ok: true, value: 240 });
    expect(validateSettingValue(minutes, 10).ok).toBe(false);
    expect(validateSettingValue(minutes, 1000).ok).toBe(false);
    expect(validateSettingValue(minutes, 90.5).ok).toBe(false);
    expect(validateSettingValue(minutes, "240").ok).toBe(false);
  });

  it("時間帯は HH:MM の組で、開始と終了が同じものは受け付けない", () => {
    expect(validateSettingValue(ranges, [{ start: "22:00", end: "06:00" }])).toEqual({
      ok: true,
      value: [{ start: "22:00", end: "06:00" }],
    });
    expect(validateSettingValue(ranges, [{ start: "24:00", end: "06:00" }]).ok).toBe(false);
    expect(validateSettingValue(ranges, [{ start: "07:00", end: "07:00" }]).ok).toBe(false);
    expect(validateSettingValue(ranges, Array.from({ length: 11 }, () => ({ start: "01:00", end: "02:00" }))).ok).toBe(false);
  });

  it("秘密の値は、空にできず、null で削除になる", () => {
    expect(validateSettingValue(secret, "  https://example.invalid/x  ")).toEqual({ ok: true, value: "https://example.invalid/x" });
    expect(validateSettingValue(secret, "   ").ok).toBe(false);
    expect(validateSettingValue(secret, null)).toEqual({ ok: true, value: null });
  });

  it("日付は YYYY-MM-DD か null", () => {
    expect(validateSettingValue(date, "2026-11-25").ok).toBe(true);
    expect(validateSettingValue(date, null).ok).toBe(true);
    expect(validateSettingValue(date, "2026/11/25").ok).toBe(false);
  });

  it("宣言の誤り(キーの重複、既定値の誤り)を検出する", () => {
    expect(validateSettingDefs(CORE_SETTINGS)).toEqual([]);
    const bad: SettingDef[] = [minutes, { ...minutes, default: 5 }];
    const errors = validateSettingDefs(bad);
    expect(errors.some((e) => e.includes("重複"))).toBe(true);
    expect(errors.some((e) => e.includes("既定値"))).toBe(true);
  });
});

describe("通知を避ける時間帯", () => {
  const at = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h! * 60 + m!;
  };

  it("日付をまたぐ時間帯(22:00〜06:00)", () => {
    const r = [{ start: "22:00", end: "06:00" }];
    expect(isWithinTimeRanges(at("21:59"), r)).toBe(false);
    expect(isWithinTimeRanges(at("22:00"), r)).toBe(true);
    expect(isWithinTimeRanges(at("00:30"), r)).toBe(true);
    expect(isWithinTimeRanges(at("05:59"), r)).toBe(true);
    expect(isWithinTimeRanges(at("06:00"), r)).toBe(false);
  });

  it("日中の時間帯と、複数の時間帯", () => {
    const r = [
      { start: "13:00", end: "14:30" },
      { start: "23:30", end: "05:00" },
    ];
    expect(isWithinTimeRanges(at("13:00"), r)).toBe(true);
    expect(isWithinTimeRanges(at("14:30"), r)).toBe(false);
    expect(isWithinTimeRanges(at("03:00"), r)).toBe(true);
    expect(isWithinTimeRanges(at("10:00"), r)).toBe(false);
    expect(isWithinTimeRanges(at("10:00"), [])).toBe(false);
  });

  it("日本時間の分に直す(UTC 14:30 は日本時間 23:30)", () => {
    expect(jstMinuteOfDay(new Date("2026-11-25T14:30:00Z"))).toBe(23 * 60 + 30);
    expect(jstMinuteOfDay(new Date("2026-11-25T15:05:00Z"))).toBe(5);
  });
});

describe("通知の判定(1人分)", () => {
  const base = { enabled: true, quiet: false, alreadySent: false, deviceCount: 1 };
  it("条件がそろえば送る", () => expect(decideNotification(base)).toBe("send"));
  it("本人がオフなら送らない", () => expect(decideNotification({ ...base, enabled: false })).toBe("disabled"));
  it("送信済みの通知は、時間帯にかかわらず送らない", () =>
    expect(decideNotification({ ...base, alreadySent: true, quiet: true })).toBe("duplicate"));
  it("時間帯の間は保留する(次の判定で送られる)", () => expect(decideNotification({ ...base, quiet: true })).toBe("deferred_quiet"));
  it("端末が無ければ送らない", () => expect(decideNotification({ ...base, deviceCount: 0 })).toBe("no_device"));
});

describe("設定の一覧", () => {
  it("共通の設定が最初で、通知を送る機能には「通知を受け取る」が自動で付く", () => {
    const registry = buildSettingsRegistry(features);
    expect(registry[0]!.namespace).toBe("core");
    const piyolog = registry.find((n) => n.namespace === "piyolog");
    expect(piyolog?.defs[0]?.key).toBe(FEATURE_NOTIFY_KEY);
    expect(registry.some((n) => n.namespace.startsWith("dummy"))).toBe(false);
  });
});

describe("ホームの並び順", () => {
  const ids = ["a", "b", "c", "d"];
  it("保存が無ければ既定の順", () => expect(applyHomeOrder(ids, null)).toEqual(ids));
  it("保存された順に並べ、増えた機能は最後、消えた機能は無視", () => {
    expect(applyHomeOrder(ids, ["c", "x", "a"])).toEqual(["c", "a", "b", "d"]);
  });
  it("保存する並び順の検査", () => {
    expect(isValidHomeOrder(ids, ["d", "c", "b", "a"])).toBe(true);
    expect(isValidHomeOrder(ids, ["a", "a"])).toBe(false);
    expect(isValidHomeOrder(ids, ["z"])).toBe(false);
    expect(isValidHomeOrder(ids, "a,b")).toBe(false);
  });
});

describe("アイコンの切り抜き", () => {
  const W = 400;
  const H = 300;
  it("最初は中央の、短い辺いっぱいの正方形", () => {
    expect(cropRect(initialCrop(W, H))).toEqual({ sx: 50, sy: 0, size: 300 });
  });
  it("拡大すると範囲が小さくなり、画像からはみ出さない", () => {
    const zoomed = setZoom(initialCrop(W, H), 2, W, H);
    expect(zoomed.side).toBe(150);
    expect(zoomOf(zoomed, W, H)).toBe(2);
    const far = clampCrop({ cx: 0, cy: 0, side: 150 }, W, H);
    expect(cropRect(far)).toEqual({ sx: 0, sy: 0, size: 150 });
    expect(setZoom(initialCrop(W, H), 100, W, H).side).toBeCloseTo(300 / 8);
  });
  it("指を右に動かすと、画像が右に動く(切り抜き範囲は左へ)", () => {
    const start = setZoom(initialCrop(W, H), 2, W, H); // cx=200, side=150
    const moved = panCrop(start, 26, 0, 260, W, H); // 26px * (150/260) = 15
    expect(moved.cx).toBeCloseTo(185);
  });
});

describe("アップロードされた PNG の検査", () => {
  it("幅と高さを読み、PNG でなければ null", async () => {
    const png = await renderDefaultIcon(180, "#123456", "circle");
    expect(parsePngSize(png)).toEqual({ width: 180, height: 180 });
    expect(parsePngSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe("設定の種類: 数値と選択肢", () => {
  const num: SettingDef = { key: "target", label: "目安", scope: "shared", type: "number", default: null, unit: "ml", min: 50, max: 3000 };
  const sel: SettingDef = {
    key: "mode",
    label: "対象",
    scope: "shared",
    type: "select",
    default: "off",
    options: [
      { value: "off", label: "なし" },
      { value: "both", label: "両方" },
    ],
  };

  it("数値は範囲の中だけ。既定が null の項目は、未設定(null)に戻せる", async () => {
    const { validateSettingValue } = await import("../src/core/shared/settings");
    expect(validateSettingValue(num, 800)).toEqual({ ok: true, value: 800 });
    expect(validateSettingValue(num, null)).toEqual({ ok: true, value: null });
    expect(validateSettingValue(num, 10).ok).toBe(false);
    expect(validateSettingValue(num, "800").ok).toBe(false);
    expect(validateSettingValue({ ...num, default: 20 } as SettingDef, null).ok).toBe(false);
  });

  it("選択肢は、宣言したものだけ", async () => {
    const { validateSettingValue } = await import("../src/core/shared/settings");
    expect(validateSettingValue(sel, "both")).toEqual({ ok: true, value: "both" });
    expect(validateSettingValue(sel, "other").ok).toBe(false);
  });
});
