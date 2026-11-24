/**
 * 通知の許可と宛先の登録(スーパーアプリ全体で1回だけ行う)。
 * iPhone では、ホーム画面に追加したアプリの中で、ボタンを押したときにしか許可を求められない。
 */
import { apiJson, postJson } from "./api";
import { deviceLabel } from "./device";

export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function registerServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch (error) {
    console.error("Service Worker を登録できませんでした", error);
  }
}

function base64UrlToUint8Array(text: string): Uint8Array<ArrayBuffer> {
  const normalized = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - (normalized.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/** 事前に読み込んでおく公開鍵(ボタンを押してからの待ち時間を減らすため) */
export function loadPublicKey(): Promise<string> {
  return apiJson<{ publicKey: string }>("/api/core/push/public-key").then((r) => r.publicKey);
}

/**
 * 通知を有効にする。必ずボタンを押した処理の中から呼ぶ。
 * 最初の待ち(await)で許可を求める。ほかの処理を先に待つと、iPhone が許可の画面を出さないことがあるため。
 */
export async function enablePush(publicKey: string): Promise<string> {
  if (!pushSupported()) {
    return "この開き方では通知を使えません。iPhone では、Safari の共有ボタンから「ホーム画面に追加」して、そのアイコンから開いてください。";
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return "通知が許可されませんでした。iPhone の「設定」→「通知」から、このアプリの通知を許可してください。";
  }
  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(publicKey),
    }));
  const json = subscription.toJSON();
  await postJson("/api/core/push/subscribe", {
    endpoint: json.endpoint,
    keys: json.keys,
    deviceLabel: deviceLabel(),
  });
  return "この端末で通知を受け取れるようにしました。";
}

export async function disablePush(): Promise<string> {
  const subscription = await currentSubscription();
  if (!subscription) return "この端末は登録されていません。";
  await postJson("/api/core/push/unsubscribe", { endpoint: subscription.endpoint });
  await subscription.unsubscribe();
  return "この端末の登録を解除しました。";
}
