/** Worker が受け取る設定とバインディング。秘密情報はここに値を書かず、Cloudflare 側で設定する。 */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** "access"(本番、Cloudflare Access)または "dev"(ローカル開発のみ) */
  AUTH_MODE?: string;
  /** 例: https://<チーム名>.cloudflareaccess.com(ダッシュボードの変数で設定) */
  ACCESS_TEAM_DOMAIN?: string;
  /** Access アプリケーションの AUD タグ(ダッシュボードの変数で設定) */
  ACCESS_AUD?: string;
  /** dev モードで使うメールアドレス(.dev.vars でのみ設定) */
  DEV_USER_EMAIL?: string;
}

export interface User {
  id: number;
  email: string;
  displayName: string | null;
}

/** Hono に渡す型 */
export interface AppBindings {
  Bindings: Env;
  Variables: { user: User };
}
