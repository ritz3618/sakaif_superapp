/**
 * Worker の本体(ルーティング)。どの機能が載っているかは引数で受け取り、個別の機能のことは知らない。
 *
 * - /pwa/<対象>/...     manifest とアイコン(ログイン確認なし。秘密情報は含まない)
 * - /api/core/...       共通部分のAPI
 * - /api/f/<機能ID>/... 各機能のAPI
 * - それ以外             画面(index.html の先頭部分を、開いた画面用に書き換えて返す)
 */
import { Hono, type Context } from "hono";
import { APP_INFO } from "../shared/app";
import type {
  HomeCard,
  HomeResponse,
  MeResponse,
  PushSubscriptionInfo,
  PushTestResult,
  StatusResponse,
} from "../shared/api-types";
import type { FeatureMeta } from "../shared/feature";
import { featurePath } from "../shared/feature";
import { canRegisterPush } from "../shared/push-policy";
import { authenticate, getOrCreateUser } from "./auth";
import { ensureMigrated, type Migration } from "./db/migrate";
import { base64UrlToBytes } from "./encoding";
import type { AppBindings } from "./env";
import type { FeatureServer } from "./feature-api";
import { kvGet } from "./kv";
import { notify } from "./notify";
import { getVapidKeys, rememberAppOrigin, serviceName } from "./push/sender";
import {
  buildManifest,
  ICON_SIZES,
  iconUrl,
  injectHead,
  loadIcon,
  pngDataUri,
  pwaTargets,
  targetForPath,
  type IconSize,
} from "./pwa";
import { LAST_CRON_KEY } from "./scheduler";

export interface RegisteredFeatureServer {
  meta: FeatureMeta;
  server: FeatureServer;
}

export interface AppDependencies {
  features: readonly FeatureMeta[];
  servers: readonly RegisteredFeatureServer[];
  migrations: readonly Migration[];
}

type AppContext = Context<AppBindings>;

function errorPage(status: number, message: string): Response {
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>エラー</title></head>
<body style="font-family:system-ui,sans-serif;padding:24px;line-height:1.6">
<h1 style="font-size:20px">表示できません(${status})</h1><p>${message.replace(/</g, "&lt;")}</p></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export function createApp(deps: AppDependencies): Hono<AppBindings> {
  const targets = pwaTargets(deps.features);
  const app = new Hono<AppBindings>();

  app.onError((error, c) => {
    console.error(error);
    if (new URL(c.req.url).pathname.startsWith("/api/")) {
      return c.json({ error: "サーバーでエラーが発生しました" }, 500);
    }
    return errorPage(500, "サーバーでエラーが発生しました。");
  });

  app.use("*", async (c, next) => {
    await ensureMigrated(c.env.DB, deps.migrations);
    await next();
  });

  // ---- PWA(ログイン確認なし) ----
  app.get("/pwa/:target/:file", async (c) => {
    const target = targets.find((t) => t.id === c.req.param("target"));
    if (!target) return c.notFound();
    const file = c.req.param("file");
    if (file === "manifest.webmanifest") {
      const manifest = buildManifest(target, pngDataUri(await loadIcon(c.env.DB, target, 192)));
      return new Response(JSON.stringify(manifest), {
        headers: { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "no-cache" },
      });
    }
    const match = /^icon-(\d+)\.png$/.exec(file);
    const size = Number(match?.[1]) as IconSize;
    if (!match || !ICON_SIZES.includes(size)) return c.notFound();
    const png = await loadIcon(c.env.DB, target, size);
    return new Response(png, {
      headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" },
    });
  });

  // ---- ログイン確認(ここから下はログイン済みのみ) ----
  app.use("*", async (c, next) => {
    const result = await authenticate(c.req.raw, c.env);
    if (!result.ok) {
      console.warn(`[auth] ${result.status} ${result.reason}`);
      if (new URL(c.req.url).pathname.startsWith("/api/")) {
        return c.json({ error: result.reason }, result.status);
      }
      return errorPage(result.status, result.reason);
    }
    c.set("user", await getOrCreateUser(c.env.DB, result.email));
    await next();
  });

  // ---- 共通部分のAPI ----
  app.get("/api/core/me", (c) => {
    const user = c.get("user");
    return c.json<MeResponse>({ email: user.email, displayName: user.displayName });
  });

  app.get("/api/core/home", async (c) => {
    const user = c.get("user");
    const cards = await Promise.all(
      deps.features.map(async (f): Promise<HomeCard> => {
        const server = deps.servers.find((s) => s.meta.id === f.id)?.server;
        let summary: string | null = null;
        if (server?.homeSummary) {
          try {
            summary = await server.homeSummary({ env: c.env, db: c.env.DB, user, feature: f });
          } catch (error) {
            console.error(`[home] ${f.id} の要約を作れませんでした`, error);
          }
        }
        const internal = f.kind === "internal";
        return {
          id: f.id,
          name: f.name,
          kind: f.kind,
          href: internal ? featurePath(f.id) : (f.url ?? "#"),
          iconUrl: internal ? iconUrl(f.id, 192) : iconUrl(APP_INFO.id, 192),
          color: f.color,
          summary,
        };
      }),
    );
    return c.json<HomeResponse>({ appName: APP_INFO.name, cards });
  });

  app.get("/api/core/status", async (c) => {
    return c.json<StatusResponse>({
      lastCronAt: await kvGet(c.env.DB, LAST_CRON_KEY),
      serverTime: new Date().toISOString(),
    });
  });

  // ---- 通知の宛先登録(許可はスーパーアプリ本体で1回だけ行う) ----
  app.get("/api/core/push/public-key", async (c) => {
    const keys = await getVapidKeys(c.env.DB);
    return c.json({ publicKey: keys.publicKey });
  });

  app.post("/api/core/push/subscribe", async (c) => {
    const user = c.get("user");
    const body = await c.req.json<{
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
      deviceLabel?: string;
      appContext?: string;
    }>();
    const context = body.appContext ?? "";
    if (!canRegisterPush(context)) {
      // 機能単体のアイコンからの登録を受け付けると、同じ通知が2通届くため
      return c.json({ error: "通知は、本体のアイコンから開いて有効にしてください" }, 409);
    }
    const endpoint = body.endpoint ?? "";
    const p256dh = body.keys?.p256dh ?? "";
    const auth = body.keys?.auth ?? "";
    if (!isValidSubscription(endpoint, p256dh, auth)) {
      return c.json({ error: "通知の宛先の形式が正しくありません" }, 400);
    }
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      "INSERT INTO core_push_subscriptions " +
        "(user_id, endpoint, p256dh, auth, device_label, user_agent, app_context, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, " +
        "p256dh = excluded.p256dh, auth = excluded.auth, device_label = excluded.device_label, " +
        "user_agent = excluded.user_agent, app_context = excluded.app_context, last_error = NULL",
    )
      .bind(
        user.id,
        endpoint,
        p256dh,
        auth,
        (body.deviceLabel ?? "").slice(0, 40) || null,
        (c.req.header("user-agent") ?? "").slice(0, 300),
        context,
        now,
      )
      .run();
    await rememberAppOrigin(c.env.DB, new URL(c.req.url).origin);
    return c.json({ ok: true });
  });

  app.post("/api/core/push/unsubscribe", async (c) => {
    const user = c.get("user");
    const { endpoint } = await c.req.json<{ endpoint?: string }>();
    if (!endpoint) return c.json({ error: "endpoint がありません" }, 400);
    await c.env.DB.prepare("DELETE FROM core_push_subscriptions WHERE endpoint = ? AND user_id = ?")
      .bind(endpoint, user.id)
      .run();
    return c.json({ ok: true });
  });

  app.post("/api/core/push/list", async (c) => {
    const user = c.get("user");
    const { currentEndpoint } = await c.req.json<{ currentEndpoint?: string | null }>();
    const rows = await c.env.DB.prepare(
      "SELECT id, endpoint, device_label, app_context, created_at, last_success_at, last_error " +
        "FROM core_push_subscriptions WHERE user_id = ? ORDER BY id",
    )
      .bind(user.id)
      .all<{
        id: number;
        endpoint: string;
        device_label: string | null;
        app_context: string | null;
        created_at: string;
        last_success_at: string | null;
        last_error: string | null;
      }>();
    return c.json<PushSubscriptionInfo[]>(
      rows.results.map((r) => ({
        id: r.id,
        service: serviceName(r.endpoint),
        deviceLabel: r.device_label,
        appContext: r.app_context,
        createdAt: r.created_at,
        lastSuccessAt: r.last_success_at,
        lastError: r.last_error,
        isThisDevice: !!currentEndpoint && r.endpoint === currentEndpoint,
      })),
    );
  });

  app.post("/api/core/push/test", async (c) => {
    const user = c.get("user");
    const { path } = await c.req.json<{ path?: string }>();
    const target = targetForPath(path ?? "/", targets);
    const started = Date.now();
    const results = await notify(c.env.DB, {
      to: [user.id],
      title: "テスト通知",
      body: `タップすると「${target.name}」が開きます。`,
      url: target.path,
      tag: "core-test",
    });
    console.log(`[push-test] ${results.length}件 ${Date.now() - started}ms`);
    return c.json<PushTestResult>({
      sent: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok && !r.removed).length,
      removed: results.filter((r) => r.removed).length,
      details: results.map((r) => ({ service: r.service, status: r.status, ...(r.error ? { error: r.error } : {}) })),
    });
  });

  // ---- 各機能のAPI ----
  for (const { meta, server } of deps.servers) {
    if (!server.routes) continue;
    const sub = new Hono<AppBindings>();
    server.routes(sub, meta);
    app.route(`/api/f/${meta.id}`, sub);
  }

  app.all("/api/*", (c) => c.json({ error: "見つかりません" }, 404));

  // ---- 画面と静的ファイル ----
  app.all("*", (c) => serveFrontend(c, targets));

  return app;
}

async function serveFrontend(c: AppContext, targets: ReturnType<typeof pwaTargets>): Promise<Response> {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const url = new URL(c.req.url);
  if (!isPageRequest(c.req.raw)) {
    // sw.js、画像、スクリプトなど(ページを開くリクエスト以外)は、そのまま静的ファイルとして返す
    return c.env.ASSETS.fetch(c.req.raw);
  }
  // "/piyolog" → "/piyolog/"(末尾のスラッシュをそろえる)
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length === 1 && !url.pathname.endsWith("/")) {
    return c.redirect(`${url.pathname}/${url.search}`, 301);
  }
  const target = targetForPath(url.pathname, targets);
  const [index, touchIcon] = await Promise.all([
    c.env.ASSETS.fetch(new Request(new URL("/", url), { headers: c.req.raw.headers })),
    loadIcon(c.env.DB, target, 180),
  ]);
  return injectHead(index, target, pngDataUri(touchIcon));
}

/** ページを開くリクエストか(スクリプトや画像の読み込みではないか)。 */
function isPageRequest(request: Request): boolean {
  const mode = request.headers.get("sec-fetch-mode");
  if (mode) return mode === "navigate";
  const lastSegment = new URL(request.url).pathname.split("/").pop() ?? "";
  return !lastSegment.includes(".") && (request.headers.get("accept") ?? "").includes("text/html");
}

function isValidSubscription(endpoint: string, p256dh: string, auth: string): boolean {
  try {
    if (new URL(endpoint).protocol !== "https:") return false;
    return base64UrlToBytes(p256dh).length === 65 && base64UrlToBytes(auth).length === 16;
  } catch {
    return false;
  }
}
