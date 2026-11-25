/** この端末と、開き方(ホーム画面から/ブラウザから)の判定。 */
import { BROWSER_CONTEXT } from "../shared/push-policy";

const LAUNCH_KEY = "sabu6.launch";

/**
 * ホーム画面のアイコンから起動したときに付く ?launch=<対象> を覚えて、URL からは消す。
 * iPhone ではアイコンごとに保存領域が分かれているので、localStorage に残せば
 * 通知のタップなど ?launch= が付かない起動でも、どのアイコンのアプリかが分かる。
 */
export function captureLaunchSource(): void {
  const url = new URL(window.location.href);
  const launch = url.searchParams.get("launch");
  if (!launch) return;
  if (isStandalone()) {
    for (const storage of [localStorage, sessionStorage]) {
      try {
        storage.setItem(LAUNCH_KEY, launch);
      } catch {
        // 保存できない環境では、記録しないだけ
      }
    }
  }
  url.searchParams.delete("launch");
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
}

/** どのアイコンのアプリとして動いているか("app"、"piyolog" など)。ブラウザや不明のときは null。 */
export function launchSource(): string | null {
  if (!isStandalone()) return null;
  for (const storage of [localStorage, sessionStorage]) {
    try {
      const value = storage.getItem(LAUNCH_KEY);
      if (value) return value;
    } catch {
      // 読めない環境では次を試す
    }
  }
  return null;
}

/** 通知の登録に使う開き方。ブラウザは "browser"、アイコンから開いて記録が無いときは "unknown"。 */
export function appContext(): string {
  if (!isStandalone()) return BROWSER_CONTEXT;
  return launchSource() ?? "unknown";
}

export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
}

export function iosVersion(): string | null {
  const match = /OS (\d+)_(\d+)(?:_(\d+))? like Mac OS X/.exec(navigator.userAgent);
  return match ? [match[1], match[2], match[3]].filter(Boolean).join(".") : null;
}

export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const kind = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : "PC";
  return isStandalone() ? `${kind}(ホーム画面)` : `${kind}(ブラウザ)`;
}
