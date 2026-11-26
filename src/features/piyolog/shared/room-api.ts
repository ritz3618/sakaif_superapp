/** 室温・湿度(SwitchBot)の、画面とサーバーがやり取りするデータの型。時刻は UTC の ISO 8601。 */

export type Metric = "temperature" | "humidity";

export interface Thresholds {
  temperatureLow: number | null;
  temperatureHigh: number | null;
  humidityLow: number | null;
  humidityHigh: number | null;
}

export interface Warning {
  metric: Metric;
  direction: "low" | "high";
  value: number;
  threshold: number;
}

export interface RoomSummary {
  /** トークンとクライアントシークレットが保存されているか */
  configured: boolean;
  device: { name: string; type: string } | null;
  reading: { at: string; temperature: number; humidity: number } | null;
  warnings: Warning[];
  thresholds: Thresholds;
  sync: { lastSuccessAt: string | null; lastAttemptAt: string | null; lastError: string | null };
}

/** 温湿度計の確認(SwitchBot に登録されている機器の一覧) */
export interface DeviceCheck {
  devices: {
    name: string;
    type: string;
    /** 室温と湿度を読める種類か */
    isMeter: boolean;
    /** クラウド(サードパーティーサービス)が有効か */
    cloud: boolean | null;
    /** ハブにつながっているか */
    viaHub: boolean;
    /** ハブ本体か(Hub 2 などは、ハブ本体に温湿度のセンサーがある) */
    isHub: boolean;
  }[];
}
