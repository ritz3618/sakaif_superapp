/**
 * 通知の判定と文面(純粋な計算。テストで確認している)。
 * - 授乳: 最後の授乳(飲み始め)から、設定の間隔がたったら通知する。
 * - おむつ替え: 最後のおしっこ・うんちの記録から、設定の間隔がたったら通知する。
 * - 重複防止のキーを「最後の記録の event_id」にするので、次の記録が入るまで再通知しない。
 *   設定の間隔を変えても、送信済みの通知には影響しない(同じキーは二度と送らない)。
 * - フィードURLの期限: 作成日から89日を期限の目安とし、その7日前から1回だけ知らせる。
 */
import { addDays, jstDate, jstTime } from "../../../core/shared/time";
import { formatMinutes, formatMl, minutesBetween } from "../shared/format";
import { typeLabel } from "../shared/records";

export interface LastRecord {
  eventId: string;
  type: string;
  at: number;
  value: number | null;
  unit: string | null;
}

export interface Alert {
  type: "feeding_due" | "diaper_due" | "feed_expiring";
  dedupeKey: string;
  title: string;
  body: string;
}

export function feedingAlert(last: LastRecord | null, intervalMinutes: number, now: number): Alert | null {
  if (!last) return null;
  const elapsed = minutesBetween(last.at, now);
  if (elapsed < intervalMinutes) return null;
  const amount = last.value !== null && last.unit === "ml" ? formatMl(last.value) : null;
  const when = jstTime(new Date(last.at));
  return {
    type: "feeding_due",
    dedupeKey: `feeding:${last.eventId}`,
    title: `授乳から${formatMinutes(elapsed)}たちました`,
    body: amount ? `前回は${amount}(${when}に飲み始め)` : `前回は${when}に飲み始め`,
  };
}

export function diaperAlert(last: LastRecord | null, intervalMinutes: number, now: number): Alert | null {
  if (!last) return null;
  const elapsed = minutesBetween(last.at, now);
  if (elapsed < intervalMinutes) return null;
  return {
    type: "diaper_due",
    dedupeKey: `diaper:${last.eventId}`,
    title: `おむつ替えから${formatMinutes(elapsed)}たちました`,
    body: `最後の記録は${typeLabel(last.type)}(${jstTime(new Date(last.at))})`,
  };
}

/** 作成日(YYYY-MM-DD、日本時間)から、期限の目安(89日後)と残り日数を求める。 */
export function feedExpiry(createdOn: string, now: number): { expiresOn: string; daysLeft: number } {
  const expiresOn = addDays(createdOn, 89);
  const today = jstDate(new Date(now));
  const daysLeft = Math.round((Date.parse(`${expiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  return { expiresOn, daysLeft };
}

export function expiryAlert(createdOn: string | null, now: number): Alert | null {
  if (!createdOn) return null;
  const { expiresOn, daysLeft } = feedExpiry(createdOn, now);
  if (daysLeft > 7) return null;
  const [, m, d] = expiresOn.split("-").map(Number);
  return {
    type: "feed_expiring",
    dedupeKey: `feed-expiring:${createdOn}`,
    title: "フィードURLの期限が近づいています",
    body:
      daysLeft >= 0
        ? `期限の目安は${m}/${d}(あと${daysLeft}日)です。ぴよログでフィードを作り直し、設定で新しいURLを保存してください。`
        : `期限の目安(${m}/${d})を過ぎています。ぴよログでフィードを作り直し、設定で新しいURLを保存してください。`,
  };
}
