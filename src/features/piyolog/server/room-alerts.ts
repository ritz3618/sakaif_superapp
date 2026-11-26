/**
 * 通知の判定(純粋な計算。テストで確認している)。
 * - 最新の値が基準の外で、同じ向き(下回る・上回る)の状態が「通知するまでの時間」以上続いていたら通知する。
 * - 同じ状態が続く間は1回だけ(重複防止のキーに、その状態が始まった時刻を使う)。いったん基準の中に戻れば、次はまた通知する。
 */
import type { Metric, Thresholds } from "../shared/room-api";
import { evaluate, warningText } from "../shared/room-thresholds";

export interface Reading {
  at: number;
  value: number;
}

/** 通知の判定に使う値の新しさの上限(これより古い値では通知しない) */
export const MAX_READING_AGE_MS = 15 * 60 * 1000;

export interface RoomAlert {
  type: "room_temperature_out" | "room_humidity_out";
  dedupeKey: string;
  title: string;
  body: string;
}

export function roomAlert(
  metric: Metric,
  readings: readonly Reading[],
  thresholds: Thresholds,
  afterMinutes: number,
  now: number,
): RoomAlert | null {
  const sorted = [...readings].sort((a, b) => a.at - b.at);
  const latest = sorted.at(-1);
  if (!latest || now - latest.at > MAX_READING_AGE_MS) return null;
  const warning = evaluate(metric, latest.value, thresholds);
  if (!warning) return null;
  let start = latest.at;
  for (let i = sorted.length - 2; i >= 0; i--) {
    const w = evaluate(metric, sorted[i]!.value, thresholds);
    if (!w || w.direction !== warning.direction) break;
    start = sorted[i]!.at;
  }
  const minutes = Math.floor((now - start) / 60_000);
  if (minutes < afterMinutes) return null;
  const label = metric === "temperature" ? "室温" : "湿度";
  const direction = warning.direction === "low" ? "低くなっています" : "高くなっています";
  return {
    type: metric === "temperature" ? "room_temperature_out" : "room_humidity_out",
    dedupeKey: `room:${metric}:${warning.direction}:${new Date(start).toISOString()}`,
    title: `${label}が${direction}`,
    body: afterMinutes > 0 ? `${warningText(warning)}(${minutes}分続いています)` : warningText(warning),
  };
}

/** 通知する対象の設定から、通知する種類を決める */
export function alertMetrics(target: string): Metric[] {
  if (target === "temperature") return ["temperature"];
  if (target === "humidity") return ["humidity"];
  if (target === "both") return ["temperature", "humidity"];
  return [];
}
