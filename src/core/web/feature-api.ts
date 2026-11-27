/**
 * 機能の画面側が使ってよい、共通部分の入口。
 * 機能のコード(src/features/<機能>/web.tsx)は、core/web の中ではこのファイルだけを読み込む。
 */
import type { ComponentType } from "react";
import type { FeatureMeta } from "../shared/feature";

export { Link, navigate } from "./router";
export { ApiError } from "./api";
/** 共通の見た目の部品(これを使うと、アプリ全体の見た目のテイストがそろう) */
export {
  BigValue,
  Button,
  CompareTable,
  FileButton,
  Note,
  PaceBar,
  Panel,
  Stat,
  StatGrid,
  Timeline,
  Trend,
  type CompareRow,
  type TimelineRow,
  type TimelineSegment,
  type Tone,
  type TrendDirection,
} from "./ui";

export interface FeatureScreenProps {
  feature: FeatureMeta;
  /** この機能のAPI(/api/f/<機能ID>/...)を呼ぶ。path は "/summary" のように書く。 */
  apiFetch(path: string, init?: RequestInit): Promise<Response>;
  /** 機能の中でのパス("/<機能ID>/graph/" なら "/graph/") */
  subPath: string;
}

export type FeatureScreen = ComponentType<FeatureScreenProps>;
/** 共通のグラフ部品(棒グラフ・折れ線グラフ) */
export { BarChart, LineChart, type BarChartProps, type LineChartProps, type LinePoint } from "./charts";
