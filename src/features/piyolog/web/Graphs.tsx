/**
 * グラフの画面(/<機能ID>/graphs/、2026-11-27 ユーザー決定)。
 * - 期間: 日ごと(直近4週)・週ごと(直近12週)・月ごと(直近12か月)。「‹ ›」で過去にずらせる。週・月は1日あたりの平均。
 * - 1つのグラフに1つの値(単位の違う値を重ねない)。押すと、その区切りの値が全部のグラフに出る。
 *   日ごとのときは、その日の育児ログ(過去の日の表示)に移れる。
 * - サーバーの集計が途中(pending)なら、少し待って読み直す。
 */
import { useEffect, useState } from "react";
import { BarChart, Button, LineChart, Link, Note, Panel, type FeatureScreenProps, type LinePoint } from "../../../core/web/feature-api";
import { DAY_MS, addDays, jstDate, jstDayStart } from "../../../core/shared/time";
import { CHART_UNITS, type ChartBucket, type ChartData, type ChartPoint, type ChartUnit } from "../shared/charts-api";
import { formatMinutes, formatMl } from "../shared/format";

type ApiFetch = FeatureScreenProps["apiFetch"];

const cache = new Map<string, ChartData>();

/** 期間を1つ分ずらす(dir: -1 で過去へ) */
function shiftEnd(unit: ChartUnit, end: string, dir: -1 | 1, today: string): string {
  let next: string;
  if (unit === "day") next = addDays(end, 28 * dir);
  else if (unit === "week") next = addDays(end, 84 * dir);
  else {
    const [y, m] = end.split("-").map(Number) as [number, number];
    next = new Date(Date.UTC(y, m - 1 + 12 * dir + 1, 0)).toISOString().slice(0, 10); // 12か月ずらした月の末日
  }
  return next > today ? today : next;
}

const md = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
const oneDecimal = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
/** 分を「3:10」の形に(目盛り用) */
const hm = (v: number) => `${Math.floor(Math.round(v) / 60)}:${String(Math.round(v) % 60).padStart(2, "0")}`;

/** 記録の時刻を、横の位置(区切り i の中なら i〜i+1)にする */
function positionOf(at: string, buckets: readonly ChartBucket[]): number | null {
  const t = Date.parse(at);
  for (let i = 0; i < buckets.length; i++) {
    const start = jstDayStart(buckets[i]!.from).getTime();
    const end = jstDayStart(buckets[i]!.to).getTime() + DAY_MS;
    if (t >= start && t < end) return i + (t - start) / (end - start);
  }
  return null;
}

function pointsOf(list: readonly ChartPoint[], buckets: readonly ChartBucket[]): LinePoint[] {
  return list.flatMap((p) => {
    const x = positionOf(p.at, buckets);
    return x === null ? [] : [{ x, y: p.value }];
  });
}

/** 区切り i の中の最後の点の値 */
function lastIn(list: readonly ChartPoint[], buckets: readonly ChartBucket[], i: number): number | null {
  const inside = list.filter((p) => {
    const x = positionOf(p.at, buckets);
    return x !== null && Math.floor(x) === i;
  });
  return inside.at(-1)?.value ?? null;
}

export default function GraphsPage({ apiFetch, feature }: Pick<FeatureScreenProps, "apiFetch" | "feature">) {
  const today = jstDate(new Date());
  const [unit, setUnit] = useState<ChartUnit>("day");
  const [end, setEnd] = useState(today);
  const [data, setData] = useState<ChartData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const key = `${unit}:${end}`;
    setSelected(null);
    setError(null);
    setData(cache.get(key) ?? null);
    const load = async (tries: number): Promise<void> => {
      try {
        const res = await apiFetch(`/charts?unit=${unit}&end=${end}`);
        const next = (await res.json()) as ChartData;
        if (!alive) return;
        if (next.pending === 0) cache.set(key, next);
        setData(next);
        // 集計が途中なら、少し待って読み直す
        if (next.pending > 0 && tries < 30) window.setTimeout(() => alive && void load(tries + 1), 300);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void load(0);
    return () => {
      alive = false;
    };
  }, [apiFetch, unit, end]);

  const buckets = data?.buckets ?? [];
  const labels = buckets.map((b) => b.label);
  const common = { labels, selected, onSelect: setSelected };
  const values = (pick: (b: ChartBucket) => number | null) => buckets.map(pick);
  const partial = buckets.map((b) => b.partial);
  const sel = selected !== null ? buckets[selected] : undefined;
  const roomPoints = (metric: "temperature" | "humidity") =>
    buckets.flatMap((b, i) => (b[metric] ? [{ x: i + 0.5, y: b[metric]!.avg }] : []));
  const roomBand = (metric: "temperature" | "humidity") =>
    buckets.flatMap((b, i) => (b[metric] ? [{ x: i + 0.5, lo: b[metric]!.min, hi: b[metric]!.max }] : []));
  const roomValue = (metric: "temperature" | "humidity", unitText: string) => (i: number) => {
    const v = buckets[i]?.[metric];
    return v ? `平均 ${v.avg}${unitText}(${v.min}〜${v.max})` : null;
  };
  const first = buckets[0];
  const last = buckets.at(-1);

  return (
    <div className="piyolog-screen">
      <Link href={`/${feature.id}/`} className="piyolog-back">
        ‹ 育児ログに戻る
      </Link>

      <div className="piyolog-graphnav">
        <div className="piyolog-segment" role="tablist" aria-label="期間の単位">
          {CHART_UNITS.map((u) => (
            <button
              key={u.unit}
              type="button"
              role="tab"
              aria-selected={unit === u.unit}
              className={unit === u.unit ? "piyolog-segment__on" : undefined}
              onClick={() => {
                setUnit(u.unit);
                setEnd(today);
              }}
            >
              {u.label}
            </button>
          ))}
        </div>
        <div className="piyolog-graphnav__range">
          <Button variant="secondary" size="small" aria-label="前の期間" onClick={() => setEnd(shiftEnd(unit, end, -1, today))}>
            ‹
          </Button>
          <span>{first && last ? `${md(first.from)}〜${md(last.to)}` : "—"}</span>
          <Button variant="secondary" size="small" aria-label="次の期間" disabled={end >= today} onClick={() => setEnd(shiftEnd(unit, end, 1, today))}>
            ›
          </Button>
        </div>
      </div>

      {error && <Note tone="error">{error}</Note>}
      {!data && !error && <Note>読み込み中…</Note>}
      {data && data.pending > 0 && <Note>集計中です(残り{data.pending}日分)。少しずつ表示が増えます。</Note>}
      {sel && unit === "day" && (
        <Link href={`/${feature.id}/?date=${sel.from}`} className="piyolog-link">
          {md(sel.from)} の育児ログを見る ›
        </Link>
      )}

      {data && (
        <>
          <Panel title="授乳">
            <BarChart
              {...common}
              title={unit === "day" ? "ミルクの量(ml)" : "ミルクの量(ml、1日平均)"}
              values={values((b) => b.feedingMl)}
              partial={partial}
              reference={data.dailyTargetMl !== null ? { value: data.dailyTargetMl, label: `目安 ${formatMl(data.dailyTargetMl)}` } : null}
              format={(v) => formatMl(v)}
              tick={(v) => String(Math.round(v))}
            />
            <BarChart
              {...common}
              title={unit === "day" ? "授乳の回数" : "授乳の回数(1日平均)"}
              values={values((b) => b.feedingCount)}
              partial={partial}
              format={(v) => `${oneDecimal(v)}回`}
              tick={oneDecimal}
            />
            <LineChart
              {...common}
              title="授乳の間隔(平均、時:分)"
              points={buckets.flatMap((b, i) => (b.feedingIntervalMinutes !== null ? [{ x: i + 0.5, y: b.feedingIntervalMinutes }] : []))}
              format={hm}
              valueAt={(i) => (buckets[i]?.feedingIntervalMinutes != null ? formatMinutes(buckets[i]!.feedingIntervalMinutes!) : null)}
            />
          </Panel>

          <Panel title="睡眠">
            <BarChart
              {...common}
              title={unit === "day" ? "睡眠時間" : "睡眠時間(1日平均)"}
              values={values((b) => (b.sleepMinutes === null ? null : b.sleepMinutes / 60))}
              partial={partial}
              format={(v) => formatMinutes(Math.round(v * 60))}
              tick={(v) => `${oneDecimal(v)}h`}
            />
          </Panel>

          <Panel title="おむつ">
            <BarChart
              {...common}
              title={unit === "day" ? "うんちの回数" : "うんちの回数(1日平均)"}
              values={values((b) => b.poopCount)}
              partial={partial}
              format={(v) => `${oneDecimal(v)}回`}
              tick={oneDecimal}
            />
            <BarChart
              {...common}
              title={unit === "day" ? "おしっこの回数(参考)" : "おしっこの回数(参考・1日平均)"}
              values={values((b) => b.peeCount)}
              partial={partial}
              format={(v) => `${oneDecimal(v)}回`}
              tick={oneDecimal}
            />
          </Panel>

          <Panel title="成長と体温">
            <LineChart
              {...common}
              title="体重(kg)"
              points={pointsOf(data.weight, buckets)}
              format={(v) => oneDecimal(Math.round(v * 10) / 10)}
              valueAt={(i) => {
                const v = lastIn(data.weight, buckets, i);
                return v === null ? null : `${v.toFixed(2)}kg`;
              }}
            />
            <LineChart
              {...common}
              title="身長(cm)"
              points={pointsOf(data.height, buckets)}
              format={(v) => `${oneDecimal(v)}`}
              valueAt={(i) => {
                const v = lastIn(data.height, buckets, i);
                return v === null ? null : `${v.toFixed(1)}cm`;
              }}
            />
            <LineChart
              {...common}
              title="体温(℃)"
              points={pointsOf(data.temperature, buckets)}
              format={(v) => v.toFixed(1)}
              valueAt={(i) => {
                const v = lastIn(data.temperature, buckets, i);
                return v === null ? null : `${v.toFixed(1)}℃`;
              }}
            />
          </Panel>

          <Panel title="室温・湿度">
            <LineChart
              {...common}
              title="室温(℃、平均と最低〜最高の帯)"
              points={roomPoints("temperature")}
              band={roomBand("temperature")}
              format={(v) => `${oneDecimal(v)}`}
              valueAt={roomValue("temperature", "℃")}
            />
            <LineChart
              {...common}
              title="湿度(%、平均と最低〜最高の帯)"
              points={roomPoints("humidity")}
              band={roomBand("humidity")}
              format={(v) => `${Math.round(v)}`}
              valueAt={roomValue("humidity", "%")}
            />
          </Panel>

          <p className="note piyolog-footnote">
            {unit === "day"
              ? "今日の棒は途中なので、薄く表示しています。棒や点を押すと、その日の値が出ます。"
              : "週ごと・月ごとの量・回数・睡眠は、記録がそろった日の1日あたりの平均です(今日は入れません)。"}
          </p>

          <details className="piyolog-table">
            <summary>数値の一覧(表)</summary>
            <table>
              <thead>
                <tr>
                  <th>期間</th>
                  <th>ミルク</th>
                  <th>回数</th>
                  <th>睡眠</th>
                  <th>うんち</th>
                </tr>
              </thead>
              <tbody>
                {[...buckets].reverse().map((b) => (
                  <tr key={b.from}>
                    <th>{b.from === b.to ? md(b.from) : `${md(b.from)}〜${md(b.to)}`}</th>
                    <td>{b.feedingMl !== null ? formatMl(b.feedingMl) : "—"}</td>
                    <td>{b.feedingCount !== null ? oneDecimal(b.feedingCount) : "—"}</td>
                    <td>{b.sleepMinutes !== null ? formatMinutes(Math.round(b.sleepMinutes)) : "—"}</td>
                    <td>{b.poopCount !== null ? oneDecimal(b.poopCount) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </div>
  );
}
