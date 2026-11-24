/**
 * 定期実行の入口。Cron は1本(5分おき)だけ登録し、ここから各機能の処理を順に呼ぶ。
 * 1つの機能が失敗しても、ほかの機能は止めない。
 * 第2段階で、機能ごとの連続失敗回数の記録と、管理者へのエラー通知を足す。
 */
import type { RegisteredFeatureServer } from "./app";
import type { Env } from "./env";
import { kvSet } from "./kv";
import { notify } from "./notify";

export const LAST_CRON_KEY = "last_cron_at";

export async function runScheduled(
  env: Env,
  scheduledTime: number,
  features: readonly RegisteredFeatureServer[],
): Promise<void> {
  const scheduledAt = new Date(scheduledTime);
  for (const { meta, server } of features) {
    if (!server.scheduled) continue;
    const started = Date.now();
    try {
      await server.scheduled.run({
        env,
        db: env.DB,
        feature: meta,
        scheduledAt,
        notify: (request) => notify(env.DB, request),
      });
    } catch (error) {
      console.error(`[cron] ${meta.id} が失敗しました`, error);
    } finally {
      console.log(`[cron] ${meta.id} ${Date.now() - started}ms`);
    }
  }
  // 定期実行が動いているかを、設定画面の「端末チェック」で確認できるように記録する。
  await kvSet(env.DB, LAST_CRON_KEY, scheduledAt.toISOString());
}
