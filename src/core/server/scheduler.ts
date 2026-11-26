/**
 * 定期実行の入口。Cron は1本(5分おき)だけ登録し、ここから各機能の処理を順に呼ぶ。
 * - 1つの機能が失敗しても、ほかの機能は止めない。
 * - 機能ごとに連続失敗の回数を記録し、決まった回数を超えたら、全員にエラー通知を送る。
 *   (受け取りたくない人は、設定の「エラー通知を受け取る」をオフにする)
 *   同じ失敗の続きでは1回だけ送る。通知を避ける時間帯の間は保留し、明けたときに送る。
 */
import type { RegisteredFeatureServer } from "./app";
import type { Env } from "./env";
import { kvSet } from "./kv";
import { CORE_ERROR_TYPE, CORE_FEATURE_ID, notify, pruneNotificationLog } from "./notify";
import { ownedSources, sharedData } from "./data";
import { featureSettings, type SettingsNamespace } from "./settings";

export const LAST_CRON_KEY = "last_cron_at";
export const DEFAULT_ALERT_AFTER_FAILURES = 6;

interface JobRow {
  consecutive_failures: number;
  streak_started_at: string | null;
}

async function recordSuccess(db: D1Database, featureId: string, at: string): Promise<void> {
  await db
    .prepare(
      "INSERT INTO core_job_runs (feature_id, consecutive_failures, streak_started_at, last_success_at, updated_at) " +
        "VALUES (?, 0, NULL, ?, ?) ON CONFLICT(feature_id) DO UPDATE SET consecutive_failures = 0, " +
        "streak_started_at = NULL, last_success_at = excluded.last_success_at, updated_at = excluded.updated_at",
    )
    .bind(featureId, at, at)
    .run();
}

async function recordFailure(db: D1Database, featureId: string, at: string, message: string): Promise<JobRow> {
  const row = await db
    .prepare(
      "INSERT INTO core_job_runs (feature_id, consecutive_failures, streak_started_at, last_failure_at, last_error, updated_at) " +
        "VALUES (?, 1, ?, ?, ?, ?) ON CONFLICT(feature_id) DO UPDATE SET " +
        "consecutive_failures = core_job_runs.consecutive_failures + 1, " +
        "streak_started_at = COALESCE(core_job_runs.streak_started_at, excluded.streak_started_at), " +
        "last_failure_at = excluded.last_failure_at, last_error = excluded.last_error, updated_at = excluded.updated_at " +
        "RETURNING consecutive_failures, streak_started_at",
    )
    .bind(featureId, at, at, message.slice(0, 500), at)
    .first<JobRow>();
  return row ?? { consecutive_failures: 1, streak_started_at: at };
}

export async function runScheduled(
  env: Env,
  scheduledTime: number,
  features: readonly RegisteredFeatureServer[],
  registry: readonly SettingsNamespace[],
): Promise<void> {
  const db = env.DB;
  const scheduledAt = new Date(scheduledTime);
  const deps = { db, registry };

  for (const { meta, server } of features) {
    if (!server.scheduled) continue;
    const started = Date.now();
    try {
      await server.scheduled.run({
        env,
        db,
        feature: meta,
        scheduledAt,
        settings: featureSettings(db, registry, meta.id),
        data: sharedData(db, ownedSources(meta)),
        notify: (request) => notify(deps, { ...request, featureId: meta.id }),
      });
      await recordSuccess(db, meta.id, new Date().toISOString());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[cron] ${meta.id} が失敗しました`, error);
      try {
        const row = await recordFailure(db, meta.id, new Date().toISOString(), message);
        const threshold = server.scheduled.alertAfterFailures ?? DEFAULT_ALERT_AFTER_FAILURES;
        if (row.consecutive_failures >= threshold) {
          await notify(deps, {
            featureId: CORE_FEATURE_ID,
            type: CORE_ERROR_TYPE,
            to: "all",
            dedupeKey: `job-failure:${meta.id}:${row.streak_started_at ?? ""}`,
            title: `「${meta.name}」の定期処理が失敗しています`,
            body: `${row.consecutive_failures}回続けて失敗しました。${message.slice(0, 80)}`,
            url: "/settings/",
            tag: `job-failure-${meta.id}`,
          });
        }
      } catch (alertError) {
        console.error(`[cron] ${meta.id} の失敗を記録できませんでした`, alertError);
      }
    } finally {
      console.log(`[cron] ${meta.id} ${Date.now() - started}ms`);
    }
  }

  // 1日1回(日本時間の3時台の最初の回)、古い通知の履歴を消す
  if (scheduledAt.getUTCHours() === 18 && scheduledAt.getUTCMinutes() < 5) {
    await pruneNotificationLog(db, scheduledAt);
  }
  // 定期実行が動いているかを、設定画面で確認できるように記録する。
  await kvSet(db, LAST_CRON_KEY, scheduledAt.toISOString());
}
