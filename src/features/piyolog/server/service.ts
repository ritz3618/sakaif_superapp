/** 取得、通知、画面用のまとめ(D1 と設定を使う処理の組み立て)。 */
import type { FeatureJobContext, FeatureSettings } from "../../../core/server/feature-api";
import { DAY_MS, MINUTE_MS, jstDate, jstStartOfDay } from "../../../core/shared/time";
import type { PiyologSummary } from "../shared/api";
import { DIAPER_TYPES, FEEDING_TYPES, SLEEP_TYPE, WAKE_TYPE } from "../shared/records";
import { diaperAlert, expiryAlert, feedExpiry, feedingAlert, type LastRecord } from "./alerts";
import { FeedError, fetchFeed } from "./feed";
import { earliestRecordAt, latestOfTypes, readSyncState, recordsSince, writeSyncState, type RecordRow } from "./repo";
import { computeStats } from "./stats";
import { applyFeed, type SyncResult } from "./sync";

/** 429 を受けたあと、取得を控える時間 */
const PAUSE_AFTER_RATE_LIMIT_MS = 15 * MINUTE_MS;
/** 通知の判定に使うデータの新しさの上限(これより古ければ、誤通知を避けるため判定しない) */
const MAX_DATA_AGE_FOR_ALERTS_MS = 15 * MINUTE_MS;

export interface FeedConfig {
  url: string | null;
  /** 期限の計算に使う作成日(入力された作成日、なければURLを保存した日) */
  createdOn: string | null;
}

export async function feedConfig(settings: FeatureSettings): Promise<FeedConfig> {
  const [url, created] = await Promise.all([settings.getWithMeta("feedUrl"), settings.get("feedCreatedOn")]);
  if (typeof url.value !== "string" || !url.value) return { url: null, createdOn: null };
  const createdOn = typeof created === "string" ? created : url.updatedAt ? jstDate(new Date(url.updatedAt)) : null;
  return { url: url.value, createdOn };
}

export type SyncOutcome = { status: "synced"; result: SyncResult } | { status: "paused"; until: string };

/** フィードを取得して保存する。失敗したら状態を記録して、エラーを投げる(URL はどこにも残さない)。 */
export async function syncFeed(db: D1Database, url: string, now: Date, fetcher?: typeof fetch): Promise<SyncOutcome> {
  const state = await readSyncState(db);
  if (state.pauseUntil && Date.parse(state.pauseUntil) > now.getTime()) {
    return { status: "paused", until: state.pauseUntil };
  }
  const at = now.toISOString();
  try {
    const feed = await fetchFeed(url, fetcher);
    const result = await applyFeed(db, feed, now);
    await writeSyncState(db, { lastSuccessAt: at, lastAttemptAt: at, lastAttemptOk: true, lastError: null, pauseUntil: null });
    return { status: "synced", result };
  } catch (error) {
    const message = error instanceof FeedError ? error.message : "フィードの保存中にエラーが起きました";
    const pauseUntil =
      error instanceof FeedError && error.kind === "rate_limited"
        ? new Date(now.getTime() + PAUSE_AFTER_RATE_LIMIT_MS).toISOString()
        : null;
    await writeSyncState(db, { ...state, lastAttemptAt: at, lastAttemptOk: false, lastError: message, pauseUntil });
    throw error instanceof FeedError ? error : new Error(message);
  }
}

function toLast(row: RecordRow | null): LastRecord | null {
  return row
    ? { eventId: row.event_id, type: row.type, at: Date.parse(row.recorded_at), value: row.value, unit: row.unit }
    : null;
}

/** 5分おきの定期実行。フィードURLが未設定なら、何もしない(失敗ではない)。 */
export async function runScheduledJob(ctx: FeatureJobContext): Promise<void> {
  const config = await feedConfig(ctx.settings);
  if (!config.url) return;
  const now = new Date();
  await syncFeed(ctx.db, config.url, now);

  // 取得を控えている間など、データが古いときは通知の判定をしない(誤通知を避ける)
  const state = await readSyncState(ctx.db);
  const fresh = state.lastSuccessAt && now.getTime() - Date.parse(state.lastSuccessAt) <= MAX_DATA_AGE_FOR_ALERTS_MS;
  const [feedingInterval, diaperInterval, lastFeeding, lastDiaper] = await Promise.all([
    ctx.settings.get("feedingIntervalMinutes"),
    ctx.settings.get("diaperIntervalMinutes"),
    fresh ? latestOfTypes(ctx.db, FEEDING_TYPES) : Promise.resolve(null),
    fresh ? latestOfTypes(ctx.db, DIAPER_TYPES) : Promise.resolve(null),
  ]);
  const alerts = [
    fresh ? feedingAlert(toLast(lastFeeding), feedingInterval as number, now.getTime()) : null,
    fresh ? diaperAlert(toLast(lastDiaper), diaperInterval as number, now.getTime()) : null,
    expiryAlert(config.createdOn, now.getTime()),
  ];
  for (const alert of alerts) {
    if (!alert) continue;
    await ctx.notify({
      type: alert.type,
      to: "all",
      dedupeKey: alert.dedupeKey,
      title: alert.title,
      body: alert.body,
      url: alert.type === "feed_expiring" ? "/settings/" : "/piyolog/",
      tag: `piyolog-${alert.type}`,
    });
  }
}

/** 画面に出すまとめ */
export async function buildSummary(db: D1Database, settings: FeatureSettings, now: Date): Promise<PiyologSummary> {
  const config = await feedConfig(settings);
  const since = new Date(jstStartOfDay(now).getTime() - 8 * DAY_MS).toISOString();
  const [state, rows, earliest, lastFeeding, lastPee, lastPoop] = await Promise.all([
    readSyncState(db),
    recordsSince(db, since),
    earliestRecordAt(db),
    latestOfTypes(db, FEEDING_TYPES),
    latestOfTypes(db, ["Pee"]),
    latestOfTypes(db, ["Poop"]),
  ]);
  const records = rows.map((r) => ({ type: r.type, at: Date.parse(r.recorded_at), value: r.value, unit: r.unit }));
  const stats = computeStats(records, now.getTime(), earliest ? Date.parse(earliest) : null);

  const sleepEvents = rows.filter((r) => r.type === SLEEP_TYPE || r.type === WAKE_TYPE);
  const lastSleepEvent = sleepEvents.at(-1);
  const lastSleep = [...sleepEvents].reverse().find((r) => r.type === SLEEP_TYPE);
  const lastWake = [...sleepEvents].reverse().find((r) => r.type === WAKE_TYPE);

  return {
    configured: config.url !== null,
    now: now.toISOString(),
    sync: {
      lastSuccessAt: state.lastSuccessAt ?? null,
      lastAttemptAt: state.lastAttemptAt ?? null,
      lastAttemptOk: state.lastAttemptOk ?? null,
      lastError: state.lastError ?? null,
    },
    feeding: {
      last: lastFeeding
        ? {
            at: lastFeeding.recorded_at,
            amountMl: lastFeeding.value !== null && lastFeeding.unit === "ml" ? lastFeeding.value : null,
          }
        : null,
    },
    pee: { lastAt: lastPee?.recorded_at ?? null },
    poop: { lastAt: lastPoop?.recorded_at ?? null },
    sleep: {
      state: !lastSleepEvent ? "unknown" : lastSleepEvent.type === SLEEP_TYPE ? "sleeping" : "awake",
      since: lastSleepEvent?.recorded_at ?? null,
      lastSleepAt: lastSleep?.recorded_at ?? null,
      lastWakeAt: lastWake?.recorded_at ?? null,
    },
    today: stats.today,
    comparison: stats.comparison,
    expiry: config.createdOn ? { createdOn: config.createdOn, ...feedExpiry(config.createdOn, now.getTime()) } : null,
  };
}
