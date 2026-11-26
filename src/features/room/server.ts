/**
 * 室温・湿度(SwitchBot の温湿度計)のサーバー側。
 * - 5分おきに室温と湿度を読んで共通データに保存し、基準の外になったら通知する(通知は初期値オフ)。
 * - 画面用の API: GET /summary、POST /refresh(今すぐ読む)、GET /devices(温湿度計の確認)
 */
import { defineFeatureServer, featureContext } from "../../core/server/feature-api";
import { readState } from "./server/repo";
import { buildSummary, checkDevices, fetchReading, runScheduledJob, SWITCHBOT_SOURCE } from "./server/service";
import { SwitchBotError } from "./server/switchbot";

/** 手動の取得は、前回の試行から1分あける */
const MANUAL_REFRESH_INTERVAL_MS = 60 * 1000;

export default defineFeatureServer({
  routes(app) {
    app.get("/summary", async (c) => {
      const ctx = featureContext(c);
      return c.json(await buildSummary(ctx.db, ctx.data, ctx.settings, new Date()));
    });

    app.post("/refresh", async (c) => {
      const ctx = featureContext(c);
      const state = await readState(ctx.db);
      const now = new Date();
      if (!state.lastAttemptAt || now.getTime() - Date.parse(state.lastAttemptAt) >= MANUAL_REFRESH_INTERVAL_MS) {
        try {
          await fetchReading(ctx.db, ctx.data, ctx.settings, now);
        } catch {
          // 失敗の理由は、まとめの sync.lastError に入っている
        }
      }
      return c.json(await buildSummary(ctx.db, ctx.data, ctx.settings, new Date()));
    });

    app.get("/devices", async (c) => {
      const ctx = featureContext(c);
      try {
        return c.json(await checkDevices(ctx.settings));
      } catch (error) {
        if (error instanceof SwitchBotError) return c.json({ error: error.message }, 400);
        throw error;
      }
    });
  },

  /** ホームのカードの1行(例: 「21.5℃・45%」) */
  async homeSummary(ctx) {
    const [temp, hum] = await Promise.all([
      ctx.data.latest(SWITCHBOT_SOURCE, ["temperature"]),
      ctx.data.latest(SWITCHBOT_SOURCE, ["humidity"]),
    ]);
    if (!temp || !hum) return "まだ値がありません";
    return `${temp.value}℃・${hum.value}%`;
  },

  scheduled: {
    // 6回(約30分)続けて失敗したら、エラー通知を送る(育児ログと同じ)
    alertAfterFailures: 6,
    run: runScheduledJob,
  },
});
