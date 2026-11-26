/**
 * SwitchBot API v1.1 の呼び出し(公式: github.com/OpenWonderLabs/SwitchBotAPI の README で確認、2026-11-26)。
 * - 認証: ヘッダー Authorization = トークン、t = 13桁の時刻(ミリ秒)、nonce = 任意の文字、
 *   sign = base64(HMAC-SHA256(キー = クライアントシークレット, 文 = トークン + t + nonce))。
 * - 応答は { statusCode, message, body }。statusCode 100 が成功。トークンの誤りは HTTP 401。
 * - 1日の呼び出しは 10,000 回まで(5分おきなら 1日 約300回)。
 * - トークンとシークレットは、エラーの文やログに含めない。
 */
import { bytesToBase64 } from "../../../core/server/feature-api";

const BASE = "https://api.switch-bot.com/v1.1";

export interface Credentials {
  token: string;
  secret: string;
}

export interface SwitchBotDevice {
  deviceId: string;
  deviceName: string;
  deviceType: string;
  enableCloudService?: boolean;
  hubDeviceId?: string;
}

export interface MeterStatus {
  temperature: number;
  humidity: number;
  battery: number | null;
}

export type SwitchBotErrorKind = "auth" | "offline" | "not_found" | "not_meter" | "network" | "server" | "format";

export class SwitchBotError extends Error {
  constructor(
    message: string,
    readonly kind: SwitchBotErrorKind,
  ) {
    super(message);
    this.name = "SwitchBotError";
  }
}

/** 署名を作る(テストで確認している) */
export async function sign(credentials: Credentials, t: string, nonce: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(credentials.secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(credentials.token + t + nonce));
  return bytesToBase64(new Uint8Array(mac));
}

/** 温湿度計として読める種類(公式の機器の一覧の名前から) */
export function isMeterType(type: string): boolean {
  return /meter|woiosensor|hub 2|hub 3/i.test(type);
}

/** ハブ本体か */
export function isHubType(type: string): boolean {
  return /^hub/i.test(type);
}

/** ハブを通っているか("000000000000" や空はハブなし) */
export function viaHub(device: SwitchBotDevice): boolean {
  return !!device.hubDeviceId && !/^0+$/.test(device.hubDeviceId);
}

async function call<T>(credentials: Credentials, path: string, fetcher: typeof fetch): Promise<T> {
  const t = String(Date.now());
  const nonce = crypto.randomUUID();
  let response: Response;
  try {
    response = await fetcher(`${BASE}${path}`, {
      headers: {
        Authorization: credentials.token,
        t,
        nonce,
        sign: await sign(credentials, t, nonce),
        "Content-Type": "application/json; charset=utf8",
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new SwitchBotError("SwitchBot に接続できませんでした", "network");
  }
  if (response.status === 401 || response.status === 403) {
    throw new SwitchBotError("SwitchBot の認証に失敗しました(トークンかクライアントシークレットが違う可能性があります)", "auth");
  }
  if (response.status === 429) throw new SwitchBotError("SwitchBot の呼び出し回数の上限に達しました", "server");
  if (!response.ok) throw new SwitchBotError(`SwitchBot でエラーが起きました(${response.status})`, "server");
  let json: { statusCode?: unknown; message?: unknown; body?: unknown };
  try {
    json = (await response.json()) as typeof json;
  } catch {
    throw new SwitchBotError("SwitchBot の応答を読めませんでした", "format");
  }
  switch (json.statusCode) {
    case 100:
      return json.body as T;
    case 152:
      throw new SwitchBotError("温湿度計が見つかりません(152)", "not_found");
    case 161:
      throw new SwitchBotError("温湿度計がオフラインです(161)", "offline");
    case 171:
      throw new SwitchBotError("ハブがオフラインです(171)", "offline");
    default:
      throw new SwitchBotError(`SwitchBot でエラーが起きました(${String(json.statusCode)})`, "server");
  }
}

export async function listDevices(credentials: Credentials, fetcher: typeof fetch = fetch): Promise<SwitchBotDevice[]> {
  const body = await call<{ deviceList?: unknown }>(credentials, "/devices", fetcher);
  if (!body || !Array.isArray(body.deviceList)) throw new SwitchBotError("SwitchBot の機器の一覧を読めませんでした", "format");
  return (body.deviceList as Partial<SwitchBotDevice>[])
    .filter((d) => typeof d.deviceId === "string" && typeof d.deviceType === "string")
    .map((d) => ({
      deviceId: d.deviceId!,
      deviceName: typeof d.deviceName === "string" ? d.deviceName : d.deviceId!,
      deviceType: d.deviceType!,
      enableCloudService: typeof d.enableCloudService === "boolean" ? d.enableCloudService : undefined,
      hubDeviceId: typeof d.hubDeviceId === "string" ? d.hubDeviceId : undefined,
    }));
}

export async function meterStatus(credentials: Credentials, deviceId: string, fetcher: typeof fetch = fetch): Promise<MeterStatus> {
  const body = await call<{ temperature?: unknown; humidity?: unknown; battery?: unknown }>(
    credentials,
    `/devices/${encodeURIComponent(deviceId)}/status`,
    fetcher,
  );
  if (typeof body?.temperature !== "number" || typeof body?.humidity !== "number") {
    throw new SwitchBotError("この機器からは室温と湿度を読めませんでした", "not_meter");
  }
  return { temperature: body.temperature, humidity: body.humidity, battery: typeof body.battery === "number" ? body.battery : null };
}
