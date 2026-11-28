/** ストック管理を開く URL(合言葉は架空の値) */
import { describe, expect, it } from "vitest";
import { iconTargets, pwaTargets } from "../src/core/server/pwa";
import { features } from "../src/features/registry";
import { stockUrl } from "../src/features/stock/server/url";

const BASE = "https://ritz3618.github.io/stock/";

describe("ストック管理を開く URL", () => {
  it("利用者IDと合言葉を「#」の後ろに入れる(GitHub のサーバーには送られない)", () => {
    expect(stockUrl(BASE, "papa", "example word")).toBe(`${BASE}#user=papa&key=example+word`);
  });

  it("利用者IDか合言葉が無い・形が違うときは null(設定画面を開く)", () => {
    expect(stockUrl(BASE, "", "x")).toBeNull();
    expect(stockUrl(BASE, "papa", null)).toBeNull();
    expect(stockUrl(BASE, "Papa Name", "x")).toBeNull();
  });
});

describe("外部のアプリのアイコン", () => {
  it("外部のアプリは PWA(manifest)にはしないが、アイコンは持つ", () => {
    expect(pwaTargets(features).some((t) => t.id === "stock")).toBe(false);
    expect(iconTargets(features).some((t) => t.id === "stock")).toBe(true);
  });
});
