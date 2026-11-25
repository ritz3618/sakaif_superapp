/**
 * Web Push の暗号化(RFC 8291、aes128gcm)と、送信元の証明(RFC 8292、VAPID)。
 * 外部ライブラリを使わず、Workers 標準の WebCrypto だけで実装する。
 * テストでは RFC 8291 付録Aの例と同じ結果になることを確かめている。
 */
import { base64UrlToBytes, bytesToBase64Url, concatBytes, utf8 } from "../encoding";

export interface PushSubscriptionKeys {
  endpoint: string;
  /** 受信側の公開鍵(base64url、65バイトの非圧縮形式) */
  p256dh: string;
  /** 受信側の認証用の値(base64url、16バイト) */
  auth: string;
}

export interface VapidKeys {
  /** 公開鍵(base64url、65バイト)。端末の登録時に applicationServerKey として渡す。 */
  publicKey: string;
  /** 秘密鍵(JWK)。D1 に保存し、コードやチャットには出さない。 */
  privateJwk: JsonWebKey;
}

/** テストで固定値を使うための差し込み口。本番では使わない。 */
export interface EncryptOverrides {
  senderKeyPair?: CryptoKeyPair;
  salt?: Uint8Array<ArrayBuffer>;
}

const RECORD_SIZE = 4096;

async function hkdf(
  ikm: Uint8Array<ArrayBuffer>,
  salt: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  lengthBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, lengthBytes * 8);
  return new Uint8Array(bits);
}

/** 通知の本文を、受信側の鍵で暗号化する(戻り値がそのまま HTTP の本文になる)。 */
export async function encryptPayload(
  plaintext: Uint8Array<ArrayBuffer>,
  subscription: Pick<PushSubscriptionKeys, "p256dh" | "auth">,
  overrides: EncryptOverrides = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const receiverPublic = base64UrlToBytes(subscription.p256dh);
  const authSecret = base64UrlToBytes(subscription.auth);

  const senderKeys =
    overrides.senderKeyPair ??
    ((await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair);
  const senderPublic = new Uint8Array((await crypto.subtle.exportKey("raw", senderKeys.publicKey)) as ArrayBuffer);

  const receiverKey = await crypto.subtle.importKey(
    "raw",
    receiverPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  // 標準の WebCrypto では "public"。Workers の型定義では "$public" と書かれているため、型だけ合わせる。
  const ecdhParams = { name: "ECDH", public: receiverKey } as unknown as SubtleCryptoDeriveKeyAlgorithm;
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(ecdhParams, senderKeys.privateKey, 256));

  // RFC 8291 3.4: IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" || 0x00 || ua_public || as_public, 32)
  const keyInfo = concatBytes(utf8("WebPush: info"), new Uint8Array([0]), receiverPublic, senderPublic);
  const ikm = await hkdf(sharedSecret, authSecret, keyInfo, 32);

  // RFC 8188: CEK と NONCE
  const salt = overrides.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(ikm, salt, concatBytes(utf8("Content-Encoding: aes128gcm"), new Uint8Array([0])), 16);
  const nonce = await hkdf(ikm, salt, concatBytes(utf8("Content-Encoding: nonce"), new Uint8Array([0])), 12);

  // 1レコードだけ送る。末尾の区切り 0x02 を付ける。
  const padded = concatBytes(plaintext, new Uint8Array([2]));
  if (padded.length + 16 > RECORD_SIZE) throw new Error("通知の本文が大きすぎます");
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, padded));

  const header = new Uint8Array(16 + 4 + 1);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = senderPublic.length;
  return concatBytes(header, senderPublic, ciphertext);
}

/** VAPID 用の鍵の組を新しく作る。 */
export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const publicRaw = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  const privateJwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  return { publicKey: bytesToBase64Url(publicRaw), privateJwk };
}

/** VAPID の署名付きトークン(JWT)を作る。 */
export async function createVapidJwt(
  privateJwk: JsonWebKey,
  audience: string,
  subject: string,
  expiresAt: Date,
): Promise<string> {
  const header = bytesToBase64Url(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = bytesToBase64Url(
    utf8(JSON.stringify({ aud: audience, exp: Math.floor(expiresAt.getTime() / 1000), sub: subject })),
  );
  const signingInput = `${header}.${claims}`;
  const key = await crypto.subtle.importKey("jwk", privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
  ]);
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, utf8(signingInput)),
  );
  return `${signingInput}.${bytesToBase64Url(signature)}`;
}

export interface PushRequest {
  url: string;
  headers: Record<string, string>;
  body: Uint8Array<ArrayBuffer>;
}

/** 送信用の HTTP リクエストを組み立てる。 */
export async function buildPushRequest(options: {
  subscription: PushSubscriptionKeys;
  payload: string;
  vapidPublicKey: string;
  vapidJwt: string;
  ttlSeconds: number;
  urgency?: "very-low" | "low" | "normal" | "high";
  topic?: string;
}): Promise<PushRequest> {
  const body = await encryptPayload(utf8(options.payload), options.subscription);
  const headers: Record<string, string> = {
    "Content-Type": "application/octet-stream",
    "Content-Encoding": "aes128gcm",
    TTL: String(options.ttlSeconds),
    Urgency: options.urgency ?? "normal",
    Authorization: `vapid t=${options.vapidJwt}, k=${options.vapidPublicKey}`,
  };
  if (options.topic) headers.Topic = options.topic;
  return { url: options.subscription.endpoint, headers, body };
}
