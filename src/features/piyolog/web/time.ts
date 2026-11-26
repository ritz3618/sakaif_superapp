/** 画面での日時の書き方 */
import { jstDate, jstDateTimeLabel, jstTime } from "../../../core/shared/time";

/** 今日(日本時間)なら時刻だけ、それ以外は日付も付ける。null なら「—」 */
export function timeOf(iso: string | null): string {
  if (!iso) return "—";
  const at = new Date(iso);
  return jstDate(at) === jstDate(new Date()) ? jstTime(at) : jstDateTimeLabel(at);
}

/** YYYY-MM-DD を M/D に */
export function shortDate(day: string): string {
  const [, m, d] = day.split("-");
  return `${Number(m)}/${Number(d)}`;
}

/** 0時からの分を H:MM に */
export function minuteLabel(minute: number): string {
  return `${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, "0")}`;
}
