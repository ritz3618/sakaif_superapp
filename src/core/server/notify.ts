/**
 * 通知の入口。機能は「誰に、どの種類の通知を、何を載せて送るか」だけを渡す。
 * 次のことは、ここ(共通部分)で行う。
 *   - ユーザーごと・機能ごとのオン/オフ(エラー通知は、ユーザーごとの「エラー通知を受け取る」)
 *   - 通知を避ける時間帯(夫婦共通)。時間帯の間は送らずに「保留」を返す。
 *     機能は5分おきに同じ判定を繰り返すので、時間帯が明けた最初の回に送られる(1回だけ)。
 *   - 同じ通知の重複防止(dedupeKey が同じで、送信済みなら送らない)
 *   - 送信履歴の記録
 */
import { NAMESPACE_CORE, featureNotifySetting, isWithinTimeRanges, type TimeRange } from "../shared/settings";
import { CORE_SETTINGS } from "../shared/settings";
import { sendToSubscriptions, subscriptionsForUsers, type NotificationPayload, type SendResult } from "./push/sender";
import { findSettingDef, readSetting, readUserSettingForUsers, type SettingsNamespace } from "./settings";
import { jstMinuteOfDay } from "./time";

/** 共通部分が送る通知の「機能ID」 */
export const CORE_FEATURE_ID = NAMESPACE_CORE;
export const CORE_ERROR_TYPE = "error";
export const CORE_TEST_TYPE = "test";

export interface NotifyRequest extends NotificationPayload {
  /** 通知の種類(機能の宣言 notifications の type) */
  type: string;
  /** "all" は登録済みの全員。ユーザーIDの配列で個別に指定もできる。 */
  to: "all" | readonly number[];
  /** 同じキーの通知は、そのユーザーに送信済みなら二度と送らない(例: "feeding:<最後の授乳の event_id>") */
  dedupeKey?: string;
  /** true なら、通知を避ける時間帯でも送る(テスト通知など) */
  ignoreQuietHours?: boolean;
}

/** 共通部分が内部で使う形(機能IDつき) */
export interface CoreNotifyRequest extends NotifyRequest {
  featureId: string;
}

export type NotifyOutcome =
  | "sent" // 1台以上の端末に届けた
  | "failed" // 送ろうとしたが、すべての端末で失敗した
  | "deferred_quiet" // 通知を避ける時間帯のため保留(次の判定で送られる)
  | "disabled" // 本人が通知をオフにしている
  | "duplicate" // 同じ通知を送信済み
  | "no_device"; // 通知を受け取る端末が登録されていない

export interface NotifyUserResult {
  userId: number;
  outcome: NotifyOutcome;
  sends: SendResult[];
}

/** 1人分の判定(テストしやすいように、データの読み書きから切り離している)。 */
export function decideNotification(input: {
  enabled: boolean;
  quiet: boolean;
  alreadySent: boolean;
  deviceCount: number;
}): "send" | Exclude<NotifyOutcome, "sent" | "failed"> {
  if (!input.enabled) return "disabled";
  if (input.alreadySent) return "duplicate";
  if (input.quiet) return "deferred_quiet";
  if (input.deviceCount === 0) return "no_device";
  return "send";
}

export interface NotifyDeps {
  db: D1Database;
  registry: readonly SettingsNamespace[];
  now?: Date;
}

async function recipients(db: D1Database, to: CoreNotifyRequest["to"]): Promise<number[]> {
  if (to !== "all") return [...new Set(to)];
  const rows = await db.prepare("SELECT id FROM core_users ORDER BY id").all<{ id: number }>();
  return rows.results.map((r) => r.id);
}

/** オン/オフの設定(機能ごと、またはエラー通知)をユーザーごとに読む。 */
async function enabledByUser(deps: NotifyDeps, request: CoreNotifyRequest, userIds: number[]): Promise<Map<number, boolean>> {
  let namespace: string;
  let def;
  if (request.featureId === CORE_FEATURE_ID) {
    if (request.type !== CORE_ERROR_TYPE) return new Map(userIds.map((id) => [id, true]));
    namespace = NAMESPACE_CORE;
    def = CORE_SETTINGS.find((d) => d.key === "errorAlerts")!;
  } else {
    namespace = request.featureId;
    def = findSettingDef(deps.registry, namespace, featureNotifySetting("").key);
    if (!def) return new Map(userIds.map((id) => [id, true]));
  }
  const values = await readUserSettingForUsers(deps.db, namespace, def, userIds);
  return new Map(userIds.map((id) => [id, values.get(id) !== false]));
}

async function isQuietNow(deps: NotifyDeps): Promise<boolean> {
  const def = CORE_SETTINGS.find((d) => d.key === "quietHours")!;
  const ranges = (await readSetting(deps.db, NAMESPACE_CORE, def, null)) as TimeRange[];
  return isWithinTimeRanges(jstMinuteOfDay(deps.now ?? new Date()), ranges);
}

async function alreadySentUsers(db: D1Database, dedupeKey: string | undefined, userIds: number[]): Promise<Set<number>> {
  if (!dedupeKey || userIds.length === 0) return new Set();
  const rows = await db
    .prepare(
      `SELECT DISTINCT user_id FROM core_notification_log WHERE dedupe_key = ? AND status = 'sent' AND user_id IN (${userIds.map(() => "?").join(",")})`,
    )
    .bind(dedupeKey, ...userIds)
    .all<{ user_id: number }>();
  return new Set(rows.results.map((r) => r.user_id));
}

export async function notify(deps: NotifyDeps, request: CoreNotifyRequest): Promise<NotifyUserResult[]> {
  const { db } = deps;
  const userIds = await recipients(db, request.to);
  if (userIds.length === 0) return [];

  const [enabled, quiet, sent, subscriptions] = await Promise.all([
    enabledByUser(deps, request, userIds),
    request.ignoreQuietHours ? Promise.resolve(false) : isQuietNow(deps),
    alreadySentUsers(db, request.dedupeKey, userIds),
    subscriptionsForUsers(db, userIds),
  ]);

  const payload: NotificationPayload = { title: request.title, body: request.body, url: request.url, tag: request.tag };
  const results = await Promise.all(
    userIds.map(async (userId): Promise<NotifyUserResult> => {
      const devices = subscriptions.filter((s) => s.user_id === userId);
      const decision = decideNotification({
        enabled: enabled.get(userId) ?? true,
        quiet,
        alreadySent: sent.has(userId),
        deviceCount: devices.length,
      });
      if (decision !== "send") return { userId, outcome: decision, sends: [] };
      const sends = await sendToSubscriptions(db, devices, payload);
      return { userId, outcome: sends.some((s) => s.ok) ? "sent" : "failed", sends };
    }),
  );

  // 送信を試みた分だけ、履歴に残す(保留やオフは記録しない。5分おきに繰り返されるため)。
  const attempted = results.filter((r) => r.outcome === "sent" || r.outcome === "failed");
  if (attempted.length > 0) {
    const now = (deps.now ?? new Date()).toISOString();
    await db.batch(
      attempted.map((r) =>
        db
          .prepare(
            "INSERT INTO core_notification_log (user_id, feature_id, type, dedupe_key, title, body, url, status, sent_count, created_at) " +
              "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(
            r.userId,
            request.featureId,
            request.type,
            request.dedupeKey ?? null,
            request.title,
            request.body,
            request.url ?? null,
            r.outcome,
            r.sends.filter((s) => s.ok).length,
            now,
          ),
      ),
    );
  }
  return results;
}

/** 古い送信履歴(90日より前)を消す。 */
export async function pruneNotificationLog(db: D1Database, now: Date): Promise<void> {
  const limit = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
  await db.prepare("DELETE FROM core_notification_log WHERE created_at < ?").bind(limit).run();
}
