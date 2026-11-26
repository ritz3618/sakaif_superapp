/**
 * 育児ログの画面。
 * - メイン(/<機能ID>/): 授乳・睡眠・おむつの今の状態と、今日・昨日を「ふだん」(過去7日の平均)と比べた表、
 *   最近の体温・体重・身長・お風呂、今日と昨日の時間の帯。
 * - データの管理(/<機能ID>/data/): 過去の記録の取り込み、CSV の書き出し。
 * 経過時間は30秒ごと、データは1分ごとに更新する。
 * 見た目は共通の部品(Panel、CompareTable など)で作り、この機能だけの調整は web/piyolog.css に書く。
 */
import { useCallback, useEffect, useState } from "react";
import {
  BigValue,
  Button,
  CompareTable,
  Link,
  Note,
  Panel,
  Stat,
  StatGrid,
  type CompareRow,
  type FeatureScreenProps,
} from "../../core/web/feature-api";
import type { DayMetrics, LatestValue, PiyologSummary } from "./shared/api";
import { formatMinutes, formatMl, minutesBetween } from "./shared/format";
import { compare, isShort, type CompareUnit } from "./web/compare";
import DataPage from "./web/DataPage";
import { DayTimeline } from "./web/DayTimeline";
import { timeOf } from "./web/time";
import "./web/piyolog.css";

function elapsedSince(iso: string | null, now: number): string | null {
  return iso ? formatMinutes(minutesBetween(Date.parse(iso), now)) : null;
}

const formatCount = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}回`;

function formatBy(unit: CompareUnit, value: number): string {
  if (unit === "ml") return formatMl(value);
  if (unit === "minutes") return formatMinutes(Math.round(value));
  return formatCount(value);
}

/**
 * 比べる表の1行。average は「ふだん」の値(無ければ null)。
 * shortage を付けると、少ないときに「少なめ」の注意を出す(回数には付けない)。muted は参考程度の行。
 */
function row(
  label: string,
  value: number | null,
  average: number | null,
  unit: CompareUnit,
  options: { shortage?: boolean; muted?: boolean } = {},
): CompareRow {
  if (value === null) return { label, value: "—", muted: options.muted };
  const result: CompareRow = {
    label,
    value: formatBy(unit, value),
    reference: average === null ? undefined : formatBy(unit, average),
    muted: options.muted,
  };
  if (average !== null && !options.muted) {
    const c = compare(value, average, unit);
    result.trend = { direction: c.direction, text: c.diffText };
    if (options.shortage && unit !== "count" && isShort(value, average, unit)) result.warning = "少なめ";
  }
  return result;
}

const UNIT_LABELS: Record<string, string> = { celsius: "℃", kg: "kg", cm: "cm", ml: "ml" };

function formatLatest(v: LatestValue | null, digits: number): string {
  if (!v || v.value === null) return "記録なし";
  return `${v.value.toFixed(digits)}${v.unit ? (UNIT_LABELS[v.unit] ?? v.unit) : ""}`;
}

function MainScreen({ apiFetch, feature }: FeatureScreenProps) {
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

  const dataLink = `/${feature.id}/data/`;
  if (!summary.configured) {
    return (
      <Panel title="フィードURLが未設定です">
        <Note>
          ぴよログのアプリの「設定 → データフィード」でフィードを作り、そのURLを、このアプリの設定画面の「育児ログ」→「フィードURL」に保存してください。URLはチャットなどに貼らないでください。
        </Note>
        <Link href="/settings/">設定画面を開く</Link>
        <Note>過去の記録(月ごとのテキスト)の取り込みは、フィードURLが無くてもできます。</Note>
        <Link href={dataLink}>データの管理を開く</Link>
      </Panel>
    );
  }

  const { sync, today, yesterday, comparison, latest } = summary;
  const { sameTime, fullDay } = comparison;
  const lastFeedingAt = summary.feeding.last?.at ?? null;
  const feedingMinutes = lastFeedingAt ? minutesBetween(Date.parse(lastFeedingAt), now) : null;
  const feedingOverdue = feedingMinutes !== null && feedingMinutes >= summary.feeding.intervalMinutes;
  const lastDiaperAt = [summary.pee.lastAt, summary.poop.lastAt].filter(Boolean).sort().at(-1) ?? null;
  const sleepElapsed = elapsedSince(summary.sleep.since, now);
  const perFeedingToday = today.feedingMlCount > 0 ? today.feedingMl / today.feedingMlCount : null;
  // 今日の行は「過去7日の同じ時刻まで」、昨日の行は「その前の7日の1日分」と比べる
  const now7 = (pick: (m: DayMetrics) => number) => (sameTime ? pick(sameTime.average) : null);
  const full7 = (pick: (m: DayMetrics) => number) => (fullDay ? pick(fullDay.average) : null);

  const feedingRows: CompareRow[] = [
    row("今日の量", today.feedingMl, now7((m) => m.feedingMl), "ml", { shortage: true }),
    row("今日の回数", today.feedingCount, now7((m) => m.feedingCount), "count"),
    row("1回の平均", perFeedingToday, comparison.perFeedingMl, "ml"),
    row("昨日の量", yesterday?.feedingMl ?? null, full7((m) => m.feedingMl), "ml", { shortage: true }),
    row("昨日の回数", yesterday?.feedingCount ?? null, full7((m) => m.feedingCount), "count"),
  ];
  const sleepRows: CompareRow[] = [
    row("今日", today.sleepMinutes, now7((m) => m.sleepMinutes), "minutes", { shortage: true }),
    row("昨日", yesterday?.sleepMinutes ?? null, full7((m) => m.sleepMinutes), "minutes", { shortage: true }),
  ];
  const diaperRows: CompareRow[] = [
    row("今日のうんち", today.poopCount, now7((m) => m.poopCount), "count"),
    row("昨日のうんち", yesterday?.poopCount ?? null, full7((m) => m.poopCount), "count"),
    row("今日のおしっこ(参考)", today.peeCount, now7((m) => m.peeCount), "count", { muted: true }),
  ];
  const headers: [string, string, string] = ["", "記録", "ふだん"];

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

      <Panel title="授乳" tone={feedingOverdue ? "warn" : "normal"}>
        <BigValue tone={feedingOverdue ? "warn" : "normal"}>
          {feedingMinutes !== null ? `${formatMinutes(feedingMinutes)}前` : "記録なし"}
        </BigValue>
        {feedingOverdue && (
          <Note tone="warn">⚠ 基準の{formatMinutes(summary.feeding.intervalMinutes)}を過ぎています</Note>
        )}
        {summary.feeding.last && (
          <Note>
            前回 {timeOf(summary.feeding.last.at)}に飲み始め
            {summary.feeding.last.amountMl !== null && ` / ${formatMl(summary.feeding.last.amountMl)}`}
          </Note>
        )}
        <CompareTable headers={headers} rows={feedingRows} />
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
        <CompareTable headers={["睡眠の合計", "記録", "ふだん"]} rows={sleepRows} />
      </Panel>

      <Panel title="おむつ">
        <BigValue>{lastDiaperAt ? `${elapsedSince(lastDiaperAt, now)}前` : "記録なし"}</BigValue>
        <Note>
          最後のうんち {timeOf(summary.poop.lastAt)} / 最後のおしっこ {timeOf(summary.pee.lastAt)}
        </Note>
        <CompareTable headers={headers} rows={diaperRows} />
      </Panel>

      <p className="note piyolog-footnote">
        {sameTime || fullDay
          ? `「ふだん」は、今日の行は過去${sameTime?.days ?? 0}日の同じ時刻までの平均、昨日の行はその前の${fullDay?.days ?? 0}日の1日分の平均、1回の平均は過去7日の平均です。量と睡眠が、ふだんの85%を下回ると「少なめ」と表示します。`
          : "比べられる過去の記録が、まだありません(記録がそろった日から比べます)。"}
      </p>

      <Panel title="最近の記録">
        <StatGrid>
          <Stat label="体温" value={formatLatest(latest.temperature, 1)}>
            <span className="note">{timeOf(latest.temperature?.at ?? null)}</span>
          </Stat>
          <Stat label="体重" value={formatLatest(latest.weight, 2)}>
            <span className="note">{timeOf(latest.weight?.at ?? null)}</span>
          </Stat>
          <Stat label="身長" value={formatLatest(latest.height, 1)}>
            <span className="note">{timeOf(latest.height?.at ?? null)}</span>
          </Stat>
          <Stat label="お風呂" value={latest.bath ? timeOf(latest.bath.at) : "記録なし"}>
            {latest.bath && <span className="note">{elapsedSince(latest.bath.at, now)}前</span>}
          </Stat>
        </StatGrid>
      </Panel>

      <Panel title="今日と昨日">
        <DayTimeline days={summary.timeline} nowMinute={summary.timeline[0]?.until} />
      </Panel>

      <Panel title="データ">
        {summary.expiry && summary.expiry.daysLeft <= 14 && (
          <Note tone="warn">
            フィードURLの期限が近づいています(目安 {summary.expiry.expiresOn.slice(5).replace("-", "/")}
            {summary.expiry.daysLeft >= 0 ? `、あと${summary.expiry.daysLeft}日` : "、過ぎています"})。
          </Note>
        )}
        <Link href={dataLink} className="piyolog-link">
          データの管理(取り込み・CSV) ›
        </Link>
      </Panel>
    </div>
  );
}

export default function IkujiLogScreen(props: FeatureScreenProps) {
  if (props.subPath.startsWith("/data")) return <DataPage {...props} />;
  return <MainScreen {...props} />;
}
