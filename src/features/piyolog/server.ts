/**
 * 育児ログ(ぴよログのデータを使う機能)のサーバー側。
 * - 5分おきにフィードを取得して保存し、授乳・おむつ替え・フィードの期限の通知を判定する。
 * - 室温・湿度(SwitchBot)も5分おきに読んで共通データに保存し、基準の外が続いたら通知する(通知は初期値オフ)。
 * - 画面用の API: GET /summary、POST /refresh(今すぐ取得)、GET /data-info、POST /import(月ごとのテキストの取り込み)、
 *   GET /export.csv、GET /room(室温・湿度の状態)、GET /room/devices(SwitchBot の機器の確認)
 */
import { defineFeatureServer, featureContext, formatMinutesFromIso } from "./server/helpers";
import { readRoomState, readSyncState } from "./server/repo";
import { buildRoomSummary, checkDevices, fetchReading } from "./server/room";
import { SwitchBotError } from "./server/switchbot";
import { recordsToCsv } from "./server/csv";
import { importMonthlyText } from "./server/import";
import { buildDataInfo, buildSummary, feedConfig, importCutoff, runScheduledJob, syncFeed } from "./server/service";
import { DIAPER_TYPES, FEEDING_TYPES, PIYOLOG_SOURCE } from "./shared/records";
import { TextImportError } from "./shared/text-import";

/** 取り込みで1回に受け付けるテキストの大きさの上限(1か月分で20〜30KB 程度) */
const MAX_IMPORT_BYTES = 200_000;

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
      const [state, roomState] = await Promise.all([readSyncState(ctx.db), readRoomState(ctx.db)]);
      const now = new Date();
      const due = (at: string | undefined) => !at || now.getTime() - Date.parse(at) >= MANUAL_REFRESH_INTERVAL_MS;
      // 失敗の理由は、まとめ(sync.lastError、室温・湿度の状態)に入っている
      if (due(state.lastAttemptAt)) await syncFeed(ctx.db, ctx.data, config.url, now).catch(() => undefined);
      if (due(roomState.lastAttemptAt)) await fetchReading(ctx.db, ctx.data, ctx.settings, now).catch(() => undefined);
      return c.json(await buildSummary(ctx.db, ctx.data, ctx.settings, new Date()));
    });

    app.get("/data-info", async (c) => {
      const ctx = featureContext(c);
      return c.json(await buildDataInfo(ctx.db, ctx.data, ctx.settings, new Date()));
    });

    // 月ごとのテキストの取り込み。画面から、数日分ずつに分けて送られてくる(本文は {"text": "..."})
    app.post("/import", async (c) => {
      const ctx = featureContext(c);
      const body = (await c.req.json().catch(() => null)) as { text?: unknown } | null;
      const text = body?.text;
      if (typeof text !== "string" || !text) return c.json({ error: "テキストがありません" }, 400);
      if (text.length > MAX_IMPORT_BYTES) return c.json({ error: "テキストが大きすぎます" }, 413);
      try {
        return c.json(await importMonthlyText(ctx.data, text, await importCutoff(ctx.db, new Date())));
      } catch (error) {
        if (error instanceof TextImportError) return c.json({ error: error.message }, 400);
        throw error;
      }
    });

    app.get("/room", async (c) => {
      const ctx = featureContext(c);
      return c.json(await buildRoomSummary(ctx.db, ctx.data, ctx.settings, new Date()));
    });

    app.get("/room/devices", async (c) => {
      const ctx = featureContext(c);
      try {
        return c.json(await checkDevices(ctx.settings));
      } catch (error) {
        if (error instanceof SwitchBotError) return c.json({ error: error.message }, 400);
        throw error;
      }
    });

    // 保存しているすべての記録(削除の印が付いたものを除く)
    app.get("/export.csv", async (c) => {
      const ctx = featureContext(c);
      const csv = recordsToCsv(await ctx.data.query(PIYOLOG_SOURCE));
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
