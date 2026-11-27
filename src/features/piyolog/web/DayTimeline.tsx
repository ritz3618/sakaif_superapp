/**
 * 1週間(今日を含む7日分)の時間の帯(0〜24時)。
 * 寝ている時間と起きている時間を背景に、授乳(飲み始めから30分)とうんち(15分)を、帯の下半分に印として重ねる。
 * 色は web/piyolog.css の変数で決める。
 */
import { Timeline, type TimelineRow, type TimelineSegment } from "../../../core/web/feature-api";
import type { TimelineDay } from "../shared/api";
import { dateLabel } from "./DateNav";
import { minuteLabel, shortDate } from "./time";

/** 表示の幅(2026-11-26 ユーザー指定)。サーバーの stats.ts の値と同じ */
const FEEDING_SPAN = 30;
const POOP_SPAN = 15;

const COLORS = {
  sleep: "var(--piyolog-sleep)",
  awake: "var(--piyolog-awake)",
  feeding: "var(--piyolog-feeding)",
  poop: "var(--piyolog-poop)",
};

function toRow(day: TimelineDay, label: string, marker?: number): TimelineRow {
  const segments: TimelineSegment[] = [
    ...day.awake.map((s) => ({ ...s, color: COLORS.awake, title: `起きている ${minuteLabel(s.start)}〜${minuteLabel(s.end)}` })),
    ...day.sleep.map((s) => ({ ...s, color: COLORS.sleep, title: `睡眠 ${minuteLabel(s.start)}〜${minuteLabel(s.end)}` })),
    ...day.feedings.map((f) => ({
      start: f.at,
      end: Math.min(f.at + FEEDING_SPAN, 1440),
      color: COLORS.feeding,
      layer: "mark" as const,
      title: `授乳 ${minuteLabel(f.at)}${f.ml !== null ? ` ${Math.round(f.ml)}ml` : ""}`,
    })),
    ...day.poops.map((at) => ({
      start: at,
      end: Math.min(at + POOP_SPAN, 1440),
      color: COLORS.poop,
      layer: "mark" as const,
      title: `うんち ${minuteLabel(at)}`,
    })),
  ];
  return { label, segments, until: day.until, marker };
}

const dayLabel = (i: number) => (i === 0 ? "今日" : i === 1 ? "昨日" : `${i}日前`);

/**
 * relative: 今日を起点にした表示(「今日」「昨日」「2日前」…)。false なら、日付と曜日だけ(過去の日を起点にした表示)。
 */
export function DayTimeline({
  days,
  nowMinute,
  relative = true,
}: {
  days: readonly TimelineDay[];
  nowMinute?: number;
  relative?: boolean;
}) {
  const rows: TimelineRow[] = days.map((day, i) =>
    toRow(day, relative ? `${dayLabel(i)}\n${shortDate(day.date)}` : dateLabel(day.date).replace("(", "\n("), i === 0 ? nowMinute : undefined),
  );
  return (
    <div className="piyolog-timeline">
      <Timeline
        rows={rows}
        max={1440}
        ticks={[0, 360, 720, 1080, 1440]}
        tickLabel={(m) => `${m / 60}時`}
        legend={[
          { label: "睡眠", color: COLORS.sleep },
          { label: "起きている", color: COLORS.awake },
          { label: "授乳", color: COLORS.feeding },
          { label: "うんち", color: COLORS.poop },
        ]}
      />
    </div>
  );
}
