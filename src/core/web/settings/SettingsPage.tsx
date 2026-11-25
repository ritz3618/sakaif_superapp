/**
 * スーパーアプリの設定画面。
 * 上から: この端末と通知 / 宣言された設定(共通・機能ごと)/ ホームの並び順・アイコン / 通知の履歴 / 定期実行。
 */
import type { FeatureMeta } from "../../shared/feature";
import { Header } from "../Header";
import { Link } from "../router";
import { DevicePanel } from "./DevicePanel";
import { HistoryPanel } from "./HistoryPanel";
import { SettingsSections } from "./SettingsSections";
import { StatusPanel } from "./StatusPanel";

export function SettingsPage({ appName, features }: { appName: string; features: readonly FeatureMeta[] }) {
  return (
    <div className="page">
      <Header title="設定" showHome />
      <main className="settings">
        <DevicePanel appName={appName} features={features} />
        <SettingsSections />
        <section className="panel">
          <h2>ホーム</h2>
          <ul className="link-list">
            <li>
              <Link href="/settings/order/">ホームの並び順</Link>
              <span className="note">カードの順番を、自分用に並べ替えます。</span>
            </li>
            <li>
              <Link href="/settings/icons/">アイコン</Link>
              <span className="note">本体と各機能のアイコンに、好きな画像を使えます。</span>
            </li>
          </ul>
        </section>
        <HistoryPanel />
        <StatusPanel />
      </main>
    </div>
  );
}
