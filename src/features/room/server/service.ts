/**
 * 取得、通知、画面用のまとめ。
 * 値は共通データ(source = "switchbot")に置き、使っている温湿度計と取得の状態だけを、この機能のテーブル(room_state)に置く。
 */
import type { DataRecordInput, FeatureJobContext, FeatureSettings, SharedData } from "../../../core/server/feature-api";
import { DAY_MS, MINUTE_MS } from "../../../core/shared/time";
import type { DeviceCheck, Metric, RoomSummary, Thresholds } from "../shared/api";
import { evaluate } from "../shared/thresholds";
import { alertMetrics, roomAlert } from "./alerts";
import { readState, writeState, type RoomState } from "./repo";
import { isMeterType, listDevices, meterStatus, SwitchBotError, viaHub, type Credentials } from "./switchbot";

export const SWITCHBOT_SOURCE = "switchbot";
const METRICS: readonly Metric[] = ["temperature", "humidity"];
const UNITS: Record<Metric, string> = { temperature: "celsius", humidity: "percent" };

export async function credentials(settings: FeatureSettings): Promise<Credentials | null> {
  const [token, secret] = await Promise.all([settings.get("token"), settings.get("clientSecret")]);
  return typeof token === "string" && token && typeof secret === "string" && secret ? { token, secret } : null;
}

export async function thresholds(settings: FeatureSettings): Promise<Thresholds> {
  const [tl, th, hl, hh] = await Promise.all([
    settings.get("temperatureLow"),
    settings.get("temperatureHigh"),
    settings.get("humidityLow"),
    settings.get("humidityHigh"),
  ]);
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  return { temperatureLow: num(tl), temperatureHigh: num(th), humidityLow: num(hl), humidityHigh: num(hh) };
}

/** 使う温湿度計を決める(名前の指定があればその名前、なければ最初の温湿度計) */
async function chooseDevice(creds: Credentials, wanted: string, fetcher?: typeof fetch): Promise<NonNullable<RoomState["device"]>> {
  const meters = (await listDevices(creds, fetcher)).filter((d) => isMeterType(d.deviceType));
  const device = wanted ? meters.find((d) => d.deviceName === wanted) : meters[0];
  if (!device) {
    throw new SwitchBotError(
      wanted ? `「${wanted}」という温湿度計が見つかりません` : "SwitchBot に温湿度計が見つかりません",
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
    const wanted = String((await settings.get("deviceName")) ?? "").trim();
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
    await data.upsert(SWITCHBOT_SOURCE, toRecords(device, now, status, await thresholds(settings)));
    await writeState(db, { device, lastSuccessAt: at, lastAttemptAt: at, lastError: null });
    return true;
  } catch (error) {
    const message = error instanceof SwitchBotError ? error.message : "室温・湿度の保存中にエラーが起きました";
    await writeState(db, { ...state, lastAttemptAt: at, lastError: message });
    throw error instanceof SwitchBotError ? error : new Error(message);
  }
}

/** 5分おきの定期実行。トークンが未設定なら、何もしない(失敗ではない) */
export async function runScheduledJob(ctx: FeatureJobContext): Promise<void> {
  const now = new Date();
  const fetched = await fetchReading(ctx.db, ctx.data, ctx.settings, now);
  if (!fetched) return;
  const [target, afterMinutes, t] = await Promise.all([
    ctx.settings.get("alertTarget"),
    ctx.settings.get("alertAfterMinutes"),
    thresholds(ctx.settings),
  ]);
  const metrics = alertMetrics(String(target));
  if (metrics.length === 0) return;
  // 続いている時間を数えるため、通知までの時間より少し長く読む
  const from = new Date(now.getTime() - ((afterMinutes as number) + 60) * MINUTE_MS).toISOString();
  for (const metric of metrics) {
    const rows = await ctx.data.query(SWITCHBOT_SOURCE, { kinds: [metric], from });
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

/** 画面に出すまとめ */
export async function buildSummary(db: D1Database, data: SharedData, settings: FeatureSettings, now: Date): Promise<RoomSummary> {
  const [creds, state, t, rows] = await Promise.all([
    credentials(settings),
    readState(db),
    thresholds(settings),
    data.query(SWITCHBOT_SOURCE, { from: new Date(now.getTime() - DAY_MS).toISOString(), order: "desc", limit: 20 }),
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
    })),
  };
}
