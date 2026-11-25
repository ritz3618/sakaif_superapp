/**
 * 日時の扱いを1か所にまとめる。保存はUTCのISO 8601、表示と「1日」の区切りは日本時間(JST、UTC+9)。
 * 日本には夏時間がないため、固定の+9時間で計算する。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 保存用の現在時刻(UTCのISO 8601) */
export function nowIso(now: Date = new Date()): string {
  return now.toISOString();
}

/** 日本時間の日付(YYYY-MM-DD) */
export function jstDate(at: Date): string {
  return new Date(at.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 日本時間の 0:00 を表す Date(UTC) */
export function jstStartOfDay(at: Date): Date {
  const day = jstDate(at);
  return new Date(Date.parse(`${day}T00:00:00Z`) - JST_OFFSET_MS);
}

/** 日本時間の 0時からの分(0〜1439) */
export function jstMinuteOfDay(at: Date): number {
  const shifted = new Date(at.getTime() + JST_OFFSET_MS);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/** 日本時間の HH:MM */
export function jstTime(at: Date): string {
  return new Date(at.getTime() + JST_OFFSET_MS).toISOString().slice(11, 16);
}
