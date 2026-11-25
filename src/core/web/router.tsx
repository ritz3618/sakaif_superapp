/**
 * 画面の切り替え。
 * 同じ PWA の中(例: 育児ログの画面どうし)は、ページを読み直さずに切り替える。
 * 別の PWA に移るとき(ホーム → 育児ログなど)は、ページを読み直す。
 * iPhone は「ホーム画面に追加」した時点の HTML からアイコンと名前を読むため、
 * 画面ごとに正しい manifest が HTML に入っている必要があるから。
 */
import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";

const NAVIGATE_EVENT = "app:navigate";

function subscribe(callback: () => void): () => void {
  window.addEventListener("popstate", callback);
  window.addEventListener(NAVIGATE_EVENT, callback);
  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener(NAVIGATE_EVENT, callback);
  };
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname);
}

/** パスがどの PWA に属するか("/piyolog/..." → "piyolog"、それ以外 → "app") */
export function pwaTargetOf(pathname: string, featureIds: readonly string[]): string {
  const first = pathname.split("/")[1] ?? "";
  return featureIds.includes(first) ? first : "app";
}

let knownFeatureIds: readonly string[] = [];

export function setKnownFeatureIds(ids: readonly string[]): void {
  knownFeatureIds = ids;
}

function currentPageTarget(): string {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="x-pwa-target"]');
  return meta?.content ?? pwaTargetOf(window.location.pathname, knownFeatureIds);
}

export function navigate(to: string): void {
  const url = new URL(to, window.location.href);
  if (url.origin !== window.location.origin) {
    window.location.assign(url.href);
    return;
  }
  if (pwaTargetOf(url.pathname, knownFeatureIds) !== currentPageTarget()) {
    window.location.assign(url.href);
    return;
  }
  window.history.pushState(null, "", url.pathname + url.search + url.hash);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
  window.scrollTo(0, 0);
}

export function Link(props: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const { href, onClick, ...rest } = props;
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || props.target) return;
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin) return;
    event.preventDefault();
    navigate(href);
  };
  return <a href={href} onClick={handleClick} {...rest} />;
}
