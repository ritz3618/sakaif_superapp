/** 育児ログの室温・湿度(SwitchBot)。トークンなどは架空の値。 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { alertMetrics, roomAlert } from "../src/features/piyolog/server/room-alerts";
import { rollupOldReadings, roomDayStats, toRecords } from "../src/features/piyolog/server/room";
import { isHubType, isMeterType, listDevices, meterStatus, sign, SwitchBotError, viaHub } from "../src/features/piyolog/server/switchbot";
import type { Thresholds } from "../src/features/piyolog/shared/room-api";
import { evaluate, warningText } from "../src/features/piyolog/shared/room-thresholds";

const CREDS = { token: "example-token", secret: "example-secret" };
const T: Thresholds = { temperatureLow: 20, temperatureHigh: 26, humidityLow: 40, humidityHigh: null };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("SwitchBot API", () => {
  it("署名は base64(HMAC-SHA256(シークレット, トークン + t + nonce))(公式の例と同じ作り方)", async () => {
    const expected = createHmac("sha256", CREDS.secret).update(`${CREDS.token}1700000000000nonce-1`).digest("base64");
    expect(await sign(CREDS, "1700000000000", "nonce-1")).toBe(expected);
  });

  it("ヘッダーに認証の値を付け、機器の一覧を読む", async () => {
    let headers: Headers | null = null;
    const fetcher = (async (_url: string, init?: RequestInit) => {
      headers = new Headers(init?.headers);
      return json(200, {
        statusCode: 100,
        message: "success",
        body: {
          deviceList: [
            { deviceId: "AAA", deviceName: "寝室", deviceType: "Meter", enableCloudService: true, hubDeviceId: "HUB1" },
            { deviceId: "BBB", deviceName: "カーテン", deviceType: "Curtain", hubDeviceId: "000000000000" },
          ],
        },
      });
    }) as typeof fetch;
    const devices = await listDevices(CREDS, fetcher);
    expect(devices.map((d) => d.deviceName)).toEqual(["寝室", "カーテン"]);
    expect(headers!.get("Authorization")).toBe("example-token");
    expect(headers!.get("t")).toMatch(/^\d{13}$/);
    expect(headers!.get("sign")).toBeTruthy();
    expect(headers!.get("nonce")).toBeTruthy();
    expect(viaHub(devices[0]!)).toBe(true);
    expect(viaHub(devices[1]!)).toBe(false);
  });

  it("温湿度計の種類を見分ける", () => {
    expect(["Meter", "MeterPlus", "MeterPro", "MeterPro(CO2)", "WoIOSensor", "Hub 2"].every(isMeterType)).toBe(true);
    expect(["Curtain", "Bot", "Hub Mini"].some(isMeterType)).toBe(false);
    expect(isHubType("Hub 2")).toBe(true);
    expect(isHubType("Meter")).toBe(false);
  });

  it("エラーはわかる文にし、トークンを含めない", async () => {
    const unauthorized = (async () => json(401, { message: "Unauthorized" })) as unknown as typeof fetch;
    const error = await listDevices(CREDS, unauthorized).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SwitchBotError);
    expect((error as SwitchBotError).kind).toBe("auth");
    expect(String((error as Error).message)).not.toContain("example");
    const offline = (async () => json(200, { statusCode: 171, message: "hub offline", body: {} })) as unknown as typeof fetch;
    expect(((await meterStatus(CREDS, "AAA", offline).catch((e: unknown) => e)) as SwitchBotError).kind).toBe("offline");
  });

  it("温湿度計の値を読む", async () => {
    const fetcher = (async () =>
      json(200, { statusCode: 100, body: { deviceId: "AAA", deviceType: "Meter", temperature: 22.4, humidity: 48, battery: 90 } })) as unknown as typeof fetch;
    expect(await meterStatus(CREDS, "AAA", fetcher)).toEqual({ temperature: 22.4, humidity: 48, battery: 90 });
  });
});

describe("基準と通知", () => {
  const at = (min: number) => Date.parse("2026-11-26T03:00:00Z") + min * 60_000;

  it("下限・上限との比較と、注意の文", () => {
    expect(evaluate("temperature", 18.5, T)).toEqual({ metric: "temperature", direction: "low", value: 18.5, threshold: 20 });
    expect(evaluate("temperature", 27, T)?.direction).toBe("high");
    expect(evaluate("humidity", 80, T)).toBeNull(); // 上限は未設定
    expect(warningText(evaluate("temperature", 18.5, T)!)).toBe("室温が18.5℃で、基準(20℃以上)を下回っています");
  });

  it("「すぐ」なら、基準の外になった最初の値で通知する", () => {
    const alert = roomAlert("temperature", [{ at: at(0), value: 21 }, { at: at(5), value: 19.5 }], T, 0, at(6));
    expect(alert?.title).toBe("室温が低くなっています");
    expect(alert?.type).toBe("room_temperature_out");
    expect(alert?.dedupeKey).toBe(`room:temperature:low:${new Date(at(5)).toISOString()}`);
  });

  it("「30分続いたら」は、続いた時間が足りなければ通知しない。同じ状態の間は同じキー(1回だけ)", () => {
    const readings = [0, 5, 10, 15, 20, 25, 30, 35].map((m, i) => ({ at: at(m), value: i === 0 ? 21 : 19 }));
    expect(roomAlert("temperature", readings.slice(0, 7), T, 30, at(30))).toBeNull(); // 5分〜30分: 25分
    const a = roomAlert("temperature", readings, T, 30, at(35));
    expect(a?.body).toContain("30分続いています");
    const b = roomAlert("temperature", [...readings, { at: at(40), value: 19 }], T, 30, at(40));
    expect(b?.dedupeKey).toBe(a?.dedupeKey);
  });

  it("古い値では通知しない。通知の対象の設定", () => {
    expect(roomAlert("humidity", [{ at: at(0), value: 30 }], T, 0, at(30))).toBeNull();
    expect(alertMetrics("off")).toEqual([]);
    expect(alertMetrics("both")).toEqual(["temperature", "humidity"]);
  });

  it("保存する記録は、室温と湿度の2件。基準との比較の結果を payload に入れる", () => {
    const records = toRecords({ id: "AAA", name: "寝室" }, new Date("2026-11-26T03:00:42Z"), { temperature: 19, humidity: 45 }, T);
    expect(records.map((r) => [r.id, r.kind, r.value, r.unit])).toEqual([
      ["AAA:temperature:2026-11-26T03:00:00.000Z", "temperature", 19, "celsius"],
      ["AAA:humidity:2026-11-26T03:00:00.000Z", "humidity", 45, "percent"],
    ]);
    expect(JSON.parse(records[0]!.payload!)).toEqual({ deviceName: "寝室", warning: { direction: "low", threshold: 20 } });
    expect(JSON.parse(records[1]!.payload!).warning).toBeNull();
  });
});

describe("古い室温・湿度のまとめ直し", () => {
  type Row = { source: string; id: string; kind: string; recordedAt: string; value: number | null; payload: string | null };
  function fake(rows: Row[]) {
    const inRange = (r: Row, q: { kinds?: readonly string[]; from?: string; to?: string }) =>
      (!q.kinds || q.kinds.includes(r.kind)) && (!q.from || r.recordedAt >= q.from) && (!q.to || r.recordedAt < q.to);
    return {
      rows,
      async query(_s: string, q: { kinds?: readonly string[]; from?: string; to?: string; order?: string; limit?: number } = {}) {
        const out = rows.filter((r) => inRange(r, q)).sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
        if (q.order === "desc") out.reverse();
        return (q.limit ? out.slice(0, q.limit) : out).map((r) => ({ ...r, unit: null, note: null, firstSeenAt: "", updatedAt: "", deletedAt: null }));
      },
      async aggregate(_s: string, q: { kinds?: readonly string[]; from?: string; to?: string }) {
        const groups = new Map<string, number[]>();
        for (const r of rows.filter((x) => inRange(x, q) && x.value !== null)) groups.set(r.kind, [...(groups.get(r.kind) ?? []), r.value!]);
        return [...groups].map(([kind, v]) => ({ kind, count: v.length, min: Math.min(...v), max: Math.max(...v), avg: v.reduce((a, b) => a + b, 0) / v.length }));
      },
      async upsert(_s: string, input: { id: string; kind: string; recordedAt: string; value?: number | null; payload?: string | null }[]) {
        for (const r of input) rows.push({ source: "switchbot", id: r.id, kind: r.kind, recordedAt: r.recordedAt, value: r.value ?? null, payload: r.payload ?? null });
        return { written: input.length };
      },
      async purge(_s: string, q: { kinds?: readonly string[]; from: string; to: string }) {
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i--) if (inRange(rows[i]!, q)) rows.splice(i, 1);
        return { deleted: before - rows.length };
      },
    };
  }
  const raw = (kind: string, jst: string, value: number): Row => {
    const at = new Date(`${jst}+09:00`).toISOString();
    return { source: "switchbot", id: `D:${kind}:${at}`, kind, recordedAt: at, value, payload: null };
  };

  it("30日より古い日を、1日ごとの最低・最高・平均にまとめて、元の値を消す(1回に1日分)", async () => {
    const data = fake([
      raw("temperature", "2026-10-01T08:00:00", 18),
      raw("temperature", "2026-10-01T14:00:00", 22),
      raw("humidity", "2026-10-01T08:00:00", 40),
      raw("temperature", "2026-10-02T08:00:00", 20),
      raw("temperature", "2026-11-20T08:00:00", 21), // 30日以内は残す
    ]);
    const now = new Date("2026-11-27T12:00:00+09:00");
    expect(await rollupOldReadings(data as never, now)).toBe("2026-10-01");
    const daily = data.rows.filter((r) => r.kind.endsWith("_daily"));
    expect(daily.map((r) => [r.id, r.value, JSON.parse(r.payload!)])).toEqual([
      ["daily:temperature:2026-10-01", 20, { min: 18, max: 22, avg: 20, count: 2 }],
      ["daily:humidity:2026-10-01", 40, { min: 40, max: 40, avg: 40, count: 1 }],
    ]);
    expect(data.rows.filter((r) => !r.kind.endsWith("_daily")).map((r) => r.kind)).toEqual(["temperature", "temperature"]);
    expect(data.rows.some((r) => r.kind === "temperature" && r.recordedAt.startsWith("2026-09-30T2"))).toBe(false); // 10/1 の分(UTC では前日の夜)は消えた
    expect(await rollupOldReadings(data as never, now)).toBe("2026-10-02");
    expect(await rollupOldReadings(data as never, now)).toBeNull();
    expect(data.rows.filter((r) => r.kind === "temperature")).toHaveLength(1);
  });

  it("その日の最低・最高・平均は、細かい値が無ければ1日ごとのまとめから読む", async () => {
    const data = fake([raw("temperature", "2026-11-26T08:00:00", 19), raw("temperature", "2026-11-26T20:00:00", 23)]);
    expect(await roomDayStats(data as never, "2026-11-26")).toEqual({ temperature: { min: 19, max: 23, avg: 21 }, humidity: null });
    await rollupOldReadings(data as never, new Date("2027-01-10T00:00:00+09:00"));
    expect(await roomDayStats(data as never, "2026-11-26")).toEqual({ temperature: { min: 19, max: 23, avg: 21 }, humidity: null });
    expect(await roomDayStats(data as never, "2026-11-25")).toBeNull();
  });
});
