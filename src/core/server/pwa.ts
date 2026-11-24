/**
 * PWA(ホーム画面に追加)の共通処理。
 *
 * - スーパーアプリ本体と各機能のそれぞれに、manifest とアイコンを用意する。
 * - manifest の scope は全部 "/"。機能単体で追加したアイコンから開いても、ホームへ戻るボタンがアプリ内で動くようにするため。
 * - 開いたパスに応じて、HTML の先頭部分(manifest、apple-touch-icon、タイトル)を Worker が書き換える。
 *   iPhone は「ホーム画面に追加」したときの HTML からアイコンと名前を読むため。
 * - manifest とアイコンは /pwa/ の下に置く。将来、この下だけ Access を通さない設定にできるように。
 */
import { APP_INFO } from "../shared/app";
import type { FeatureMeta } from "../shared/feature";
import { featurePath } from "../shared/feature";
import { renderDefaultIcon } from "./png";

export interface PwaTarget {
  id: string;
  name: string;
  shortName: string;
  color: string;
  /** 開いたときの最初のパス */
  path: string;
  isApp: boolean;
}

export const ICON_SIZES = [180, 192, 512] as const;
export type IconSize = (typeof ICON_SIZES)[number];

export function pwaTargets(features: readonly FeatureMeta[]): PwaTarget[] {
  const app: PwaTarget = {
    id: APP_INFO.id,
    name: APP_INFO.name,
    shortName: APP_INFO.shortName,
    color: APP_INFO.color,
    path: "/",
    isApp: true,
  };
  const internal = features
    .filter((f) => f.kind === "internal")
    .map<PwaTarget>((f) => ({
      id: f.id,
      name: f.name,
      shortName: f.shortName ?? f.name,
      color: f.color,
      path: featurePath(f.id),
      isApp: false,
    }));
  return [app, ...internal];
}

/** パスから、どの PWA の画面かを決める("/piyolog/..." → piyolog、それ以外 → 本体)。 */
export function targetForPath(pathname: string, targets: readonly PwaTarget[]): PwaTarget {
  const first = pathname.split("/")[1] ?? "";
  const found = targets.find((t) => !t.isApp && t.id === first);
  return found ?? targets.find((t) => t.isApp)!;
}

export function iconUrl(targetId: string, size: IconSize): string {
  return `/pwa/${targetId}/icon-${size}.png`;
}

export function manifestUrl(targetId: string): string {
  return `/pwa/${targetId}/manifest.webmanifest`;
}

export function buildManifest(target: PwaTarget): Record<string, unknown> {
  return {
    id: target.path,
    name: target.name,
    short_name: target.shortName,
    lang: "ja",
    // launch は、どのアイコンから起動したかを画面側で知るため(端末チェックで表示する)。
    start_url: `${target.path}?launch=${target.id}`,
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: target.color,
    icons: [
      { src: iconUrl(target.id, 192), sizes: "192x192", type: "image/png", purpose: "any" },
      { src: iconUrl(target.id, 512), sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** index.html の <meta name="x-pwa-head"> と置き換える HTML。 */
export function headHtml(target: PwaTarget): string {
  const name = escapeHtml(target.name);
  const shortName = escapeHtml(target.shortName);
  return [
    `<title>${name}</title>`,
    // Access の後ろでも manifest を読めるように、Cookie を付けて取得させる。
    `<link rel="manifest" href="${manifestUrl(target.id)}" crossorigin="use-credentials">`,
    `<link rel="apple-touch-icon" href="${iconUrl(target.id, 180)}">`,
    `<link rel="icon" type="image/png" href="${iconUrl(target.id, 192)}">`,
    `<meta name="apple-mobile-web-app-title" content="${shortName}">`,
    `<meta name="theme-color" content="${escapeHtml(target.color)}">`,
    `<meta name="x-pwa-target" content="${escapeHtml(target.id)}">`,
  ].join("\n    ");
}

/** HTML の先頭部分を、その画面用に書き換える。 */
export function injectHead(response: Response, target: PwaTarget): Response {
  const rewritten = new HTMLRewriter()
    .on('meta[name="x-pwa-head"]', {
      element(el) {
        el.replace(headHtml(target), { html: true });
      },
    })
    .transform(response);
  const headers = new Headers(rewritten.headers);
  headers.set("Cache-Control", "no-cache");
  return new Response(rewritten.body, { status: rewritten.status, headers });
}

/** アイコンを返す。保存済みならそれを、無ければ既定アイコンを生成して保存する。 */
export async function loadIcon(db: D1Database, target: PwaTarget, size: IconSize): Promise<Uint8Array> {
  const row = await db
    .prepare("SELECT png FROM core_icons WHERE target_id = ? AND size = ?")
    .bind(target.id, size)
    .first<{ png: ArrayBuffer | number[] }>();
  if (row) return row.png instanceof ArrayBuffer ? new Uint8Array(row.png) : Uint8Array.from(row.png);

  const png = await renderDefaultIcon(size, target.color, target.isApp ? "grid" : "circle");
  await db
    .prepare(
      "INSERT OR IGNORE INTO core_icons (target_id, size, png, source, updated_at) VALUES (?, ?, ?, 'default', ?)",
    )
    .bind(target.id, size, png, new Date().toISOString())
    .run();
  return png;
}
