/**
 * 機能のサーバー側が使ってよい、共通部分の入口。
 * 機能のコード(src/features/<機能>/server.ts)は、core/server の中ではこのファイルだけを読み込む。
 */
import type { Context, Hono } from "hono";
import type { FeatureMeta } from "../shared/feature";
import type { AppBindings, Env, User } from "./env";
import type { NotifyRequest, NotifyUserResult } from "./notify";
import type { FeatureSettings } from "./settings";

export type { AppBindings, Env, User } from "./env";
export type { NotifyRequest, NotifyUserResult, NotifyOutcome } from "./notify";
export type { FeatureSettings } from "./settings";
export { jstDate, jstMinuteOfDay, jstStartOfDay, jstTime, nowIso } from "./time";

/** 画面からのリクエストを処理するときに渡される情報 */
export interface FeatureRequestContext {
  env: Env;
  db: D1Database;
  user: User;
  feature: FeatureMeta;
  /** この機能の設定(feature.ts の settings で宣言したもの) */
  settings: FeatureSettings;
}

/** 定期実行(5分おき)のときに渡される情報 */
export interface FeatureJobContext {
  env: Env;
  db: D1Database;
  feature: FeatureMeta;
  /** この定期実行の予定時刻 */
  scheduledAt: Date;
  settings: FeatureSettings;
  /**
   * 通知を送る。オン/オフ、通知を避ける時間帯、重複防止、履歴は共通部分が処理する。
   * 時間帯の間は送られず outcome が "deferred_quiet" になる。次の定期実行で同じ判定をすれば、明けたときに送られる。
   */
  notify(request: NotifyRequest): Promise<NotifyUserResult[]>;
}

export interface FeatureServer {
  /**
   * /api/f/<機能ID>/ の下に、この機能のAPIを追加する(ログイン済みのリクエストだけが届く)。
   * ハンドラーの中では c.get("user") でログイン中のユーザーを取れる。
   * 設定は featureContext(c) で取る。
   */
  routes?: (app: Hono<AppBindings>, feature: FeatureMeta) => void;
  /** ホームのカードに出す1行の要約 */
  homeSummary?: (ctx: FeatureRequestContext) => Promise<string | null>;
  /** 定期実行の処理。1つの機能が失敗しても、他の機能は止まらない。 */
  scheduled?: {
    run(ctx: FeatureJobContext): Promise<void>;
    /** 連続でこの回数だけ失敗したら、エラー通知を送る(既定は6回 = 約30分) */
    alertAfterFailures?: number;
  };
}

/** 機能のAPIのハンドラーの中で、ログイン中のユーザー・設定などをまとめて取り出す。 */
export function featureContext(c: Context<AppBindings>): FeatureRequestContext {
  return c.get("featureContext") as FeatureRequestContext;
}

/** 機能のサーバー側の宣言を書くための関数(型を付けるだけ)。 */
export function defineFeatureServer(server: FeatureServer): FeatureServer {
  return server;
}
