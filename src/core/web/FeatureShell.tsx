/** 各機能の画面の外枠。共通ヘッダー(ホームに戻るボタン付き)の下に、機能の画面を読み込んで表示する。 */
import { lazy, Suspense, useMemo, type ComponentType } from "react";
import type { FeatureMeta } from "../shared/feature";
import { apiFetch } from "./api";
import type { FeatureScreenProps } from "./feature-api";
import { Header } from "./Header";

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

  return (
    <div className="page">
      <Header title={feature.name} showHome />
      {/* data-feature と --feature-color で、機能ごとの見た目の調整を、この機能の画面の中だけに限る */}
      <main className="feature" data-feature={feature.id} style={{ ["--feature-color" as string]: feature.color }}>
        <Suspense fallback={<p className="message">読み込み中…</p>}>
          <Screen feature={feature} apiFetch={featureApi} subPath={subPath} />
        </Suspense>
      </main>
    </div>
  );
}
