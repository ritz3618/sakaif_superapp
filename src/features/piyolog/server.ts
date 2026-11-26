/**
 * 育児ログ(ぴよログのデータを使う機能)のサーバー側。
 * - 5分おきにフィードを取得して保存し、授乳・おむつ替え・フィードの期限の通知を判定する。
 * - 画面用の API: GET /summary、POST /refresh(今すぐ取得)、GET /export.csv
 */
import { defineFeatureServer, featureContext, formatMinutesFromIso } from "./server/helpers";
import { readSyncState } from "./server/repo";
import { recordsToCsv } from "./server/csv";
import { buildSummary, feedConfig, runScheduledJob, syncFeed } from "./server/service";
import { DIAPER_TYPES, FEEDING_TYPES, PIYOLOG_SOURCE } from "./shared/records";

/** 手動の取得は、前回の試行から1分あける(ぴよログの推奨: 同じURLへは1分に1回程度まで) */
const MANUAL_REFRESH_INTERVAL_MS = 60 * 1000;

export default defineFeatureServer({
  routes(app) {
    app.get("/summary", async (c) => {
      const ctx = featureContext(c);
      return c.json(await buildSummary(ctx.db, ctx.data, ctx.settings, new Date()));
    });

    app.post("/refresh", async (c) => {
      const ctx = featureContext(c);
      const config = await feedConfig(ctx.settings);
      if (!config.url) return c.json({ error: "フィードURLが設定されていません" }, 400);
      const state = await readSyncState(ctx.db);
      const now = new Date();
      if (state.lastAttemptAt && now.getTime() - Date.parse(state.lastAttemptAt) < MANUAL_REFRESH_INTERVAL_MS) {
        return c.json(await buildSummary(ctx.db, ctx.data, ctx.settings, now));
      }
      try {
        await syncFeed(ctx.db, ctx.data, config.url, now);
      } catch {
        // 失敗の理由は、まとめの sync.lastError に入っている
      }
      return c.json(await buildSummary(ctx.db, ctx.data, ctx.settings, new Date()));
    });

    app.get("/export.csv", async (c) => {
      const ctx = featureContext(c);
      const csv = recordsToCsv(await ctx.data.query(PIYOLOG_SOURCE, { includeDeleted: true }));
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="ikuji-log-${stamp}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    });
  },

  /** ホームのカードの1行(例: 「授乳 2時間10分前・おむつ 45分前」) */
  async homeSummary(ctx) {
    const config = await feedConfig(ctx.settings);
    if (!config.url) return "フィードURLが未設定";
    const [feeding, diaper] = await Promise.all([
      ctx.data.latest(PIYOLOG_SOURCE, FEEDING_TYPES),
      ctx.data.latest(PIYOLOG_SOURCE, DIAPER_TYPES),
    ]);
    const now = Date.now();
    const part = (label: string, iso: string | undefined) =>
      iso ? `${label} ${formatMinutesFromIso(iso, now)}前` : `${label} 記録なし`;
    return `${part("授乳", feeding?.recordedAt)}・${part("おむつ", diaper?.recordedAt)}`;
  },

  scheduled: {
    // フィードの取得が6回(約30分)続けて失敗したら、エラー通知を送る(2-3 の決定)
    alertAfterFailures: 6,
    run: runScheduledJob,
  },
});
