/**
 * 機能の画面側が使ってよい、共通部分の入口。
 * 機能のコード(src/features/<機能>/web.tsx)は、core/web の中ではこのファイルだけを読み込む。
 */
import type { ComponentType } from "react";
import type { FeatureMeta } from "../shared/feature";

export { Link, navigate } from "./router";
export { ApiError } from "./api";

export interface FeatureScreenProps {
  feature: FeatureMeta;
  /** この機能のAPI(/api/f/<機能ID>/...)を呼ぶ。path は "/summary" のように書く。 */
  apiFetch(path: string, init?: RequestInit): Promise<Response>;
  /** 機能の中でのパス("/piyolog/graph/" なら "/graph/") */
  subPath: string;
}

export type FeatureScreen = ComponentType<FeatureScreenProps>;
