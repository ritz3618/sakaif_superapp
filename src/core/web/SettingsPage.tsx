/**
 * スーパーアプリの設定画面。
 * 第1段階では「この端末と通知」(実機での動作確認に使う)だけ。設定項目の自動生成は第2段階で足す。
 */
import { useCallback, useEffect, useState } from "react";
import type { MeResponse, PushSubscriptionInfo, PushTestResult, StatusResponse } from "../shared/api-types";
import type { FeatureMeta } from "../shared/feature";
import { canRegisterPush } from "../shared/push-policy";
import { apiJson, postJson } from "./api";
import { appContext, iosVersion, isStandalone, launchSource } from "./device";
import { Header } from "./Header";
import { currentSubscription, disablePush, enablePush, loadPublicKey, pushSupported } from "./push";

function formatJst(iso: string | null): string {
  if (!iso) return "まだありません";
  return new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="kv-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function SettingsPage({ appName, features }: { appName: string; features: readonly FeatureMeta[] }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [subscriptions, setSubscriptions] = useState<PushSubscriptionInfo[] | null>(null);
  const [hasLocalSubscription, setHasLocalSubscription] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testPath, setTestPath] = useState("/");

  const launch = launchSource();
  const standalone = isStandalone();
  const internalFeatures = features.filter((f) => f.kind === "internal");
  const context = appContext();
  // 機能単体のアイコンから開いているときは、通知を有効にできない(本体と二重に届くのを防ぐ)
  const registrationAllowed = canRegisterPush(context);
  const featureName = (id: string) => features.find((f) => f.id === id)?.name ?? id;
  const contextLabel = (value: string | null) =>
    value === "app" ? `${appName}本体` : value === "browser" ? "ブラウザ" : value ? featureName(value) : "(記録なし)";

  const refresh = useCallback(async () => {
    const local = await currentSubscription();
    setHasLocalSubscription(local !== null);
    setSubscriptions(await postJson<PushSubscriptionInfo[]>("/api/core/push/list", { currentEndpoint: local?.endpoint ?? null }));
  }, []);

  useEffect(() => {
    apiJson<MeResponse>("/api/core/me").then(setMe).catch(() => setMe(null));
    apiJson<StatusResponse>("/api/core/status").then(setStatus).catch(() => setStatus(null));
    loadPublicKey().then(setPublicKey).catch((e: unknown) => setMessage(String(e)));
    refresh().catch((e: unknown) => setMessage(String(e)));
  }, [refresh]);

  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage(await action());
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const sendTest = () =>
    run(async () => {
      const result = await postJson<PushTestResult>("/api/core/push/test", { path: testPath });
      const lines = [`送信: ${result.sent}件、失敗: ${result.failed}件、失効で削除: ${result.removed}件`];
      for (const d of result.details) {
        lines.push(`・${d.service}: ${d.status ?? "接続できず"}${d.error ? ` ${d.error}` : ""}`);
      }
      return lines.join("\n");
    });

  return (
    <div className="page">
      <Header title="設定" showHome />
      <main className="settings">
        <section className="panel">
          <h2>この端末</h2>
          <dl className="kv">
            <Row label="ログイン中" value={me?.email ?? "確認中…"} />
            <Row label="開き方" value={standalone ? "ホーム画面のアイコンから" : "ブラウザから"} />
            <Row label="起動したアイコン" value={standalone ? contextLabel(launch) : "—(ブラウザ)"} />
            <Row label="iOS" value={iosVersion() ?? "iPhone 以外"} />
          </dl>
        </section>

        <section className="panel">
          <h2>通知</h2>
          <p className="note">
            通知の許可は、{appName}全体で1回だけです。ホーム画面に追加した「{appName}」のアイコンから開いて、有効にしてください。
          </p>
          {!registrationAllowed && (
            <p className="note note--warn">
              {context === "unknown"
                ? "どのアイコンから開いたか分かりません。ホーム画面のアイコンから開き直してください。"
                : `いまは「${featureName(context)}」のアイコンから開いています。ここでは通知を有効にできません。「${appName}」のアイコンから開いて有効にしてください。`}
            </p>
          )}
          <dl className="kv">
            <Row label="この開き方で通知を使えるか" value={pushSupported() ? "使える" : "使えない"} />
            <Row
              label="許可の状態"
              value={
                "Notification" in window
                  ? { granted: "許可済み", denied: "拒否", default: "未確認" }[Notification.permission]
                  : "—"
              }
            />
            <Row label="この端末の登録" value={hasLocalSubscription ? "登録済み" : "未登録"} />
          </dl>
          <div className="buttons">
            <button
              type="button"
              disabled={busy || !publicKey || !registrationAllowed}
              onClick={() => publicKey && run(() => enablePush(publicKey))}
            >
              通知を有効にする
            </button>
            <button type="button" className="button--secondary" disabled={busy || !hasLocalSubscription} onClick={() => run(disablePush)}>
              この端末の登録を解除
            </button>
          </div>

          <h3>テスト通知</h3>
          <p className="note">自分の登録済みの端末すべてに送ります。タップしたときに開く画面を選べます。</p>
          <div className="buttons">
            <select value={testPath} onChange={(e) => setTestPath(e.target.value)} aria-label="開く画面">
              <option value="/">{appName}(ホーム)</option>
              {internalFeatures.map((f) => (
                <option key={f.id} value={`/${f.id}/`}>
                  {f.name}
                </option>
              ))}
            </select>
            <button type="button" disabled={busy || !subscriptions?.length} onClick={sendTest}>
              テスト通知を送る
            </button>
          </div>
          {message && <pre className="message message--box">{message}</pre>}

          <h3>登録済みの端末</h3>
          {subscriptions === null && <p className="note">読み込み中…</p>}
          {subscriptions?.length === 0 && <p className="note">まだありません。</p>}
          <ul className="device-list">
            {subscriptions?.map((s) => (
              <li key={s.id}>
                <strong>{s.deviceLabel ?? "端末"}</strong>
                {s.isThisDevice && <span className="badge">この端末</span>}
                <span className="device-list__meta">
                  登録元 {contextLabel(s.appContext)} / {s.service} / 登録 {formatJst(s.createdAt)} / 最終送信{" "}
                  {formatJst(s.lastSuccessAt)}
                </span>
                {s.lastError && <span className="device-list__error">直近のエラー: {s.lastError}</span>}
              </li>
            ))}
          </ul>
        </section>

        <section className="panel">
          <h2>定期実行</h2>
          <dl className="kv">
            <Row label="最後に動いた時刻" value={status ? formatJst(status.lastCronAt) : "確認中…"} />
          </dl>
        </section>
      </main>
    </div>
  );
}
