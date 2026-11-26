/**
 * ホームのカード、並び順(ユーザーごと)、アイコン画像の登録のAPI。
 * 並び順は core_settings に、名前空間 "core"・キー "homeOrder" のユーザーごとの値として保存する
 * (設定画面に自動では出さない、専用の画面で扱う値)。
 */
import type { Hono } from "hono";
import { APP_INFO } from "../../shared/app";
import type { HomeCard, HomeOrderItem, HomeResponse, IconTargetInfo, IconUploadRequest } from "../../shared/api-types";
import type { FeatureMeta } from "../../shared/feature";
import { featurePath } from "../../shared/feature";
import { applyHomeOrder, isValidHomeOrder } from "../../shared/home-order";
import { NAMESPACE_CORE } from "../../shared/settings";
import type { RegisteredFeatureServer } from "../app";
import { base64UrlToBytes } from "../encoding";
import type { AppBindings } from "../env";
import { parsePngSize } from "../png";
import { iconUrl, type IconSize, type PwaTarget } from "../pwa";
import { ownedSources, sharedData } from "../data";
import { featureSettings, type SettingsNamespace } from "../settings";

const ORDER_KEY = "homeOrder";
const MAX_ICON_BYTES = 300_000;

async function savedOrder(db: D1Database, userId: number): Promise<string[] | null> {
  const row = await db
    .prepare("SELECT value FROM core_settings WHERE namespace = ? AND key = ? AND user_id = ?")
    .bind(NAMESPACE_CORE, ORDER_KEY, userId)
    .first<{ value: string }>();
  return row ? (JSON.parse(row.value) as string[]) : null;
}

/** 登録・生成済みのアイコンの更新時刻(画面のキャッシュを切り替えるため URL に付ける) */
async function iconVersions(db: D1Database): Promise<Map<string, { updatedAt: string; source: string }>> {
  const rows = await db
    .prepare("SELECT target_id, updated_at, source FROM core_icons WHERE size = 192")
    .all<{ target_id: string; updated_at: string; source: string }>();
  return new Map(rows.results.map((r) => [r.target_id, { updatedAt: r.updated_at, source: r.source }]));
}

function versionedIconUrl(targetId: string, versions: Map<string, { updatedAt: string }>): string {
  const v = versions.get(targetId)?.updatedAt;
  return `${iconUrl(targetId, 192)}?v=${v ? Date.parse(v) : 0}`;
}

export function registerHomeRoutes(
  app: Hono<AppBindings>,
  features: readonly FeatureMeta[],
  servers: readonly RegisteredFeatureServer[],
  targets: readonly PwaTarget[],
  registry: readonly SettingsNamespace[],
): void {
  const defaultIds = features.map((f) => f.id);

  app.get("/api/core/home", async (c) => {
    const user = c.get("user");
    const db = c.env.DB;
    const [order, versions] = await Promise.all([savedOrder(db, user.id), iconVersions(db)]);
    const ordered = applyHomeOrder(defaultIds, order).map((id) => features.find((f) => f.id === id)!);
    const cards = await Promise.all(
      ordered.map(async (f): Promise<HomeCard> => {
        const server = servers.find((s) => s.meta.id === f.id)?.server;
        let summary: string | null = null;
        if (server?.homeSummary) {
          try {
            summary = await server.homeSummary({
              env: c.env,
              db,
              user,
              feature: f,
              settings: featureSettings(db, registry, f.id),
              data: sharedData(db, ownedSources(f)),
            });
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
          iconUrl: versionedIconUrl(internal ? f.id : APP_INFO.id, versions),
          color: f.color,
          summary,
        };
      }),
    );
    return c.json<HomeResponse>({ appName: APP_INFO.name, cards });
  });

  app.get("/api/core/home/order", async (c) => {
    const user = c.get("user");
    const [order, versions] = await Promise.all([savedOrder(c.env.DB, user.id), iconVersions(c.env.DB)]);
    const items = applyHomeOrder(defaultIds, order).map((id): HomeOrderItem => {
      const f = features.find((x) => x.id === id)!;
      return { id, name: f.name, iconUrl: versionedIconUrl(f.kind === "internal" ? f.id : APP_INFO.id, versions) };
    });
    return c.json({ items, isDefault: order === null });
  });

  app.put("/api/core/home/order", async (c) => {
    const user = c.get("user");
    const { order } = await c.req.json<{ order?: unknown }>();
    const db = c.env.DB;
    if (order === null) {
      // 既定の順に戻す
      await db
        .prepare("DELETE FROM core_settings WHERE namespace = ? AND key = ? AND user_id = ?")
        .bind(NAMESPACE_CORE, ORDER_KEY, user.id)
        .run();
      return c.json({ ok: true });
    }
    if (!isValidHomeOrder(defaultIds, order)) return c.json({ error: "並び順の形式が正しくありません" }, 400);
    const now = new Date().toISOString();
    await db
      .prepare(
        "INSERT INTO core_settings (namespace, key, user_id, value, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT(namespace, key, user_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      )
      .bind(NAMESPACE_CORE, ORDER_KEY, user.id, JSON.stringify(order), now, user.id)
      .run();
    return c.json({ ok: true });
  });

  // ---- アイコン画像(本体と各機能) ----
  app.get("/api/core/icons", async (c) => {
    const versions = await iconVersions(c.env.DB);
    return c.json<IconTargetInfo[]>(
      targets.map((t) => ({
        id: t.id,
        name: t.name,
        isApp: t.isApp,
        iconUrl: versionedIconUrl(t.id, versions),
        source: versions.get(t.id)?.source === "upload" ? "upload" : "default",
      })),
    );
  });

  app.put("/api/core/icons/:target", async (c) => {
    const target = targets.find((t) => t.id === c.req.param("target"));
    if (!target) return c.json({ error: "その対象はありません" }, 404);
    const body = await c.req.json<Partial<IconUploadRequest>>();
    const images: [IconSize, string | undefined][] = [
      [180, body.png180],
      [192, body.png192],
    ];
    const decoded: [IconSize, Uint8Array][] = [];
    for (const [size, base64] of images) {
      if (typeof base64 !== "string") return c.json({ error: `${size}px の画像がありません` }, 400);
      let bytes: Uint8Array;
      try {
        bytes = base64UrlToBytes(base64);
      } catch {
        return c.json({ error: "画像の形式が正しくありません" }, 400);
      }
      const dimensions = parsePngSize(bytes);
      if (!dimensions || dimensions.width !== size || dimensions.height !== size) {
        return c.json({ error: `${size}×${size} の PNG 画像にしてください` }, 400);
      }
      if (bytes.length > MAX_ICON_BYTES) return c.json({ error: "画像が大きすぎます" }, 400);
      decoded.push([size, bytes]);
    }
    const now = new Date().toISOString();
    await c.env.DB.batch(
      decoded.map(([size, bytes]) =>
        c.env.DB.prepare(
          "INSERT INTO core_icons (target_id, size, png, source, updated_at) VALUES (?, ?, ?, 'upload', ?) " +
            "ON CONFLICT(target_id, size) DO UPDATE SET png = excluded.png, source = 'upload', updated_at = excluded.updated_at",
        ).bind(target.id, size, bytes, now),
      ),
    );
    return c.json({ ok: true });
  });

  app.delete("/api/core/icons/:target", async (c) => {
    const target = targets.find((t) => t.id === c.req.param("target"));
    if (!target) return c.json({ error: "その対象はありません" }, 404);
    // 削除すると、次に表示したときに既定のアイコンが作り直される
    await c.env.DB.prepare("DELETE FROM core_icons WHERE target_id = ?").bind(target.id).run();
    return c.json({ ok: true });
  });
}
