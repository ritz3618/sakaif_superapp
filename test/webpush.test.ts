import { decodeProtectedHeader, importJWK, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import { base64UrlToBytes, bytesToBase64Url, concatBytes, utf8 } from "../src/core/server/encoding";
import { createVapidJwt, encryptPayload, generateVapidKeys } from "../src/core/server/push/webpush";

// RFC 8291 付録A の例(https://www.rfc-editor.org/rfc/rfc8291#appendix-A)
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  authSecret: "BTBZMqHH6r4Tts7J_aSIgg",
  body:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

function ecJwk(publicRaw: string, privateD?: string): JsonWebKey {
  const raw = base64UrlToBytes(publicRaw);
  return {
    kty: "EC",
    crv: "P-256",
    x: bytesToBase64Url(raw.slice(1, 33)),
    y: bytesToBase64Url(raw.slice(33, 65)),
    ...(privateD ? { d: privateD } : {}),
  };
}

async function importEcdhPair(publicRaw: string, privateD: string): Promise<CryptoKeyPair> {
  const privateKey = await crypto.subtle.importKey("jwk", ecJwk(publicRaw, privateD), { name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const publicKey = await crypto.subtle.importKey("raw", base64UrlToBytes(publicRaw), { name: "ECDH", namedCurve: "P-256" }, true, []);
  return { privateKey, publicKey };
}

async function hkdf(ikm: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, length: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}

/** 受信側(端末)の立場で復号する(テスト専用) */
async function decrypt(body: Uint8Array<ArrayBuffer>, uaPublic: string, uaPrivate: string, authSecret: string): Promise<string> {
  const salt = body.slice(0, 16);
  const idLength = body[20]!;
  const senderPublic = body.slice(21, 21 + idLength);
  const ciphertext = body.slice(21 + idLength);
  const receiver = await importEcdhPair(uaPublic, uaPrivate);
  const senderKey = await crypto.subtle.importKey("raw", senderPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: senderKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, receiver.privateKey, 256),
  );
  const ikm = await hkdf(
    shared,
    base64UrlToBytes(authSecret),
    concatBytes(utf8("WebPush: info"), new Uint8Array([0]), base64UrlToBytes(uaPublic), senderPublic),
    32,
  );
  const cek = await hkdf(ikm, salt, concatBytes(utf8("Content-Encoding: aes128gcm"), new Uint8Array([0])), 16);
  const nonce = await hkdf(ikm, salt, concatBytes(utf8("Content-Encoding: nonce"), new Uint8Array([0])), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ciphertext));
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end--;
  expect(padded[end]).toBe(2);
  return new TextDecoder().decode(padded.slice(0, end));
}

describe("Web Push の暗号化(RFC 8291)", () => {
  it("RFC 8291 付録A の例と同じ結果になる", async () => {
    const body = await encryptPayload(
      utf8(RFC.plaintext),
      { p256dh: RFC.uaPublic, auth: RFC.authSecret },
      { senderKeyPair: await importEcdhPair(RFC.asPublic, RFC.asPrivate), salt: base64UrlToBytes(RFC.salt) },
    );
    expect(bytesToBase64Url(body)).toBe(RFC.body);
  });

  it("毎回ちがう鍵で暗号化しても、受信側で元の文に戻せる", async () => {
    const text = JSON.stringify({ title: "授乳から3時間たちました", body: "前回は120ml", url: "/piyolog/" });
    const body = await encryptPayload(utf8(text), { p256dh: RFC.uaPublic, auth: RFC.authSecret });
    expect(await decrypt(body, RFC.uaPublic, RFC.uaPrivate, RFC.authSecret)).toBe(text);
  });
});

describe("VAPID(RFC 8292)", () => {
  it("作ったトークンが、公開鍵で検証できる", async () => {
    const keys = await generateVapidKeys();
    const expires = new Date(Date.now() + 60 * 60 * 1000);
    const jwt = await createVapidJwt(keys.privateJwk, "https://web.push.apple.com", "https://sabu6.example.workers.dev", expires);

    expect(decodeProtectedHeader(jwt)).toEqual({ typ: "JWT", alg: "ES256" });
    const publicKey = await importJWK(ecJwk(keys.publicKey), "ES256");
    const { payload } = await jwtVerify(jwt, publicKey, { audience: "https://web.push.apple.com" });
    expect(payload.sub).toBe("https://sabu6.example.workers.dev");
    expect(payload.exp).toBe(Math.floor(expires.getTime() / 1000));
    expect(base64UrlToBytes(keys.publicKey)).toHaveLength(65);
  });
});
