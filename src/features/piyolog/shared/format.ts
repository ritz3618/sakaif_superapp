/** 時間や量の表示の書き方(通知、ホームのカード、画面で共通)。 */

/** 分を「4時間10分」「45分」「4時間」の形にする。 */
export function formatMinutes(totalMinutes: number): string {
  const m = Math.max(0, Math.floor(totalMinutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest}分`;
  return rest === 0 ? `${h}時間` : `${h}時間${rest}分`;
}

/** 2つの時刻(ミリ秒)の間の分 */
export function minutesBetween(fromMs: number, toMs: number): number {
  return Math.floor((toMs - fromMs) / 60000);
}

/** 量(ml)。小数は丸める。 */
export function formatMl(ml: number): string {
  return `${Math.round(ml)}ml`;
}
