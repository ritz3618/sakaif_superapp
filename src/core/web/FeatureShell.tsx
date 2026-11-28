/** 各機能の画面の外枠。共通ヘッダー(ホームに戻るボタン付き)の下に、機能の画面を読み込んで表示する。 */
import { lazy, Suspense, useMemo, type ComponentType } from "react";
import { FEATURE_SETTINGS_SUBPATH, featureSettingsPath, headerLinkIconId, type FeatureMeta } from "../shared/feature";
import { apiFetch } from "./api";
import type { FeatureScreenProps } from "./feature-api";
import { Header } from "./Header";
import { Link } from "./router";
import { SettingsSections } from "./settings/SettingsSections";

export type FeatureScreenLoader = () => Promise<{ default: ComponentType<FeatureScreenProps> }>;

function NoScreen({ feature }: FeatureScreenProps) {
  return <p className="message">「{feature.name}」の画面はまだありません。</p>;
}

export function FeatureShell({
  feature,
  loader,
  path,
}: {
  feature: FeatureMeta;
  loader: FeatureScreenLoader | undefined;
  path: string;
}) {
  const Screen = useMemo(() => (loader ? lazy(loader) : NoScreen), [loader]);
  const subPath = path.slice(`/${feature.id}`.length) || "/";
  const featureApi = useMemo(
    () => (p: string, init?: RequestInit) => apiFetch(`/api/f/${feature.id}${p.startsWith("/") ? p : `/${p}`}`, init),
    [feature.id],
  );

  // 設定や通知がある機能は、右上に、その機能の設定画面への入口を出す
  const hasSettings = (feature.settings?.length ?? 0) > 0 || (feature.notifications?.length ?? 0) > 0;
  const onSettings = subPath === FEATURE_SETTINGS_SUBPATH;

  if (onSettings) {
    return (
      <div className="page">
        <Header title={`${feature.name}の設定`} showHome />
        <main className="settings" data-feature={feature.id} style={{ ["--feature-color" as string]: feature.color }}>
          <div className="settings-nav">
            {feature.kind === "internal" ? <Link href={`/${feature.id}/`}>‹ {feature.name}に戻る</Link> : <Link href="/">‹ ホームに戻る</Link>}
            <Link href="/settings/">アプリ全体の設定 ›</Link>
          </div>
          <SettingsSections only={feature.id} />
        </main>
      </div>
    );
  }

  return (
    <div className="page">
      <Header
        title={feature.name}
        showHome
        showSettings={hasSettings}
        settingsHref={featureSettingsPath(feature.id)}
        appLink={
          feature.headerLink && {
            label: feature.headerLink.label,
            url: feature.headerLink.url,
            // 設定の「アイコン」で登録したもの(…-link)を優先し、無ければ宣言の icon、それも無ければ文字
            icons: [`/pwa/${headerLinkIconId(feature.id)}/icon-180.png?custom=1`, ...(feature.headerLink.icon ? [feature.headerLink.icon] : [])],
          }
        }
      />
      {/* data-feature と --feature-color で、機能ごとの見た目の調整を、この機能の画面の中だけに限る */}
      <main className="feature" data-feature={feature.id} style={{ ["--feature-color" as string]: feature.color }}>
        <Suspense fallback={<p className="message">読み込み中…</p>}>
          <Screen feature={feature} apiFetch={featureApi} subPath={subPath} />
        </Suspense>
      </main>
    </div>
  );
}
