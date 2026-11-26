/**
 * 取得、通知、画面用のまとめ。
 * 記録は共通データ(source = "piyolog")に置き、取得の状態だけを、この機能のテーブル(piyolog_state)に置く。
 */
import type { DataRecord, DataRecordInput, FeatureJobContext, FeatureSettings, SharedData } from "../../../core/server/feature-api";
import { DAY_MS, MINUTE_MS, jstDate, jstStartOfDay } from "../../../core/shared/time";
import type { LatestValue, PiyologDataInfo, PiyologSummary } from "../shared/api";
import { DIAPER_TYPES, FEEDING_TYPES, PIYOLOG_SOURCE, SLEEP_TYPE, WAKE_TYPE } from "../shared/records";
import { diaperAlert, expiryAlert, feedExpiry, feedingAlert, type LastRecord } from "./alerts";
import { FeedError, fetchFeed, type Feed, type FeedRecord } from "./feed";
import { readSyncState, writeSyncState } from "./repo";
import { computeStats, computeTimeline } from "./stats";

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

/** フィードの記録を、共通データの形にする(id = event_id、kind = type、note = メモ、payload = 記録そのもの)。 */
export function toDataRecord(record: FeedRecord): DataRecordInput {
  const v = record.value;
  return {
    id: record.event_id,
    kind: record.type,
    recordedAt: record.datetime,
    value: typeof v?.value === "number" ? v.value : null,
    unit: typeof v?.unit === "string" ? v.unit : null,
    note: typeof record.memo === "string" ? record.memo : null,
    payload: JSON.stringify(record),
  };
}

export function feedToSnapshot(feed: Feed) {
  return { from: feed.from, to: feed.to, records: feed.records.map(toDataRecord) };
}

export type SyncOutcome = { status: "synced"; written: number; deleted: number } | { status: "paused"; until: string };

/** フィードを取得して保存する。失敗したら状態を記録して、エラーを投げる(URL はどこにも残さない)。 */
export async function syncFeed(
  db: D1Database,
  data: SharedData,
  url: string,
  now: Date,
  fetcher?: typeof fetch,
): Promise<SyncOutcome> {
  const state = await readSyncState(db);
  if (state.pauseUntil && Date.parse(state.pauseUntil) > now.getTime()) {
    return { status: "paused", until: state.pauseUntil };
  }
  const at = now.toISOString();
  try {
    const feed = await fetchFeed(url, fetcher);
    const result = await data.applySnapshot(PIYOLOG_SOURCE, feedToSnapshot(feed));
    await writeSyncState(db, {
      lastSuccessAt: at,
      lastAttemptAt: at,
      lastAttemptOk: true,
      lastError: null,
      pauseUntil: null,
      feedFrom: feed.from,
    });
    return { status: "synced", written: result.written, deleted: result.deleted };
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

function toLast(record: DataRecord | null): LastRecord | null {
  return record
    ? { eventId: record.id, type: record.kind, at: Date.parse(record.recordedAt), value: record.value, unit: record.unit }
    : null;
}

/** 5分おきの定期実行。フィードURLが未設定なら、何もしない(失敗ではない)。 */
export async function runScheduledJob(ctx: FeatureJobContext): Promise<void> {
  const config = await feedConfig(ctx.settings);
  if (!config.url) return;
  const now = new Date();
  await syncFeed(ctx.db, ctx.data, config.url, now);

  // 取得を控えている間など、データが古いときは通知の判定をしない(誤通知を避ける)
  const state = await readSyncState(ctx.db);
  const fresh = !!state.lastSuccessAt && now.getTime() - Date.parse(state.lastSuccessAt) <= MAX_DATA_AGE_FOR_ALERTS_MS;
  const [feedingInterval, diaperInterval, lastFeeding, lastDiaper] = await Promise.all([
    ctx.settings.get("feedingIntervalMinutes"),
    ctx.settings.get("diaperIntervalMinutes"),
    fresh ? ctx.data.latest(PIYOLOG_SOURCE, FEEDING_TYPES) : Promise.resolve(null),
    fresh ? ctx.data.latest(PIYOLOG_SOURCE, DIAPER_TYPES) : Promise.resolve(null),
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
      url: alert.type === "feed_expiring" ? "/settings/" : `/${ctx.feature.id}/`,
      tag: `${ctx.feature.id}-${alert.type}`,
    });
  }
}

/** 室温・湿度の機能が共通データに置いている値の出どころ(読むだけ) */
const ROOM_SOURCE = "switchbot";

function roomOf(temp: DataRecord | null, hum: DataRecord | null): PiyologSummary["room"] {
  if (!temp && !hum) return null;
  const warnings: NonNullable<PiyologSummary["room"]>["warnings"] = [];
  for (const [metric, r] of [["temperature", temp], ["humidity", hum]] as const) {
    if (!r?.payload) continue;
    try {
      const w = (JSON.parse(r.payload) as { warning?: { direction?: unknown; threshold?: unknown } | null }).warning;
      if (w && (w.direction === "low" || w.direction === "high") && typeof w.threshold === "number") {
        warnings.push({ metric, direction: w.direction, threshold: w.threshold });
      }
    } catch {
      // 読めなければ注意なし
    }
  }
  const at = [temp?.recordedAt, hum?.recordedAt].filter((x): x is string => !!x).sort().at(-1)!;
  return { at, temperature: temp?.value ?? null, humidity: hum?.value ?? null, warnings };
}

const toLatest = (r: DataRecord | null): LatestValue | null =>
  r ? { at: r.recordedAt, value: r.value, unit: r.unit } : null;

/** 画面に出すまとめ */
export async function buildSummary(
  db: D1Database,
  data: SharedData,
  settings: FeatureSettings,
  now: Date,
): Promise<PiyologSummary> {
  const config = await feedConfig(settings);
  // 過去7日と、7日前の夜からの睡眠のため、8日前の0時から読む
  const since = new Date(jstStartOfDay(now).getTime() - 8 * DAY_MS).toISOString();
  const [state, rows, earliest, interval, target, lastFeeding, lastPee, lastPoop, temperature, weight, height, bath, roomTemp, roomHum] =
    await Promise.all([
      readSyncState(db),
      data.query(PIYOLOG_SOURCE, { from: since }),
      data.earliestAt(PIYOLOG_SOURCE),
      settings.get("feedingIntervalMinutes"),
      settings.get("dailyFeedingTargetMl"),
      data.latest(PIYOLOG_SOURCE, FEEDING_TYPES),
      data.latest(PIYOLOG_SOURCE, ["Pee"]),
      data.latest(PIYOLOG_SOURCE, ["Poop"]),
      data.latest(PIYOLOG_SOURCE, ["Temperature"]),
      data.latest(PIYOLOG_SOURCE, ["Weight"]),
      data.latest(PIYOLOG_SOURCE, ["Height"]),
      data.latest(PIYOLOG_SOURCE, ["Bath"]),
      data.latest(ROOM_SOURCE, ["temperature"]),
      data.latest(ROOM_SOURCE, ["humidity"]),
    ]);
  const records = rows.map((r) => ({ type: r.kind, at: Date.parse(r.recordedAt), value: r.value, unit: r.unit }));
  const earliestAt = earliest ? Date.parse(earliest) : null;
  const stats = computeStats(records, now.getTime(), earliestAt);

  const sleepEvents = rows.filter((r) => r.kind === SLEEP_TYPE || r.kind === WAKE_TYPE);
  const lastSleepEvent = sleepEvents.at(-1);
  const lastSleep = [...sleepEvents].reverse().find((r) => r.kind === SLEEP_TYPE);
  const lastWake = [...sleepEvents].reverse().find((r) => r.kind === WAKE_TYPE);

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
            at: lastFeeding.recordedAt,
            amountMl: lastFeeding.value !== null && lastFeeding.unit === "ml" ? lastFeeding.value : null,
          }
        : null,
      intervalMinutes: interval as number,
      dailyTargetMl: typeof target === "number" ? target : null,
    },
    pee: { lastAt: lastPee?.recordedAt ?? null },
    poop: { lastAt: lastPoop?.recordedAt ?? null },
    sleep: {
      state: !lastSleepEvent ? "unknown" : lastSleepEvent.kind === SLEEP_TYPE ? "sleeping" : "awake",
      since: lastSleepEvent?.recordedAt ?? null,
      lastSleepAt: lastSleep?.recordedAt ?? null,
      lastWakeAt: lastWake?.recordedAt ?? null,
    },
    today: stats.today,
    comparison: { sameTime: stats.sameTime, fullDay: stats.fullDay, perFeedingMl: stats.perFeedingMl },
    latest: {
      temperature: toLatest(temperature),
      weight: toLatest(weight),
      height: toLatest(height),
      bath: toLatest(bath),
    },
    room: roomOf(roomTemp, roomHum),
    timeline: computeTimeline(records, now.getTime(), earliestAt),
    expiry: config.createdOn ? { createdOn: config.createdOn, ...feedExpiry(config.createdOn, now.getTime()) } : null,
  };
}

/** フィードの範囲の始まり(まだ取得できていなければ null) */
async function feedFrom(db: D1Database, now: Date): Promise<Date | null> {
  const state = await readSyncState(db);
  return state.feedFrom ? new Date(Math.min(Date.parse(state.feedFrom), now.getTime())) : null;
}

/** テキストの取り込みで扱う期間の終わり(フィードの範囲の始まり。フィードを使っていなければ今) */
export async function importCutoff(db: D1Database, now: Date): Promise<Date> {
  return (await feedFrom(db, now)) ?? now;
}

/** データの管理の画面に出す情報 */
export async function buildDataInfo(
  db: D1Database,
  data: SharedData,
  settings: FeatureSettings,
  now: Date,
): Promise<PiyologDataInfo> {
  const [config, stored, cutoff] = await Promise.all([
    feedConfig(settings),
    data.stats(PIYOLOG_SOURCE),
    feedFrom(db, now),
  ]);
  return {
    configured: config.url !== null,
    stored,
    importCutoff: cutoff?.toISOString() ?? null,
    expiry: config.createdOn ? { createdOn: config.createdOn, ...feedExpiry(config.createdOn, now.getTime()) } : null,
  };
}
