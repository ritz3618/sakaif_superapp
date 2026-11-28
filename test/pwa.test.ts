import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { authenticate } from "../src/core/server/auth";
import type { Env } from "../src/core/server/env";
import { renderDefaultIcon } from "../src/core/server/png";
import { buildManifest, headHtml, pngDataUri, pwaTargets, targetForPath } from "../src/core/server/pwa";
import { jstDate, jstStartOfDay, jstTime } from "../src/core/server/time";
import { features } from "../src/features/registry";

const targets = pwaTargets(features);

describe("PWA(ホーム画面に追加)", () => {
  it("本体と、内部機能のそれぞれに manifest がある(外部のアプリは PWA にしない)", () => {
    expect(targets.map((t) => t.id)).toEqual(["app", "piyolog", ...Array.from({ length: 7 }, (_, i) => `dummy${i + 1}`)]);
  });

  it("機能の manifest は、start_url がその機能、scope は全体(/)", () => {
    const manifest = buildManifest(targets.find((t) => t.id === "piyolog")!, "data:image/png;base64,AAAA");
    expect(manifest).toMatchObject({
      id: "/piyolog/",
      name: "育児ログ",
      start_url: "/piyolog/?launch=piyolog",
      scope: "/",
      display: "standalone",
      icons: [{ src: "data:image/png;base64,AAAA", sizes: "192x192", type: "image/png", purpose: "any" }],
    });
  });

  it("パスから、どの画面の HTML かを決める", () => {
    expect(targetForPath("/", targets).id).toBe("app");
    expect(targetForPath("/settings/", targets).id).toBe("app");
    expect(targetForPath("/piyolog/", targets).id).toBe("piyolog");
    expect(targetForPath("/piyolog/graph/", targets).id).toBe("piyolog");
    expect(targetForPath("/unknown/", targets).id).toBe("app");
  });

  it("HTML の先頭に入れるタグは、Cookie 付きの manifest と、埋め込みの apple-touch-icon を含み、名前をエスケープする", () => {
    const icon = pngDataUri(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    expect(icon).toBe("data:image/png;base64,iVBORw==");
    const html = headHtml({ id: "x1", name: '<a&"b>', shortName: "s", color: "#000000", path: "/x1/", isApp: false }, icon);
    expect(html).toContain('<link rel="manifest" href="/pwa/x1/manifest.webmanifest" crossorigin="use-credentials">');
    expect(html).toContain('<link rel="apple-touch-icon" href="data:image/png;base64,iVBORw==">');
    expect(html).toContain("<title>&lt;a&amp;&quot;b&gt;</title>");
  });

  it("既定アイコンの円の縁は、背景色と白の中間の色になる", async () => {
    const size = 192;
    const png = await renderDefaultIcon(size, "#000000", "circle");
    const view = new DataView(png.buffer, png.byteOffset);
    const raw = inflateSync(png.slice(41, 41 + view.getUint32(33)));
    const stride = size * 4 + 1;
    const row = 96;
    const values = Array.from({ length: size }, (_, x) => raw[row * stride + 1 + x * 4]!);
    // 左端は背景(黒)、中央は白、その間に中間の値がある(なめらかな縁)
    expect(values[0]).toBe(0);
    expect(values[96]).toBe(255);
    expect(values.some((v) => v > 0 && v < 255)).toBe(true);
    // 左右対称
    for (let x = 0; x < size; x++) expect(values[x]).toBe(values[size - 1 - x]);
  });

  it("既定アイコンは、正しい PNG(背景色と白い図形)になる", async () => {
    const png = await renderDefaultIcon(180, "#E8A317", "circle");
    expect([...png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(png.buffer, png.byteOffset);
    expect(view.getUint32(16)).toBe(180);
    expect(view.getUint32(20)).toBe(180);
    const idatLength = view.getUint32(33);
    const raw = inflateSync(png.slice(41, 41 + idatLength));
    expect(raw.length).toBe((180 * 4 + 1) * 180);
    const pixel = (x: number, y: number) => [...raw.subarray(y * 721 + 1 + x * 4, y * 721 + 1 + x * 4 + 4)];
    expect(pixel(0, 0)).toEqual([0xe8, 0xa3, 0x17, 255]);
    expect(pixel(90, 90)).toEqual([255, 255, 255, 255]);
  });
});

describe("ログイン", () => {
  const env = { AUTH_MODE: "dev", DEV_USER_EMAIL: "Dev@Example.com" } as Env;

  it("dev モードは localhost からだけ使える", async () => {
    expect(await authenticate(new Request("http://localhost:5173/"), env)).toEqual({ ok: true, email: "dev@example.com" });
    const remote = await authenticate(new Request("https://sabu6.example.workers.dev/"), env);
    expect(remote.ok).toBe(false);
  });

  it("Access モードで設定が無ければ、ログインさせない", async () => {
    const result = await authenticate(new Request("https://sabu6.example.workers.dev/"), { AUTH_MODE: "access" } as Env);
    expect(result).toMatchObject({ ok: false, status: 503 });
  });

  it("Access モードでトークンが無ければ、ログインさせない", async () => {
    const result = await authenticate(new Request("https://sabu6.example.workers.dev/"), {
      AUTH_MODE: "access",
      ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com",
      ACCESS_AUD: "aud",
    } as Env);
    expect(result).toMatchObject({ ok: false, status: 401 });
  });
});

describe("日本時間", () => {
  it("UTC 15:00 は、日本時間の翌日 0:00", () => {
    const at = new Date("2026-11-24T15:00:00Z");
    expect(jstDate(at)).toBe("2026-11-25");
    expect(jstTime(at)).toBe("00:00");
    expect(jstStartOfDay(at).toISOString()).toBe("2026-11-24T15:00:00.000Z");
  });

  it("UTC 14:59 は、日本時間の当日 23:59", () => {
    const at = new Date("2026-11-24T14:59:00Z");
    expect(jstDate(at)).toBe("2026-11-24");
    expect(jstStartOfDay(at).toISOString()).toBe("2026-11-23T15:00:00.000Z");
  });
});
