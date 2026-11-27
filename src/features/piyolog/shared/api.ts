/** 育児ログの画面とサーバーがやり取りするデータの型。時刻はすべて UTC の ISO 8601。 */

export interface DayMetrics {
  /** 授乳の回数(量の無い記録も含む) */
  feedingCount: number;
  /** 授乳の総量(ml) */
  feedingMl: number;
  /** 量(ml)が記録された授乳の回数(1回あたりの平均の計算に使う) */
  feedingMlCount: number;
  sleepMinutes: number;
  peeCount: number;
  poopCount: number;
}

/** 過去の日の平均。days は、平均に使えた日の数 */
export interface Comparison {
  days: number;
  average: DayMetrics;
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

/** 時刻の範囲。0時からの分(0〜1440) */
export interface MinuteSpan {
  start: number;
  end: number;
}

/** 時間の帯の表示に使う、1日分の記録(0時からの分) */
export interface TimelineDay {
  /** 日本時間の日付(YYYY-MM-DD) */
  date: string;
  /** 記録がある範囲の終わり(今日は今の時刻、過去の日は1440) */
  until: number;
  sleep: MinuteSpan[];
  awake: MinuteSpan[];
  /** 授乳の開始時刻と量 */
  feedings: { at: number; ml: number | null }[];
  /** うんちの時刻 */
  poops: number[];
}

export interface LatestValue {
  at: string;
  value: number | null;
  unit: string | null;
}

export interface PiyologSummary {
  /** フィードURLが保存されているか */
  configured: boolean;
  now: string;
  sync: SyncStatus;
  feeding: {
    last: { at: string; amountMl: number | null } | null;
    /** 授乳の基準の間隔(分)。これを過ぎたら、画面でも目立たせる */
    intervalMinutes: number;
    /** 1日の目安量(ml)。未設定なら null(過去7日の1日あたりの平均と比べる) */
    dailyTargetMl: number | null;
  };
  pee: { lastAt: string | null };
  poop: { lastAt: string | null };
  sleep: {
    /** 最後の記録が「寝る」なら sleeping、「起きる」なら awake */
    state: "sleeping" | "awake" | "unknown";
    since: string | null;
    lastSleepAt: string | null;
    lastWakeAt: string | null;
    /** 起きているなら直前の睡眠の長さ、寝ているなら直前の活動(起きていた時間)の長さ(分)。分からなければ null */
    previousMinutes: number | null;
    /** 活動限界(分)。起きている時間がこれを過ぎたら、画面で目立たせ、通知する */
    activityLimitMinutes: number;
  };
  /** 今日(日本時間の0時から今まで)の値 */
  today: DayMetrics;
  comparison: {
    /** 過去7日(昨日〜7日前)それぞれの「0時から、今と同じ時刻まで」の平均 */
    sameTime: Comparison | null;
    /** 過去7日(昨日〜7日前)の、1日分の平均 */
    fullDay: Comparison | null;
    /** 過去7日(昨日〜7日前)の、授乳1回あたりの平均量(ml) */
    perFeedingMl: number | null;
  };
  /** 最後に記録した、体温・体重・身長・お風呂 */
  latest: {
    temperature: LatestValue | null;
    weight: LatestValue | null;
    height: LatestValue | null;
    bath: LatestValue | null;
  };
  /**
   * 室温・湿度(共通データ "switchbot" の最新の値。室温・湿度の機能が保存している)。値が無ければ null。
   * warnings は、保存したときに基準と比べた結果。
   */
  room: {
    at: string;
    temperature: number | null;
    humidity: number | null;
    warnings: { metric: "temperature" | "humidity"; direction: "low" | "high"; threshold: number }[];
  } | null;
  /** 時間の帯の表示(今日、昨日、2日前の順) */
  timeline: TimelineDay[];
  /** フィードURLの期限の目安(作成日から89日) */
  expiry: { createdOn: string; expiresOn: string; daysLeft: number } | null;
}

/** データの管理の画面に出す情報 */
export interface PiyologDataInfo {
  configured: boolean;
  /** 保存している記録(削除の印が付いたものを除く) */
  stored: { count: number; earliestAt: string | null; latestAt: string | null };
  /** この時刻より後の記録は、フィードで取得しているので、テキストの取り込みでは扱わない(フィードの範囲が分からなければ null) */
  importCutoff: string | null;
  expiry: { createdOn: string; expiresOn: string; daysLeft: number } | null;
}

/** テキストの取り込み(1回の送信分)の結果 */
export interface ImportResult {
  /** この送信で扱った日付(最初と最後、YYYY-MM-DD) */
  firstDay: string;
  lastDay: string;
  /** 取り込みの対象になった記録の数 */
  received: number;
  /** フィードで取得済みの記録と一致したもの(そのまま残す) */
  matched: number;
  /** 書き込んだ(新しく追加、または内容が変わった)記録の数 */
  written: number;
  /** 前回の取り込みにあって、今回のテキストに無かったため、削除の印を付けた記録の数 */
  deleted: number;
  /** フィードで取得している期間に入るため、取り込まなかった記録の数 */
  ignored: number;
}
