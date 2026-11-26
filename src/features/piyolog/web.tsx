/**
 * 育児ログのメイン画面。
 * 授乳・睡眠・おしっこ・うんちの今の状態と今日の合計を出し、過去1週間の同じ時刻までの平均と比べる。
 * 経過時間は30秒ごと、データは1分ごとに更新する。
 */
import { useCallback, useEffect, useState } from "react";
import { Link, type FeatureScreenProps } from "../../core/web/feature-api";
import { jstDate, jstDateTimeLabel, jstTime } from "../../core/shared/time";
import type { DayMetrics, PiyologSummary } from "./shared/api";
import { formatMinutes, formatMl, minutesBetween } from "./shared/format";
import { compare, type CompareUnit } from "./web/compare";
import "./web/piyolog.css";

function elapsedSince(iso: string | null, now: number): string | null {
  return iso ? formatMinutes(minutesBetween(Date.parse(iso), now)) : null;
}

function timeOf(iso: string | null): string {
  if (!iso) return "—";
  const at = new Date(iso);
  // 今日(日本時間)なら時刻だけ、それ以外は日付も付ける
  return jstDate(at) === jstDate(new Date()) ? jstTime(at) : jstDateTimeLabel(at);
}

function Compare({
  summary,
  pick,
  unit,
}: {
  summary: PiyologSummary;
  pick: (m: DayMetrics) => number;
  unit: CompareUnit;
}) {
  if (!summary.comparison) return null;
  const result = compare(pick(summary.today), pick(summary.comparison.average), unit);
  const arrow = result.direction === "more" ? "↑" : result.direction === "less" ? "↓" : "→";
  return (
    <span className={`ikuji-compare ikuji-compare--${result.direction}`}>
      いつもより {result.diffText} {arrow}
    </span>
  );
}

function Metric({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="ikuji-metric">
      <span className="ikuji-metric__label">{label}</span>
      <span className="ikuji-metric__value">{value}</span>
      {children}
    </div>
  );
}

export default function IkujiLogScreen({ apiFetch }: FeatureScreenProps) {
  const [summary, setSummary] = useState<PiyologSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/summary");
      setSummary((await res.json()) as PiyologSummary);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [apiFetch]);

  useEffect(() => {
    void load();
    const dataTimer = window.setInterval(() => void load(), 60_000);
    const clockTimer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      window.clearInterval(dataTimer);
      window.clearInterval(clockTimer);
    };
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const res = await apiFetch("/refresh", { method: "POST" });
      setSummary((await res.json()) as PiyologSummary);
      setNow(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  };

  if (error && !summary) return <p className="message message--error">{error}</p>;
  if (!summary) return <p className="message">読み込み中…</p>;

  if (!summary.configured) {
    return (
      <div className="panel">
        <h2>フィードURLが未設定です</h2>
        <p className="note">
          ぴよログのアプリの「設定 → データフィード」でフィードを作り、そのURLを、このアプリの設定画面の「育児ログ」→「フィードURL」に保存してください。URLはチャットなどに貼らないでください。
        </p>
        <Link href="/settings/">設定画面を開く</Link>
      </div>
    );
  }

  const { sync, today } = summary;
  const feedingElapsed = elapsedSince(summary.feeding.last?.at ?? null, now);
  const lastDiaperAt = [summary.pee.lastAt, summary.poop.lastAt].filter(Boolean).sort().at(-1) ?? null;
  const sleepElapsed = elapsedSince(summary.sleep.since, now);

  return (
    <div className="ikuji">
      <div className="ikuji-sync">
        <span>
          最終取得 {sync.lastSuccessAt ? timeOf(sync.lastSuccessAt) : "まだありません"}
          {sync.lastAttemptOk === false && <span className="ikuji-sync__error"> 取得に失敗: {sync.lastError}</span>}
        </span>
        <button type="button" className="button--secondary button--small" disabled={refreshing} onClick={refresh}>
          {refreshing ? "取得中…" : "今すぐ更新"}
        </button>
      </div>

      <section className="panel ikuji-block">
        <h2>授乳</h2>
        <p className="ikuji-big">{feedingElapsed ? `${feedingElapsed}前` : "記録なし"}</p>
        {summary.feeding.last && (
          <p className="note">
            前回 {timeOf(summary.feeding.last.at)}に飲み始め
            {summary.feeding.last.amountMl !== null && ` / ${formatMl(summary.feeding.last.amountMl)}`}
          </p>
        )}
        <div className="ikuji-metrics">
          <Metric label="今日の回数" value={`${today.feedingCount}回`}>
            <Compare summary={summary} pick={(m) => m.feedingCount} unit="count" />
          </Metric>
          <Metric label="今日の総量" value={formatMl(today.feedingMl)}>
            <Compare summary={summary} pick={(m) => m.feedingMl} unit="ml" />
          </Metric>
        </div>
      </section>

      <section className="panel ikuji-block">
        <h2>睡眠</h2>
        <p className="ikuji-big">
          {summary.sleep.state === "sleeping" && sleepElapsed && `睡眠中、${sleepElapsed}経過`}
          {summary.sleep.state === "awake" && sleepElapsed && `起きてから${sleepElapsed}`}
          {summary.sleep.state === "unknown" && "記録なし"}
        </p>
        <p className="note">
          最後に寝た {timeOf(summary.sleep.lastSleepAt)} / 最後に起きた {timeOf(summary.sleep.lastWakeAt)}
        </p>
        <div className="ikuji-metrics">
          <Metric label="今日の睡眠" value={formatMinutes(today.sleepMinutes)}>
            <Compare summary={summary} pick={(m) => m.sleepMinutes} unit="minutes" />
          </Metric>
        </div>
      </section>

      <section className="panel ikuji-block">
        <h2>おむつ</h2>
        <p className="ikuji-big">{lastDiaperAt ? `${elapsedSince(lastDiaperAt, now)}前` : "記録なし"}</p>
        <div className="ikuji-metrics">
          <Metric label="おしっこ(今日)" value={`${today.peeCount}回`}>
            <span className="note">最後 {timeOf(summary.pee.lastAt)}</span>
            <Compare summary={summary} pick={(m) => m.peeCount} unit="count" />
          </Metric>
          <Metric label="うんち(今日)" value={`${today.poopCount}回`}>
            <span className="note">最後 {timeOf(summary.poop.lastAt)}</span>
            <Compare summary={summary} pick={(m) => m.poopCount} unit="count" />
          </Metric>
        </div>
      </section>

      <p className="note ikuji-footnote">
        {summary.comparison
          ? `「いつもより」は、過去${summary.comparison.days}日の同じ時刻までの平均との比較です。`
          : "比較に使える過去のデータが、まだありません(記録がそろった日から比較します)。"}
      </p>

      <section className="panel">
        <h2>データ</h2>
        {summary.expiry && (
          <p className="note">
            フィードURLの期限の目安: {summary.expiry.expiresOn.slice(5).replace("-", "/")}
            {summary.expiry.daysLeft >= 0 ? `(あと${summary.expiry.daysLeft}日)` : "(過ぎています)"}
          </p>
        )}
        <a className="ikuji-download" href="/api/f/piyolog/export.csv" download>
          保存した記録をCSVでダウンロード
        </a>
      </section>
    </div>
  );
}
