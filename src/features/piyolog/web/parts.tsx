/** 育児ログの画面の部品(今日の画面と、過去の日の画面で共通) */
import { Stat, StatGrid, Panel, Trend } from "../../../core/web/feature-api";
import type { LatestValue, PiyologSummary, RoomDayStats } from "../shared/api";
import { formatMinutes, formatMl, minutesBetween } from "../shared/format";
import { compare, type CompareUnit } from "./compare";
import { timeOf } from "./time";

export function elapsedSince(iso: string | null, now: number): string | null {
  return iso ? formatMinutes(minutesBetween(Date.parse(iso), now)) : null;
}

export const formatCount = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}回`;

export function formatBy(unit: CompareUnit, value: number): string {
  if (unit === "ml") return formatMl(value);
  if (unit === "minutes") return formatMinutes(Math.round(value));
  return formatCount(value);
}

/** 差の表示(例: 「+26ml ↑」)。数値そのものを比べる */
export function Diff({ value, reference, unit }: { value: number; reference: number; unit: CompareUnit }) {
  const c = compare(value, reference, unit);
  return <Trend direction={c.direction}>{c.diffText}</Trend>;
}

/** 1日の基準まで、あといくつか(届いていれば「到達」) */
export function Rest({ value, goal, unit, label }: { value: number; goal: number; unit: CompareUnit; label: string }) {
  const c = compare(value, goal, unit);
  if (c.direction !== "less") return <>{label}に到達</>;
  return (
    <>
      {label}まで あと<strong>{formatBy(unit, goal - value)}</strong>
    </>
  );
}

const UNIT_LABELS: Record<string, string> = { celsius: "℃", kg: "kg", cm: "cm", ml: "ml" };

export function formatLatest(v: LatestValue | null, digits: number): string {
  if (!v || v.value === null) return "記録なし";
  return `${v.value.toFixed(digits)}${v.unit ? (UNIT_LABELS[v.unit] ?? v.unit) : ""}`;
}

export const ROOM_LABEL = { temperature: "室温", humidity: "湿度" } as const;
export const ROOM_UNIT = { temperature: "℃", humidity: "%" } as const;


/** 室温・湿度の、1日の最低・最高・平均(1行) */
export function RoomDayLine({
  stats,
  metric,
  showAvg = true,
}: {
  stats: RoomDayStats | null;
  metric: "temperature" | "humidity";
  showAvg?: boolean;
}) {
  const v = stats?.[metric];
  if (!v) return null;
  const u = ROOM_UNIT[metric];
  return (
    <span className="piyolog-roomday">
      {`最低 ${v.min}${u} / 最高 ${v.max}${u}`}
      {showAvg && ` / 平均 ${v.avg}${u}`}
    </span>
  );
}

/** 体温・体重・身長・お風呂の最後の記録 */
export function VitalsPanel({
  latest,
  now,
  title,
}: {
  latest: PiyologSummary["latest"];
  /** 経過時間(「○時間前」)の基準。過去の日の表示では出さないので null */
  now: number | null;
  title: string;
}) {
  return (
    <Panel title={title}>
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
          {latest.bath && now !== null && <span className="note">{elapsedSince(latest.bath.at, now)}前</span>}
        </Stat>
      </StatGrid>
    </Panel>
  );
}
