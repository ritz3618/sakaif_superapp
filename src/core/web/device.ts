/** この端末と、開き方(ホーム画面から/ブラウザから)の判定。 */

const LAUNCH_KEY = "superapp.launch";

/** ホーム画面のアイコンから起動したときに付く ?launch=<対象> を覚えて、URL からは消す。 */
export function captureLaunchSource(): void {
  const url = new URL(window.location.href);
  const launch = url.searchParams.get("launch");
  if (!launch) return;
  try {
    sessionStorage.setItem(LAUNCH_KEY, launch);
  } catch {
    // 保存できない環境では、記録しないだけ
  }
  url.searchParams.delete("launch");
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
}

/** どのアイコンから起動したか("app"、"piyolog" など)。ブラウザで開いたときは null。 */
export function launchSource(): string | null {
  try {
    return sessionStorage.getItem(LAUNCH_KEY);
  } catch {
    return null;
  }
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
