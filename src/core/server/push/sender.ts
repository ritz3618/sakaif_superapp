/**
 * 通知の送信(端末の宛先の管理、VAPID 鍵の保管、送信と失効した宛先の削除)。
 * 機能は、ここを直接呼ばず、notify.ts の入口を使う。
 */
import { kvGet, kvSetIfAbsent } from "../kv";
import { buildPushRequest, createVapidJwt, generateVapidKeys, type VapidKeys } from "./webpush";

export interface NotificationPayload {
  title: string;
  body: string;
  /** 通知をタップしたときに開くパス(例: "/piyolog/") */
  url?: string;
  /** 同じ tag の通知は、端末上で新しいものに置き換わる */
  tag?: string;
}

export interface SubscriptionRow {
  id: number;
  user_id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface SendResult {
  subscriptionId: number;
  service: string;
  status: number | null;
  ok: boolean;
  removed: boolean;
  error?: string;
}

const VAPID_KEY = "vapid_keys";
const APP_ORIGIN_KEY = "app_origin";

let cachedVapid: VapidKeys | null = null;
const jwtCache = new Map<string, { jwt: string; expiresAt: number }>();

/** VAPID 鍵を返す。まだ無ければ、Worker が自動で作って D1 に保存する(コードやチャットに鍵は出ない)。 */
export async function getVapidKeys(db: D1Database): Promise<VapidKeys> {
  if (cachedVapid) return cachedVapid;
  const stored = await kvGet(db, VAPID_KEY);
  const json = stored ?? (await kvSetIfAbsent(db, VAPID_KEY, JSON.stringify(await generateVapidKeys())));
  cachedVapid = JSON.parse(json) as VapidKeys;
  return cachedVapid;
}

/** VAPID の sub(送信者の連絡先)に使う、このアプリのURLを覚えておく。 */
export async function rememberAppOrigin(db: D1Database, origin: string): Promise<void> {
  if ((await kvGet(db, APP_ORIGIN_KEY)) === origin) return;
  await db
    .prepare(
      "INSERT INTO core_kv (key, value, updated_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(APP_ORIGIN_KEY, origin, new Date().toISOString())
    .run();
}

async function vapidSubject(db: D1Database): Promise<string> {
  const origin = await kvGet(db, APP_ORIGIN_KEY);
  return origin?.startsWith("https://") ? origin : "https://localhost.invalid";
}

async function vapidJwtFor(db: D1Database, keys: VapidKeys, endpoint: string, now: number): Promise<string> {
  const audience = new URL(endpoint).origin;
  const cached = jwtCache.get(audience);
  if (cached && cached.expiresAt - now > 10 * 60 * 1000) return cached.jwt;
  const expiresAt = now + 60 * 60 * 1000;
  const jwt = await createVapidJwt(keys.privateJwk, audience, await vapidSubject(db), new Date(expiresAt));
  jwtCache.set(audience, { jwt, expiresAt });
  return jwt;
}

export function serviceName(endpoint: string): string {
  try {
    return new URL(endpoint).hostname;
  } catch {
    return "(不明)";
  }
}

/** 宛先の一覧に通知を送る。失効した宛先(404、410)は削除する。 */
export async function sendToSubscriptions(
  db: D1Database,
  subscriptions: readonly SubscriptionRow[],
  payload: NotificationPayload,
  options: { ttlSeconds?: number; urgency?: "normal" | "high" } = {},
): Promise<SendResult[]> {
  if (subscriptions.length === 0) return [];
  const keys = await getVapidKeys(db);
  const body = JSON.stringify(payload);
  const now = Date.now();

  return Promise.all(
    subscriptions.map(async (sub): Promise<SendResult> => {
      const service = serviceName(sub.endpoint);
      try {
        const request = await buildPushRequest({
          subscription: sub,
          payload: body,
          vapidPublicKey: keys.publicKey,
          vapidJwt: await vapidJwtFor(db, keys, sub.endpoint, now),
          ttlSeconds: options.ttlSeconds ?? 60 * 60,
          urgency: options.urgency ?? "high",
        });
        const response = await fetch(request.url, {
          method: "POST",
          headers: request.headers,
          body: request.body,
          signal: AbortSignal.timeout(10_000),
        });
        const at = new Date().toISOString();
        if (response.ok) {
          await db
            .prepare("UPDATE core_push_subscriptions SET last_success_at = ?, last_error = NULL WHERE id = ?")
            .bind(at, sub.id)
            .run();
          return { subscriptionId: sub.id, service, status: response.status, ok: true, removed: false };
        }
        const detail = (await response.text()).slice(0, 200);
        if (response.status === 404 || response.status === 410) {
          await db.prepare("DELETE FROM core_push_subscriptions WHERE id = ?").bind(sub.id).run();
          return { subscriptionId: sub.id, service, status: response.status, ok: false, removed: true, error: detail };
        }
        await db
          .prepare("UPDATE core_push_subscriptions SET last_error = ? WHERE id = ?")
          .bind(`${at} ${response.status} ${detail}`, sub.id)
          .run();
        return { subscriptionId: sub.id, service, status: response.status, ok: false, removed: false, error: detail };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { subscriptionId: sub.id, service, status: null, ok: false, removed: false, error: message };
      }
    }),
  );
}

export async function subscriptionsForUsers(db: D1Database, userIds: readonly number[] | "all"): Promise<SubscriptionRow[]> {
  if (userIds === "all") {
    const rows = await db
      .prepare("SELECT id, user_id, endpoint, p256dh, auth FROM core_push_subscriptions")
      .all<SubscriptionRow>();
    return rows.results;
  }
  if (userIds.length === 0) return [];
  const placeholders = userIds.map(() => "?").join(",");
  const rows = await db
    .prepare(`SELECT id, user_id, endpoint, p256dh, auth FROM core_push_subscriptions WHERE user_id IN (${placeholders})`)
    .bind(...userIds)
    .all<SubscriptionRow>();
  return rows.results;
}
