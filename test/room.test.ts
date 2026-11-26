/** 室温・湿度(SwitchBot)。トークンなどは架空の値。 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { alertMetrics, roomAlert } from "../src/features/room/server/alerts";
import { toRecords } from "../src/features/room/server/service";
import { isMeterType, listDevices, meterStatus, sign, SwitchBotError, viaHub } from "../src/features/room/server/switchbot";
import type { Thresholds } from "../src/features/room/shared/api";
import { evaluate, warningText } from "../src/features/room/shared/thresholds";

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
