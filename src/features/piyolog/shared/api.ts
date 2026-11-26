/** 育児ログの画面とサーバーがやり取りするデータの型。時刻はすべて UTC の ISO 8601。 */

export interface DayMetrics {
  feedingCount: number;
  feedingMl: number;
  sleepMinutes: number;
  peeCount: number;
  poopCount: number;
}

export interface SyncStatus {
  /** 最後に取得に成功した時刻 */
  lastSuccessAt: string | null;
  /** 最後に試した時刻と、その結果 */
  lastAttemptAt: string | null;
  lastAttemptOk: boolean | null;
  /** 失敗したときの理由(URL は含めない) */
  lastError: string | null;
}

export interface PiyologSummary {
  /** フィードURLが保存されているか */
  configured: boolean;
  now: string;
  sync: SyncStatus;
  feeding: {
    last: { at: string; amountMl: number | null } | null;
  };
  pee: { lastAt: string | null };
  poop: { lastAt: string | null };
  sleep: {
    /** 最後の記録が「寝る」なら sleeping、「起きる」なら awake */
    state: "sleeping" | "awake" | "unknown";
    since: string | null;
    lastSleepAt: string | null;
    lastWakeAt: string | null;
  };
  /** 今日(日本時間の0時から今まで)の値 */
  today: DayMetrics;
  /** 過去7日の「同じ時刻まで」の平均。比較できる日が無ければ null */
  comparison: { days: number; average: DayMetrics } | null;
  /** フィードURLの期限の目安(作成日から89日) */
  expiry: { createdOn: string; expiresOn: string; daysLeft: number } | null;
}
