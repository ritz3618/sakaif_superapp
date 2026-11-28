import { describe, expect, it } from "vitest";
import { validateFeatures, type FeatureMeta } from "../src/core/shared/feature";
import { canRegisterPush } from "../src/core/shared/push-policy";
import { coreMigrations } from "../src/core/server/db/core-migrations";
import { splitSqlStatements } from "../src/core/server/db/migrate";
import { features, registeredFeatures } from "../src/features/registry";
import { featureMigrations } from "../src/features/registry.migrations";
import { featureServers } from "../src/features/registry.server";

describe("機能レジストリ", () => {
  it("ホームには、育児ログ・ストック管理とダミー1〜7の合計9個が、この順に並ぶ", () => {
    expect(features.map((f) => f.name)).toEqual(["育児ログ", "ストック管理", ...Array.from({ length: 7 }, (_, i) => `ダミー${i + 1}`)]);
  });

  it("宣言に誤りがない", () => {
    expect(validateFeatures(features)).toEqual([]);
  });

  it("フォルダ名は、そのフォルダの機能IDと一致するか、すべての機能IDの接頭辞になっている", () => {
    for (const { meta, folder } of registeredFeatures) {
      expect(meta.id.startsWith(folder)).toBe(true);
    }
  });

  it("サーバー側を持つ機能だけが、サーバーの一覧に入る", () => {
    expect(featureServers.map((s) => s.meta.id)).toEqual(["piyolog", "stock"]);
  });

  it("誤った宣言を検出できる", () => {
    const bad: FeatureMeta[] = [
      { id: "api", name: "x", kind: "internal", color: "#000000", order: 1 },
      { id: "ok1", name: "a", kind: "internal", color: "#000000", order: 2 },
      { id: "ok1", name: "b", kind: "external", color: "red", order: 3 },
    ];
    const errors = validateFeatures(bad);
    expect(errors.some((e) => e.includes("予約済み"))).toBe(true);
    expect(errors.some((e) => e.includes("重複"))).toBe(true);
    expect(errors.some((e) => e.includes("#RRGGBB"))).toBe(true);
    expect(errors.some((e) => e.includes("url"))).toBe(true);
  });
});

describe("マイグレーション", () => {
  it("共通部分のマイグレーションが読み込まれ、文に分けられる", () => {
    expect(coreMigrations.map((m) => m.id)).toEqual([
      "core/0001_init.sql",
      "core/0002_push_app_context.sql",
      "core/0003_settings_notifications_jobs.sql",
      "core/0004_shared_records.sql",
    ]);
    const statements = splitSqlStatements(coreMigrations[0]!.sql);
    expect(statements).toHaveLength(5);
    expect(statements.every((s) => !s.includes("--"))).toBe(true);
    expect(splitSqlStatements(coreMigrations[1]!.sql)).toEqual([
      "ALTER TABLE core_push_subscriptions ADD COLUMN app_context TEXT",
    ]);
  });

  it("機能のマイグレーションのIDは、フォルダ名で始まる", () => {
    for (const m of featureMigrations) {
      expect(m.id).toMatch(/^[a-z][a-z0-9]*\/\d{4}_[a-z0-9_]+\.sql$/);
    }
  });
});

describe("通知の宛先の登録", () => {
  it("本体のアイコンとブラウザからは登録でき、機能単体のアイコンや不明な開き方からは登録できない", () => {
    expect(canRegisterPush("app")).toBe(true);
    expect(canRegisterPush("browser")).toBe(true);
    for (const f of features) expect(canRegisterPush(f.id)).toBe(false);
    expect(canRegisterPush("unknown")).toBe(false);
    expect(canRegisterPush("")).toBe(false);
  });
});
