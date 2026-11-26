/** 基準(下限・上限)との比較(サーバーと画面の両方で使う。テストで確認している)。 */
import type { Metric, Thresholds, Warning } from "./room-api";

export function evaluate(metric: Metric, value: number, t: Thresholds): Warning | null {
  const low = metric === "temperature" ? t.temperatureLow : t.humidityLow;
  const high = metric === "temperature" ? t.temperatureHigh : t.humidityHigh;
  if (low !== null && value < low) return { metric, direction: "low", value, threshold: low };
  if (high !== null && value > high) return { metric, direction: "high", value, threshold: high };
  return null;
}

export const METRIC_LABEL: Record<Metric, string> = { temperature: "室温", humidity: "湿度" };
export const METRIC_UNIT: Record<Metric, string> = { temperature: "℃", humidity: "%" };

/** 例: 「室温が18.5℃で、基準(20℃以上)を下回っています」 */
export function warningText(w: Warning): string {
  const unit = METRIC_UNIT[w.metric];
  return w.direction === "low"
    ? `${METRIC_LABEL[w.metric]}が${w.value}${unit}で、基準(${w.threshold}${unit}以上)を下回っています`
    : `${METRIC_LABEL[w.metric]}が${w.value}${unit}で、基準(${w.threshold}${unit}以下)を上回っています`;
}
