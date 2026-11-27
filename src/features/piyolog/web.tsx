/**
 * 育児ログの画面。
 * - メイン(/<機能ID>/): 授乳・睡眠・おむつの今の状態と、今日を「ふだん」(過去7日の平均)や目安と比べた表示
 *   (この3つは1画面に収める)、室温・湿度、最近の体温・体重・身長・お風呂、今日・昨日・2日前の時間の帯。
 * - データの管理(/<機能ID>/data/): 過去の記録の取り込み、CSV の書き出し。
 * 経過時間は30秒ごと、データは1分ごとに更新する。
 * 見た目は共通の部品(Panel、PaceBar など)で作り、この機能だけの調整は web/piyolog.css に書く。
 */
import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Link,
  Note,
  PaceBar,
  Panel,
  Stat,
  StatGrid,
  Trend,
  type FeatureScreenProps,
} from "../../core/web/feature-api";
import type { DayMetrics, LatestValue, PiyologSummary } from "./shared/api";
import { jstMinuteOfDay } from "../../core/shared/time";
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
 * 1日の目安量のうち、今の時刻までに飲む分の目安。
 * ふだんの飲み方の配分(ふだんの「今の時刻まで」÷「1日」)で割り振る。ふだんの記録が無ければ、時刻で均等に割り振る。
 */
function targetUpToNow(target: number, typicalNow: number | null, typicalDay: number | null, now: number): number {
  if (typicalNow !== null && typicalDay !== null && typicalDay > 0) return target * Math.min(1, typicalNow / typicalDay);
  return (target * jstMinuteOfDay(new Date(now))) / 1440;
}

/** 差の表示(例: 「+26ml ↑」)。数値そのものを比べる */
function Diff({ value, reference, unit }: { value: number; reference: number; unit: CompareUnit }) {
  const c = compare(value, reference, unit);
  return <Trend direction={c.direction}>{c.diffText}</Trend>;
}

/** 1日の基準まで、あといくつか(届いていれば「到達」) */
function Rest({ value, goal, unit, label }: { value: number; goal: number; unit: CompareUnit; label: string }) {
  const c = compare(value, goal, unit);
  if (c.direction !== "less") return <>{label}に到達</>;
  return (
    <>
      {label}まで あと<strong>{formatBy(unit, goal - value)}</strong>
    </>
  );
}

const UNIT_LABELS: Record<string, string> = { celsius: "℃", kg: "kg", cm: "cm", ml: "ml" };

function formatLatest(v: LatestValue | null, digits: number): string {
  if (!v || v.value === null) return "記録なし";
  return `${v.value.toFixed(digits)}${v.unit ? (UNIT_LABELS[v.unit] ?? v.unit) : ""}`;
}

const ROOM_LABEL = { temperature: "室温", humidity: "湿度" } as const;
const ROOM_UNIT = { temperature: "℃", humidity: "%" } as const;

/** 室温・湿度(室温・湿度の機能が保存した値を、共通データから読んで表示する) */
function RoomPanel({ room, now }: { room: NonNullable<PiyologSummary["room"]>; now: number }) {
  const minutes = minutesBetween(Date.parse(room.at), now);
  const warn = (metric: "temperature" | "humidity") => room.warnings.find((w) => w.metric === metric);
  return (
    <Panel title="室温・湿度" tone={room.warnings.length > 0 ? "warn" : "normal"}>
      <StatGrid>
        {(["temperature", "humidity"] as const).map((metric) => (
          <Stat
            key={metric}
            label={ROOM_LABEL[metric]}
            value={room[metric] === null ? "—" : `${room[metric]}${ROOM_UNIT[metric]}`}
            tone={warn(metric) ? "warn" : "normal"}
          />
        ))}
      </StatGrid>
      {room.warnings.map((w) => (
        <Note key={w.metric} tone="warn">
          ⚠ {ROOM_LABEL[w.metric]}が基準({w.threshold}
          {ROOM_UNIT[w.metric]}
          {w.direction === "low" ? "以上)を下回っています" : "以下)を上回っています"}
        </Note>
      ))}
      <Note>{minutes <= 1 ? "たった今の値" : `${formatMinutes(minutes)}前の値`}{minutes > 30 && "(しばらく更新されていません)"}</Note>
    </Panel>
  );
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

  const { sync, today, comparison, latest, sleep } = summary;
  const { sameTime, fullDay } = comparison;
  const lastFeedingAt = summary.feeding.last?.at ?? null;
  const feedingMinutes = lastFeedingAt ? minutesBetween(Date.parse(lastFeedingAt), now) : null;
  const feedingOverdue = feedingMinutes !== null && feedingMinutes >= summary.feeding.intervalMinutes;
  const lastDiaperAt = [summary.pee.lastAt, summary.poop.lastAt].filter(Boolean).sort().at(-1) ?? null;
  const perFeedingToday = today.feedingMlCount > 0 ? today.feedingMl / today.feedingMlCount : null;
  // 「今の時刻まで」は過去7日の同じ時刻までの平均、「1日」は過去7日の1日分の平均と比べる(2026-11-26 ユーザー確認)
  const upToNow = (pick: (m: DayMetrics) => number) => (sameTime ? pick(sameTime.average) : null);
  const perDay = (pick: (m: DayMetrics) => number) => (fullDay ? pick(fullDay.average) : null);
  const target = summary.feeding.dailyTargetMl;
  const targetNow = target === null ? null : targetUpToNow(target, upToNow((m) => m.feedingMl), perDay((m) => m.feedingMl), now);

  // 睡眠: 状況と時間、直前の時間、活動限界(2026-11-27 ユーザー)
  const sleepMinutes = sleep.since ? minutesBetween(Date.parse(sleep.since), now) : null;
  const awake = sleep.state === "awake" && sleepMinutes !== null;
  const activityLeft = awake ? sleep.activityLimitMinutes - sleepMinutes : null;
  const overLimit = activityLeft !== null && activityLeft <= 0;

  const countAvg = upToNow((m) => m.feedingCount);
  // 今日の値は1回だけ書き、「今の時刻までのふだん」(点線)と「1日の基準」(棒の右端)を重ねる(2026-11-27)
  const typicalNowMl = upToNow((m) => m.feedingMl);
  const feedingGoal = target ?? perDay((m) => m.feedingMl);
  const feedingPace = targetNow ?? typicalNowMl;
  const sleepGoal = perDay((m) => m.sleepMinutes);
  const sleepPace = upToNow((m) => m.sleepMinutes);
  const poopGoal = perDay((m) => m.poopCount);
  const poopPace = upToNow((m) => m.poopCount);

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

      <Panel
        title="授乳"
        className="piyolog-compact"
        tone={feedingOverdue ? "warn" : "normal"}
        aside={feedingMinutes !== null ? `${formatMinutes(feedingMinutes)}前` : "記録なし"}
      >
        <p className="piyolog-line">
          {summary.feeding.last
            ? `前回 ${timeOf(summary.feeding.last.at)}${summary.feeding.last.amountMl !== null ? ` ${formatMl(summary.feeding.last.amountMl)}` : ""}`
            : ""}
          {feedingOverdue && <strong className="piyolog-alert"> ⚠ 基準の{formatMinutes(summary.feeding.intervalMinutes)}を過ぎています</strong>}
        </p>
        <PaceBar
          label="今日の量"
          value={today.feedingMl}
          valueText={formatMl(today.feedingMl)}
          goal={feedingGoal !== null ? { value: feedingGoal, label: `${target !== null ? "1日の目安" : "ふだんの1日"} ${formatMl(feedingGoal)}` } : null}
          pace={feedingPace}
          behind={feedingPace !== null && isShort(today.feedingMl, feedingPace, "ml")}
        >
          {typicalNowMl !== null && (
            <>
              今の時刻のふだん {formatMl(typicalNowMl)} <Diff value={today.feedingMl} reference={typicalNowMl} unit="ml" />
            </>
          )}
          {targetNow !== null && (
            <>
              {" ・ "}目安 {formatMl(targetNow)} <Diff value={today.feedingMl} reference={targetNow} unit="ml" />
            </>
          )}
          {feedingGoal !== null && (
            <>
              <br />
              <Rest value={today.feedingMl} goal={feedingGoal} unit="ml" label={target !== null ? "1日の目安" : "ふだんの1日"} />
            </>
          )}
        </PaceBar>
        <p className="piyolog-line piyolog-line--muted">
          回数 {today.feedingCount}回{countAvg !== null && `(ふだん ${formatCount(countAvg)})`}
          {" ・ "}1回平均 {perFeedingToday !== null ? formatMl(perFeedingToday) : "—"}
          {comparison.perFeedingMl !== null && `(ふだん ${formatMl(comparison.perFeedingMl)})`}
        </p>
      </Panel>

      <Panel
        title="睡眠"
        className="piyolog-compact"
        tone={overLimit ? "warn" : "normal"}
        aside={
          sleep.state === "unknown" || sleepMinutes === null
            ? "記録なし"
            : `${sleep.state === "sleeping" ? "睡眠中" : "活動中"} ${formatMinutes(sleepMinutes)}`
        }
      >
        <p className="piyolog-line">
          {sleep.previousMinutes !== null && (
            <>
              {sleep.state === "sleeping" ? "直前の活動" : "直前の睡眠"} <strong>{formatMinutes(sleep.previousMinutes)}</strong>
            </>
          )}
          {activityLeft !== null &&
            (overLimit ? (
              <strong className="piyolog-alert"> ⚠ 活動限界を{formatMinutes(-activityLeft)}過ぎています</strong>
            ) : (
              <>
                {" ・ "}活動限界まであと<strong>{formatMinutes(activityLeft)}</strong>
              </>
            ))}
        </p>
        <PaceBar
          label="今日の睡眠"
          value={today.sleepMinutes}
          valueText={formatMinutes(today.sleepMinutes)}
          goal={sleepGoal !== null ? { value: sleepGoal, label: `ふだんの1日 ${formatMinutes(Math.round(sleepGoal))}` } : null}
          pace={sleepPace}
          behind={sleepPace !== null && isShort(today.sleepMinutes, sleepPace, "minutes")}
        >
          {sleepPace !== null && (
            <>
              今の時刻のふだん {formatMinutes(Math.round(sleepPace))} <Diff value={today.sleepMinutes} reference={sleepPace} unit="minutes" />
            </>
          )}
          {sleepGoal !== null && (
            <>
              {" ・ "}
              <Rest value={today.sleepMinutes} goal={sleepGoal} unit="minutes" label="ふだんの1日" />
            </>
          )}
        </PaceBar>
      </Panel>

      <Panel title="おむつ" className="piyolog-compact" aside={lastDiaperAt ? `${elapsedSince(lastDiaperAt, now)}前` : "記録なし"}>
        <p className="piyolog-line">
          うんち {timeOf(summary.poop.lastAt)} ・ おしっこ {timeOf(summary.pee.lastAt)}
        </p>
        <PaceBar
          label="今日のうんち"
          value={today.poopCount}
          valueText={formatCount(today.poopCount)}
          goal={poopGoal !== null ? { value: poopGoal, label: `ふだんの1日 ${formatCount(poopGoal)}` } : null}
          pace={poopPace}
        >
          {poopPace !== null && (
            <>
              今の時刻のふだん {formatCount(poopPace)} <Diff value={today.poopCount} reference={poopPace} unit="count" />
            </>
          )}
          <br />
          おしっこ(参考) {formatCount(today.peeCount)}
          {upToNow((m) => m.peeCount) !== null && `(今の時刻のふだん ${formatCount(upToNow((m) => m.peeCount)!)})`}
        </PaceBar>
      </Panel>

      <p className="note piyolog-footnote">
        {sameTime || fullDay
          ? `棒は今日の値。右端の太い線は1日の基準、点線は今の時刻までの基準(ふだん = 過去${fullDay?.days ?? 0}日の平均)。少ないと赤になります。`
          : "比べられる過去の記録が、まだありません。"}
        {target !== null && ` 授乳は設定の目安(1日 ${formatMl(target)})が基準で、今の時刻までの目安は、ふだんの飲み方の配分で割り振った値です。`}
      </p>

      {summary.room && <RoomPanel room={summary.room} now={now} />}

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

      <Panel title="今日・昨日・2日前">
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
          データの管理(取り込み・CSV・室温の設定の確認) ›
        </Link>
      </Panel>
    </div>
  );
}

export default function IkujiLogScreen(props: FeatureScreenProps) {
  if (props.subPath.startsWith("/data")) return <DataPage {...props} />;
  return <MainScreen {...props} />;
}
