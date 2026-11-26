/**
 * 室温・湿度の画面。今の値と注意、使っている温湿度計、SwitchBot の機器の確認、基準と通知の設定の案内。
 * 見た目は共通の部品で作り、この機能だけの調整は web/room.css に書く。
 */
import { useCallback, useEffect, useState } from "react";
import { Button, Link, Note, Panel, Stat, StatGrid, type FeatureScreenProps } from "../../core/web/feature-api";
import { jstDate, jstDateTimeLabel, jstTime } from "../../core/shared/time";
import type { DeviceCheck, RoomSummary, Thresholds } from "./shared/api";
import { warningText } from "./shared/thresholds";
import "./web/room.css";

function timeOf(iso: string | null): string {
  if (!iso) return "—";
  const at = new Date(iso);
  return jstDate(at) === jstDate(new Date()) ? jstTime(at) : jstDateTimeLabel(at);
}

function range(low: number | null, high: number | null, unit: string): string {
  if (low === null && high === null) return "設定なし";
  if (high === null) return `${low}${unit}以上`;
  if (low === null) return `${high}${unit}以下`;
  return `${low}〜${high}${unit}`;
}

function ThresholdNote({ t }: { t: Thresholds }) {
  return (
    <Note>
      基準: 室温 {range(t.temperatureLow, t.temperatureHigh, "℃")}、湿度 {range(t.humidityLow, t.humidityHigh, "%")}
    </Note>
  );
}

function DevicePanel({ apiFetch }: Pick<FeatureScreenProps, "apiFetch">) {
  const [result, setResult] = useState<DeviceCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult((await (await apiFetch("/devices")).json()) as DeviceCheck);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const meters = result?.devices.filter((d) => d.isMeter) ?? [];
  return (
    <Panel title="温湿度計の確認">
      <Note>
        SwitchBot に登録されている機器を確認します。値を読むには、温湿度計がハブにつながっていて、クラウドサービス(新しいアプリでは「サードパーティーサービス」)が有効になっている必要があります。
      </Note>
      <Button variant="secondary" disabled={busy} onClick={check}>
        {busy ? "確認中…" : "SwitchBot の機器を確認する"}
      </Button>
      {error && <Note tone="error">{error}</Note>}
      {result && (
        <>
          {meters.length === 0 && <Note tone="warn">温湿度計が見つかりませんでした(機器 {result.devices.length}台)。</Note>}
          <ul className="room-devices">
            {result.devices.map((d, i) => (
              <li key={i} className={d.isMeter ? "room-devices__meter" : undefined}>
                <strong>{d.name}</strong>
                <span className="note">
                  {d.type}
                  {d.isMeter && ` / ハブ経由: ${d.viaHub ? "はい" : "いいえ"} / クラウド: ${d.cloud === null ? "不明" : d.cloud ? "有効" : "無効"}`}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

export default function RoomScreen({ apiFetch }: FeatureScreenProps) {
  const [summary, setSummary] = useState<RoomSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setSummary((await (await apiFetch("/summary")).json()) as RoomSummary);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [apiFetch]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      setSummary((await (await apiFetch("/refresh", { method: "POST" })).json()) as RoomSummary);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  };

  if (error && !summary) return <Note tone="error">{error}</Note>;
  if (!summary) return <Note>読み込み中…</Note>;

  if (!summary.configured) {
    return (
      <>
        <Panel title="SwitchBot のトークンが未設定です">
          <Note>
            SwitchBot のアプリで「プロフィール → 設定 → アプリについて」を開き、アプリのバージョンを10回たたくと「開発者向けオプション」が出ます。そこでトークンとクライアントシークレットを取得し、このアプリの設定画面の「室温・湿度」に保存してください。値はチャットなどに貼らないでください。
          </Note>
          <Link href="/settings/">設定画面を開く</Link>
        </Panel>
      </>
    );
  }

  const { reading, warnings, sync } = summary;
  const warn = (metric: "temperature" | "humidity") => warnings.find((w) => w.metric === metric);
  const stale = reading ? Date.now() - Date.parse(reading.at) > 30 * 60 * 1000 : false;

  return (
    <div className="room-screen">
      <div className="room-sync">
        <span>
          最終取得 {timeOf(sync.lastSuccessAt)}
          {sync.lastError && sync.lastAttemptAt !== sync.lastSuccessAt && <span className="room-sync__error"> 取得に失敗: {sync.lastError}</span>}
        </span>
        <Button variant="secondary" size="small" disabled={refreshing} onClick={refresh}>
          {refreshing ? "取得中…" : "今すぐ更新"}
        </Button>
      </div>

      <Panel title="今の室温・湿度" tone={warnings.length > 0 ? "warn" : "normal"}>
        {reading ? (
          <>
            <StatGrid>
              <Stat label="室温" value={`${reading.temperature}℃`} tone={warn("temperature") ? "warn" : "normal"} />
              <Stat label="湿度" value={`${reading.humidity}%`} tone={warn("humidity") ? "warn" : "normal"} />
            </StatGrid>
            {warnings.map((w) => (
              <Note key={w.metric} tone="warn">
                ⚠ {warningText(w)}
              </Note>
            ))}
            <Note>
              {timeOf(reading.at)}の値{summary.device && ` / ${summary.device.name}`}
              {stale && "(30分以上前の値です)"}
            </Note>
          </>
        ) : (
          <Note>まだ値がありません。5分以内に読み込みます。すぐに見たいときは「今すぐ更新」を押してください。</Note>
        )}
        <ThresholdNote t={summary.thresholds} />
        <Link href="/settings/">基準と通知を変える(設定画面)</Link>
      </Panel>

      <DevicePanel apiFetch={apiFetch} />
    </div>
  );
}
