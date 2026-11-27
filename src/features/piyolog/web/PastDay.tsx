/**
 * 過去の日の画面(2026-11-27 ユーザー)。その日の0時〜24時の値を、その前の7日の平均や目安と比べる。
 * - 「1週間の過ごし方」(/week)と、その日のまとめ(/day)を別々に読み、届いた順に出す(帯は軽いので先に出る)。
 * - 一度読んだ日は覚えておき、表示した日の前日を先読みする(「前日」を押したときにすぐ出すため)。
 */
import { useEffect, useState, type ReactNode } from "react";
import { Note, PaceBar, Panel, Stat, StatGrid, type FeatureScreenProps } from "../../../core/web/feature-api";
import { addDays } from "../../../core/shared/time";
import type { PiyologDaySummary, PiyologWeek } from "../shared/api";
import { formatMinutes, formatMl } from "../shared/format";
import { isShort } from "./compare";
import { DayTimeline } from "./DayTimeline";
import { Diff, formatCount, Rest, RoomDayLine, ROOM_LABEL, VitalsPanel } from "./parts";

type ApiFetch = FeatureScreenProps["apiFetch"];

const dayCache = new Map<string, Promise<PiyologDaySummary>>();
const weekCache = new Map<string, Promise<PiyologWeek>>();

function cached<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  let p = cache.get(key);
  if (!p) {
    p = load();
    cache.set(key, p);
    p.catch(() => cache.delete(key)); // 失敗したものは覚えない
  }
  return p;
}

const loadDay = (apiFetch: ApiFetch, date: string) =>
  cached(dayCache, date, async () => (await (await apiFetch(`/day?date=${date}`)).json()) as PiyologDaySummary);
const loadWeek = (apiFetch: ApiFetch, date: string) =>
  cached(weekCache, date, async () => (await (await apiFetch(`/week?date=${date}`)).json()) as PiyologWeek);

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function DayPanels({ d }: { d: PiyologDaySummary }) {
  const { day, fullDay, dailyTargetMl: target } = d;
  const usual = fullDay?.average ?? null;
  const feedingGoal = target ?? usual?.feedingMl ?? null;
  const perFeeding = day.feedingMlCount > 0 ? day.feedingMl / day.feedingMlCount : null;
  return (
    <>
      <Panel title="授乳" className="piyolog-compact">
        <PaceBar
          label="この日の量"
          value={day.feedingMl}
          valueText={formatMl(day.feedingMl)}
          goal={feedingGoal !== null ? { value: feedingGoal, label: `${target !== null ? "1日の目安" : "ふだんの1日"} ${formatMl(feedingGoal)}` } : null}
          pace={null}
          behind={feedingGoal !== null && isShort(day.feedingMl, feedingGoal, "ml")}
        >
          {usual && (
            <>
              ふだんの1日 {formatMl(usual.feedingMl)} <Diff value={day.feedingMl} reference={usual.feedingMl} unit="ml" />
            </>
          )}
          {target !== null && (
            <>
              {" ・ "}
              <Rest value={day.feedingMl} goal={target} unit="ml" label="1日の目安" />
            </>
          )}
        </PaceBar>
        <p className="piyolog-line piyolog-line--muted">
          回数 {day.feedingCount}回{usual && `(ふだん ${formatCount(usual.feedingCount)})`}
          {" ・ "}1回平均 {perFeeding !== null ? formatMl(perFeeding) : "—"}
          {d.perFeedingMl !== null && `(ふだん ${formatMl(d.perFeedingMl)})`}
        </p>
      </Panel>

      <Panel title="睡眠" className="piyolog-compact">
        <PaceBar
          label="この日の睡眠"
          value={day.sleepMinutes}
          valueText={formatMinutes(day.sleepMinutes)}
          goal={usual ? { value: usual.sleepMinutes, label: `ふだんの1日 ${formatMinutes(Math.round(usual.sleepMinutes))}` } : null}
          pace={null}
          behind={usual !== null && isShort(day.sleepMinutes, usual.sleepMinutes, "minutes")}
        >
          {usual && (
            <>
              ふだんの1日より <Diff value={day.sleepMinutes} reference={usual.sleepMinutes} unit="minutes" />
            </>
          )}
        </PaceBar>
      </Panel>

      <Panel title="おむつ" className="piyolog-compact">
        <PaceBar
          label="この日のうんち"
          value={day.poopCount}
          valueText={formatCount(day.poopCount)}
          goal={usual ? { value: usual.poopCount, label: `ふだんの1日 ${formatCount(usual.poopCount)}` } : null}
          pace={null}
        >
          {usual && (
            <>
              ふだんの1日より <Diff value={day.poopCount} reference={usual.poopCount} unit="count" />
              <br />
            </>
          )}
          おしっこ(参考) {formatCount(day.peeCount)}
          {usual && `(ふだん ${formatCount(usual.peeCount)})`}
        </PaceBar>
      </Panel>

      <p className="note piyolog-footnote">
        {fullDay ? `ふだん = この日より前の${fullDay.days}日の、1日分の平均。` : "比べられる、この日より前の記録がありません。"}
      </p>

      <Panel title="室温・湿度">
        {d.room ? (
          <StatGrid>
            {(["temperature", "humidity"] as const).map((metric) => (
              <Stat key={metric} label={ROOM_LABEL[metric]} value={d.room?.[metric] ? `平均 ${d.room[metric]!.avg}${metric === "temperature" ? "℃" : "%"}` : "—"}>
                <RoomDayLine stats={d.room} metric={metric} showAvg={false} />
              </Stat>
            ))}
          </StatGrid>
        ) : (
          <Note>この日の値はありません。</Note>
        )}
      </Panel>

      <VitalsPanel latest={d.latest} now={null} title="この日までの最後の記録" />
    </>
  );
}

export function PastDayScreen({
  apiFetch,
  date,
  nav,
}: {
  apiFetch: ApiFetch;
  date: string;
  nav: ReactNode;
}) {
  const [day, setDay] = useState<PiyologDaySummary | null>(null);
  const [week, setWeek] = useState<PiyologWeek | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setDay(null);
    setWeek(null);
    setError(null);
    const w = loadWeek(apiFetch, date).then((v) => alive && setWeek(v));
    const d = loadDay(apiFetch, date).then((v) => alive && setDay(v));
    Promise.all([w, d])
      .then(() => {
        // 前日を先読みしておく(失敗しても表示には影響しない)
        const prev = addDays(date, -1);
        void loadWeek(apiFetch, prev).catch(() => undefined);
        void loadDay(apiFetch, prev).catch(() => undefined);
      })
      .catch((e: unknown) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [apiFetch, date]);

  return (
    <div className="piyolog-screen">
      {nav}
      {error && <Note tone="error">{error}</Note>}
      {day ? <DayPanels d={day} /> : !error && <Note>この日のまとめを読み込み中…</Note>}
      <Panel title="1週間の過ごし方">
        {week ? <DayTimeline days={week.days} relative={false} /> : <div className="piyolog-loading"><Note>読み込み中…</Note></div>}
      </Panel>
    </div>
  );
}
