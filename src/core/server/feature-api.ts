/**
 * 機能のサーバー側が使ってよい、共通部分の入口。
 * 機能のコード(src/features/<機能>/server.ts)は、core/server の中ではこのファイルだけを読み込む。
 */
import type { Hono } from "hono";
import type { FeatureMeta } from "../shared/feature";
import type { AppBindings, Env, User } from "./env";
import type { NotifyRequest } from "./notify";
import type { SendResult } from "./push/sender";

export type { AppBindings, Env, User } from "./env";
export type { NotifyRequest } from "./notify";
export { jstDate, jstStartOfDay, jstTime, nowIso } from "./time";

/** 画面からのリクエストを処理するときに渡される情報 */
export interface FeatureRequestContext {
  env: Env;
  db: D1Database;
  user: User;
  feature: FeatureMeta;
}

/** 定期実行(5分おき)のときに渡される情報 */
export interface FeatureJobContext {
  env: Env;
  db: D1Database;
  feature: FeatureMeta;
  /** この定期実行の予定時刻 */
  scheduledAt: Date;
  notify(request: NotifyRequest): Promise<SendResult[]>;
}

export interface FeatureServer {
  /** /api/f/<機能ID>/ の下に、この機能のAPIを追加する(ログイン済みのリクエストだけが届く)。 */
  routes?: (app: Hono<AppBindings>, feature: FeatureMeta) => void;
  /** ホームのカードに出す1行の要約 */
  homeSummary?: (ctx: FeatureRequestContext) => Promise<string | null>;
  /** 定期実行の処理。1つの機能が失敗しても、他の機能は止まらない。 */
  scheduled?: {
    run(ctx: FeatureJobContext): Promise<void>;
    /** 連続でこの回数だけ失敗したら、管理者に通知する(第2段階で実装) */
    alertAfterFailures?: number;
  };
}

/** 機能のサーバー側の宣言を書くための関数(型を付けるだけ)。 */
export function defineFeatureServer(server: FeatureServer): FeatureServer {
  return server;
}
