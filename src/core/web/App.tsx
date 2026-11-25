/** 画面全体の切り替え。どの機能があるかは引数で受け取り、個別の機能のことは知らない。 */
import { APP_INFO } from "../shared/app";
import type { FeatureMeta } from "../shared/feature";
import { FeatureShell, type FeatureScreenLoader } from "./FeatureShell";
import { Header } from "./Header";
import { Home } from "./Home";
import { Link, usePath } from "./router";
import { HomeOrderPage } from "./settings/HomeOrderPage";
import { IconsPage } from "./settings/IconsPage";
import { SettingsPage } from "./settings/SettingsPage";

export interface AppProps {
  features: readonly FeatureMeta[];
  loaders: Readonly<Record<string, FeatureScreenLoader>>;
}

export function App({ features, loaders }: AppProps) {
  const path = usePath();

  if (path === "/") return <Home appName={APP_INFO.name} />;
  if (path === "/settings/order/") return <HomeOrderPage />;
  if (path === "/settings/icons/") return <IconsPage />;
  if (path.startsWith("/settings/")) return <SettingsPage appName={APP_INFO.name} features={features} />;

  const id = path.split("/")[1] ?? "";
  const feature = features.find((f) => f.kind === "internal" && f.id === id);
  if (feature) return <FeatureShell key={feature.id} feature={feature} loader={loaders[feature.id]} path={path} />;

  return (
    <div className="page">
      <Header title="見つかりません" showHome />
      <main className="feature">
        <p className="message">このページはありません。</p>
        <Link href="/">ホームに戻る</Link>
      </main>
    </div>
  );
}
