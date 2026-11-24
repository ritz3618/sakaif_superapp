import { describe, expect, it } from "vitest";
import { validateFeatures, type FeatureMeta } from "../src/core/shared/feature";
import { coreMigrations } from "../src/core/server/db/core-migrations";
import { splitSqlStatements } from "../src/core/server/db/migrate";
import { features, registeredFeatures } from "../src/features/registry";
import { featureMigrations } from "../src/features/registry.migrations";
import { featureServers } from "../src/features/registry.server";

describe("機能レジストリ", () => {
  it("ホームには、ぴよログとダミー1〜8の合計9個が、この順に並ぶ", () => {
    expect(features.map((f) => f.name)).toEqual([
      "ぴよログ",
      "ダミー1",
      "ダミー2",
      "ダミー3",
      "ダミー4",
      "ダミー5",
      "ダミー6",
      "ダミー7",
      "ダミー8",
    ]);
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
    expect(featureServers.map((s) => s.meta.id)).toEqual(["piyolog"]);
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
    expect(coreMigrations.map((m) => m.id)).toEqual(["core/0001_init.sql"]);
    const statements = splitSqlStatements(coreMigrations[0]!.sql);
    expect(statements).toHaveLength(5);
    expect(statements.every((s) => !s.includes("--"))).toBe(true);
  });

  it("機能のマイグレーションのIDは、フォルダ名で始まる", () => {
    for (const m of featureMigrations) {
      expect(m.id).toMatch(/^[a-z][a-z0-9]*\/\d{4}_[a-z0-9_]+\.sql$/);
    }
  });
});
