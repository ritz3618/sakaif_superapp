/**
 * 育児ログのメイン画面。
 * 授乳・睡眠・おしっこ・うんちの今の状態と今日の合計を出し、過去1週間の同じ時刻までの平均と比べる。
 * 経過時間は30秒ごと、データは1分ごとに更新する。
 * 見た目は共通の部品(Panel、Stat など)で作り、この機能だけの調整は web/piyolog.css に書く。
 */
import { useCallback, useEffect, useState } from "react";
import {
  BigValue,
  Button,
  Link,
  Note,
  Panel,
  Stat,
  StatGrid,
  Trend,
  type FeatureScreenProps,
} from "../../core/web/feature-api";
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
  return <Trend direction={result.direction}>いつもより {result.diffText}</Trend>;
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

  if (error && !summary) return <Note tone="error">{error}</Note>;
  if (!summary) return <Note>読み込み中…</Note>;

  if (!summary.configured) {
    return (
      <Panel title="フィードURLが未設定です">
        <Note>
          ぴよログのアプリの「設定 → データフィード」でフィードを作り、そのURLを、このアプリの設定画面の「育児ログ」→「フィードURL」に保存してください。URLはチャットなどに貼らないでください。
        </Note>
        <Link href="/settings/">設定画面を開く</Link>
      </Panel>
    );
  }

  const { sync, today } = summary;
  const feedingElapsed = elapsedSince(summary.feeding.last?.at ?? null, now);
  const lastDiaperAt = [summary.pee.lastAt, summary.poop.lastAt].filter(Boolean).sort().at(-1) ?? null;
  const sleepElapsed = elapsedSince(summary.sleep.since, now);

  return (
    <div className="piyolog-screen">
      <div className="piyolog-sync">
        <span>
          最終取得 {sync.lastSuccessAt ? timeOf(sync.lastSuccessAt) : "まだありません"}
          {sync.lastAttemptOk === false && <span className="piyolog-sync__error"> 取得に失敗: {sync.lastError}</span>}
        </span>
        <Button variant="secondary" size="small" disabled={refreshing} onClick={refresh}>
          {refreshing ? "取得中…" : "今すぐ更新"}
        </Button>
      </div>

      <Panel title="授乳">
        <BigValue>{feedingElapsed ? `${feedingElapsed}前` : "記録なし"}</BigValue>
        {summary.feeding.last && (
          <Note>
            前回 {timeOf(summary.feeding.last.at)}に飲み始め
            {summary.feeding.last.amountMl !== null && ` / ${formatMl(summary.feeding.last.amountMl)}`}
          </Note>
        )}
        <StatGrid>
          <Stat label="今日の回数" value={`${today.feedingCount}回`}>
            <Compare summary={summary} pick={(m) => m.feedingCount} unit="count" />
          </Stat>
          <Stat label="今日の総量" value={formatMl(today.feedingMl)}>
            <Compare summary={summary} pick={(m) => m.feedingMl} unit="ml" />
          </Stat>
        </StatGrid>
      </Panel>

      <Panel title="睡眠">
        <BigValue>
          {summary.sleep.state === "sleeping" && sleepElapsed && `睡眠中、${sleepElapsed}経過`}
          {summary.sleep.state === "awake" && sleepElapsed && `起きてから${sleepElapsed}`}
          {summary.sleep.state === "unknown" && "記録なし"}
        </BigValue>
        <Note>
          最後に寝た {timeOf(summary.sleep.lastSleepAt)} / 最後に起きた {timeOf(summary.sleep.lastWakeAt)}
        </Note>
        <StatGrid>
          <Stat label="今日の睡眠" value={formatMinutes(today.sleepMinutes)}>
            <Compare summary={summary} pick={(m) => m.sleepMinutes} unit="minutes" />
          </Stat>
        </StatGrid>
      </Panel>

      <Panel title="おむつ">
        <BigValue>{lastDiaperAt ? `${elapsedSince(lastDiaperAt, now)}前` : "記録なし"}</BigValue>
        <StatGrid>
          <Stat label="おしっこ(今日)" value={`${today.peeCount}回`}>
            <span className="note">最後 {timeOf(summary.pee.lastAt)}</span>
            <Compare summary={summary} pick={(m) => m.peeCount} unit="count" />
          </Stat>
          <Stat label="うんち(今日)" value={`${today.poopCount}回`}>
            <span className="note">最後 {timeOf(summary.poop.lastAt)}</span>
            <Compare summary={summary} pick={(m) => m.poopCount} unit="count" />
          </Stat>
        </StatGrid>
      </Panel>

      <p className="note piyolog-footnote">
        {summary.comparison
          ? `「いつもより」は、過去${summary.comparison.days}日の同じ時刻までの平均との比較です。`
          : "比較に使える過去のデータが、まだありません(記録がそろった日から比較します)。"}
      </p>

      <Panel title="データ">
        {summary.expiry && (
          <Note>
            フィードURLの期限の目安: {summary.expiry.expiresOn.slice(5).replace("-", "/")}
            {summary.expiry.daysLeft >= 0 ? `(あと${summary.expiry.daysLeft}日)` : "(過ぎています)"}
          </Note>
        )}
        <a className="piyolog-download" href="/api/f/piyolog/export.csv" download>
          保存した記録をCSVでダウンロード
        </a>
      </Panel>
    </div>
  );
}
