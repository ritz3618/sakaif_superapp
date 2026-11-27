/**
 * 室温・湿度(SwitchBot)の取得、通知、画面用のまとめ(育児ログの一部。2026-11-26 ユーザー決定)。
 * 値は、ほかの機能でも使えるよう共通データ(source = "switchbot")に置き、
 * 使っている機器と取得の状態だけを、この機能のテーブル(piyolog_state の "switchbot")に置く。
 */
import type { DataRecordInput, FeatureJobContext, FeatureSettings, SharedData } from "../../../core/server/feature-api";
import { DAY_MS, MINUTE_MS, jstDate, jstDayStart, jstStartOfDay } from "../../../core/shared/time";
import { ROOM_SOURCE } from "../shared/records";
import type { MetricDayStats, RoomDayStats } from "../shared/api";
import type { DeviceCheck, Metric, RoomSummary, Thresholds } from "../shared/room-api";
import { evaluate } from "../shared/room-thresholds";
import { readRoomState as readState, writeRoomState as writeState, type RoomState } from "./repo";
import { alertMetrics, roomAlert } from "./room-alerts";
import { isHubType, isMeterType, listDevices, meterStatus, SwitchBotError, viaHub, type Credentials } from "./switchbot";

const METRICS: readonly Metric[] = ["temperature", "humidity"];
const UNITS: Record<Metric, string> = { temperature: "celsius", humidity: "percent" };

export async function credentials(settings: FeatureSettings): Promise<Credentials | null> {
  const [token, secret] = await Promise.all([settings.get("switchbotToken"), settings.get("switchbotSecret")]);
  return typeof token === "string" && token && typeof secret === "string" && secret ? { token, secret } : null;
}

export async function roomThresholds(settings: FeatureSettings): Promise<Thresholds> {
  const [tl, th, hl, hh] = await Promise.all([
    settings.get("roomTemperatureLow"),
    settings.get("roomTemperatureHigh"),
    settings.get("roomHumidityLow"),
    settings.get("roomHumidityHigh"),
  ]);
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  return { temperatureLow: num(tl), temperatureHigh: num(th), humidityLow: num(hl), humidityHigh: num(hh) };
}

/** 使う機器を決める(名前の指定があればその名前、なければ最初の温湿度を測れる機器) */
async function chooseDevice(creds: Credentials, wanted: string, fetcher?: typeof fetch): Promise<NonNullable<RoomState["device"]>> {
  const meters = (await listDevices(creds, fetcher)).filter((d) => isMeterType(d.deviceType));
  const device = wanted ? meters.find((d) => d.deviceName === wanted) : meters[0];
  if (!device) {
    throw new SwitchBotError(
      wanted ? `「${wanted}」という機器が見つかりません` : "SwitchBot に、温湿度を測れる機器が見つかりません",
      "not_found",
    );
  }
  return { id: device.deviceId, name: device.deviceName, type: device.deviceType, chosenFor: wanted };
}

/** 値の記録(室温と湿度の2件)。基準との比較の結果も payload に入れる(ほかの機能が注意の表示に使える) */
export function toRecords(device: { id: string; name: string }, at: Date, values: Record<Metric, number>, t: Thresholds): DataRecordInput[] {
  const minute = new Date(Math.floor(at.getTime() / MINUTE_MS) * MINUTE_MS).toISOString();
  return METRICS.map((metric) => {
    const warning = evaluate(metric, values[metric], t);
    return {
      id: `${device.id}:${metric}:${minute}`,
      kind: metric,
      recordedAt: minute,
      value: values[metric],
      unit: UNITS[metric],
      payload: JSON.stringify({
        deviceName: device.name,
        warning: warning ? { direction: warning.direction, threshold: warning.threshold } : null,
      }),
    };
  });
}

/** 1回分の取得。失敗したら状態を記録して、エラーを投げる */
export async function fetchReading(
  db: D1Database,
  data: SharedData,
  settings: FeatureSettings,
  now: Date,
  fetcher?: typeof fetch,
): Promise<boolean> {
  const creds = await credentials(settings);
  if (!creds) return false;
  const state = await readState(db);
  const at = now.toISOString();
  try {
    const wanted = String((await settings.get("switchbotDeviceName")) ?? "").trim();
    let device = state.device && state.device.chosenFor === wanted ? state.device : await chooseDevice(creds, wanted, fetcher);
    let status;
    try {
      status = await meterStatus(creds, device.id, fetcher);
    } catch (error) {
      // 温湿度計が登録し直されたときなど: 選び直して、もう1回だけ試す
      if (!(error instanceof SwitchBotError) || error.kind !== "not_found") throw error;
      device = await chooseDevice(creds, wanted, fetcher);
      status = await meterStatus(creds, device.id, fetcher);
    }
    await data.upsert(ROOM_SOURCE, toRecords(device, now, status, await roomThresholds(settings)));
    await writeState(db, { device, lastSuccessAt: at, lastAttemptAt: at, lastError: null });
    return true;
  } catch (error) {
    const message = error instanceof SwitchBotError ? error.message : "室温・湿度の保存中にエラーが起きました";
    await writeState(db, { ...state, lastAttemptAt: at, lastError: message });
    throw error instanceof SwitchBotError ? error : new Error(message);
  }
}

/** 5分おきの定期実行の室温・湿度の部分。トークンが未設定なら、何もしない(失敗ではない) */
export async function runRoomJob(ctx: FeatureJobContext): Promise<void> {
  const now = new Date();
  // まとめ直しが失敗しても、今の値の取得は続ける(失敗は最後に報告する)
  let rollupError: unknown = null;
  await rollupOldReadings(ctx.data, now).catch((e: unknown) => {
    rollupError = e;
  });
  const fetched = await fetchReading(ctx.db, ctx.data, ctx.settings, now);
  if (fetched) await checkRoomAlerts(ctx, now);
  if (rollupError) throw rollupError;
}

async function checkRoomAlerts(ctx: FeatureJobContext, now: Date): Promise<void> {
  const [target, afterMinutes, t] = await Promise.all([
    ctx.settings.get("roomAlertTarget"),
    ctx.settings.get("roomAlertAfterMinutes"),
    roomThresholds(ctx.settings),
  ]);
  const metrics = alertMetrics(String(target));
  if (metrics.length === 0) return;
  // 続いている時間を数えるため、通知までの時間より少し長く読む
  const from = new Date(now.getTime() - ((afterMinutes as number) + 60) * MINUTE_MS).toISOString();
  for (const metric of metrics) {
    const rows = await ctx.data.query(ROOM_SOURCE, { kinds: [metric], from });
    const readings = rows.filter((r) => r.value !== null).map((r) => ({ at: Date.parse(r.recordedAt), value: r.value! }));
    const alert = roomAlert(metric, readings, t, afterMinutes as number, now.getTime());
    if (!alert) continue;
    await ctx.notify({
      type: alert.type,
      to: "all",
      dedupeKey: alert.dedupeKey,
      title: alert.title,
      body: alert.body,
      url: `/${ctx.feature.id}/`,
      tag: `${ctx.feature.id}-${alert.type}`,
    });
  }
}

// ---- 古い値のまとめ直しと、1日の最低・最高・平均(2026-11-27 ユーザー決定) ----

/** 5分ごとの値を残す日数。これより古い日は、1日ごとの最低・最高・平均にまとめて、元の値を消す */
export const RAW_RETENTION_DAYS = 30;
/** 1日ごとにまとめた記録の種類(例: "temperature_daily")。value = 平均、payload = { min, max, avg, count } */
export const dailyKind = (metric: Metric) => `${metric}_daily`;


const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * 30日より古い日の細かい値を、1日分ずつまとめ直す(1回の定期実行で1日分。処理を軽く保つため)。
 * まとめた記録を書いてから、元の値を消す。
 */
export async function rollupOldReadings(data: SharedData, now: Date): Promise<string | null> {
  const cutoff = new Date(jstStartOfDay(now).getTime() - RAW_RETENTION_DAYS * DAY_MS);
  const [oldest] = await data.query(ROOM_SOURCE, { kinds: METRICS, to: cutoff.toISOString(), order: "asc", limit: 1 });
  if (!oldest) return null;
  const day = jstDate(new Date(oldest.recordedAt));
  const from = jstDayStart(day);
  const to = new Date(from.getTime() + DAY_MS);
  const stats = await data.aggregate(ROOM_SOURCE, { kinds: METRICS, from: from.toISOString(), to: to.toISOString() });
  const records: DataRecordInput[] = stats
    .filter((a) => a.count > 0 && a.min !== null && a.max !== null && a.avg !== null)
    .map((a) => ({
      id: `daily:${a.kind}:${day}`,
      kind: dailyKind(a.kind as Metric),
      recordedAt: from.toISOString(),
      value: round1(a.avg!),
      unit: UNITS[a.kind as Metric],
      payload: JSON.stringify({ min: a.min, max: a.max, avg: round1(a.avg!), count: a.count }),
    }));
  if (records.length > 0) await data.upsert(ROOM_SOURCE, records);
  await data.purge(ROOM_SOURCE, { kinds: METRICS, from: from.toISOString(), to: to.toISOString() });
  return day;
}

/** ある日(日本時間)の最低・最高・平均。細かい値があればそこから、なければ1日ごとのまとめから読む */
export async function roomDayStats(data: SharedData, day: string, until?: Date): Promise<RoomDayStats | null> {
  const from = jstDayStart(day);
  const to = until ?? new Date(from.getTime() + DAY_MS);
  const raw = await data.aggregate(ROOM_SOURCE, { kinds: METRICS, from: from.toISOString(), to: to.toISOString() });
  const result: RoomDayStats = { temperature: null, humidity: null };
  for (const a of raw) {
    if (a.count > 0 && a.min !== null && a.max !== null && a.avg !== null) {
      result[a.kind as Metric] = { min: a.min, max: a.max, avg: round1(a.avg) };
    }
  }
  if (!result.temperature && !result.humidity) {
    const daily = await data.query(ROOM_SOURCE, {
      kinds: METRICS.map(dailyKind),
      from: from.toISOString(),
      to: new Date(from.getTime() + 1).toISOString(),
    });
    for (const r of daily) {
      try {
        const p = JSON.parse(r.payload ?? "{}") as Partial<MetricDayStats>;
        if (typeof p.min === "number" && typeof p.max === "number" && typeof p.avg === "number") {
          result[r.kind.replace(/_daily$/, "") as Metric] = { min: p.min, max: p.max, avg: p.avg };
        }
      } catch {
        // 読めなければ、その種類は無しにする
      }
    }
  }
  return result.temperature || result.humidity ? result : null;
}

/** 画面に出すまとめ(データの管理の画面の「室温・湿度」) */
export async function buildRoomSummary(db: D1Database, data: SharedData, settings: FeatureSettings, now: Date): Promise<RoomSummary> {
  const [creds, state, t, rows] = await Promise.all([
    credentials(settings),
    readState(db),
    roomThresholds(settings),
    data.query(ROOM_SOURCE, { from: new Date(now.getTime() - DAY_MS).toISOString(), order: "desc", limit: 20 }),
  ]);
  const latest = (metric: Metric) => rows.find((r) => r.kind === metric && r.value !== null);
  const temp = latest("temperature");
  const hum = latest("humidity");
  const reading =
    temp && hum
      ? { at: temp.recordedAt > hum.recordedAt ? temp.recordedAt : hum.recordedAt, temperature: temp.value!, humidity: hum.value! }
      : null;
  const warnings = reading
    ? [evaluate("temperature", reading.temperature, t), evaluate("humidity", reading.humidity, t)].filter((w) => w !== null)
    : [];

  return {
    configured: creds !== null,
    device: state.device ? { name: state.device.name, type: state.device.type } : null,
    reading,
    warnings,
    thresholds: t,
    sync: { lastSuccessAt: state.lastSuccessAt ?? null, lastAttemptAt: state.lastAttemptAt ?? null, lastError: state.lastError ?? null },
  };
}

/** 温湿度計の確認(SwitchBot に登録されている機器の一覧。ID は画面に出さない) */
export async function checkDevices(settings: FeatureSettings, fetcher?: typeof fetch): Promise<DeviceCheck> {
  const creds = await credentials(settings);
  if (!creds) throw new SwitchBotError("トークンとクライアントシークレットが未設定です", "auth");
  const devices = await listDevices(creds, fetcher);
  return {
    devices: devices.map((d) => ({
      name: d.deviceName,
      type: d.deviceType,
      isMeter: isMeterType(d.deviceType),
      cloud: d.enableCloudService ?? null,
      viaHub: viaHub(d),
      isHub: isHubType(d.deviceType),
    })),
  };
}
