/** 設定と通知の履歴のAPI(/api/core/settings、/api/core/notifications)。 */
import type { Hono } from "hono";
import type { NotificationHistoryItem } from "../../shared/api-types";
import type { FeatureMeta } from "../../shared/feature";
import { validateSettingValue, type SettingSection } from "../../shared/settings";
import type { AppBindings } from "../env";
import { CORE_FEATURE_ID } from "../notify";
import { findSettingDef, settingSectionsForUser, writeSetting, type SettingsNamespace } from "../settings";

export function registerSettingsRoutes(
  app: Hono<AppBindings>,
  features: readonly FeatureMeta[],
  registry: readonly SettingsNamespace[],
): void {
  app.get("/api/core/settings", async (c) => {
    const user = c.get("user");
    return c.json<SettingSection[]>(await settingSectionsForUser(c.env.DB, registry, user.id));
  });

  app.put("/api/core/settings", async (c) => {
    const user = c.get("user");
    const body = await c.req.json<{ namespace?: string; key?: string; value?: unknown }>();
    const def = findSettingDef(registry, body.namespace ?? "", body.key ?? "");
    if (!def) return c.json({ error: "その設定はありません" }, 404);
    const checked = validateSettingValue(def, body.value === undefined ? null : body.value);
    if (!checked.ok) return c.json({ error: checked.error }, 400);
    const updatedAt = await writeSetting(c.env.DB, body.namespace!, def, user.id, checked.value);
    return c.json({ ok: true, updatedAt });
  });

  app.get("/api/core/notifications/history", async (c) => {
    const user = c.get("user");
    const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 30) || 30));
    const rows = await c.env.DB.prepare(
      "SELECT id, feature_id, type, title, body, status, sent_count, created_at FROM core_notification_log " +
        "WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
    )
      .bind(user.id, limit)
      .all<{
        id: number;
        feature_id: string;
        type: string;
        title: string;
        body: string;
        status: string;
        sent_count: number;
        created_at: string;
      }>();
    const nameOf = (id: string) => (id === CORE_FEATURE_ID ? "共通" : (features.find((f) => f.id === id)?.name ?? id));
    return c.json<NotificationHistoryItem[]>(
      rows.results.map((r) => ({
        id: r.id,
        featureName: nameOf(r.feature_id),
        type: r.type,
        title: r.title,
        body: r.body,
        status: r.status,
        sentCount: r.sent_count,
        createdAt: r.created_at,
      })),
    );
  });
}
