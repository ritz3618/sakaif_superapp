/**
 * 機能の D1 マイグレーション(src/features/<フォルダ>/migrations/*.sql)を自動で集める。
 * 機能のテーブル名は、必ず「フォルダ名_」で始める(テストで確認している)。
 */
import { migrationsFromGlob, type Migration } from "../core/server/db/migrate";

const files = import.meta.glob<string>("./*/migrations/*.sql", { query: "?raw", import: "default", eager: true });

function groupByFolder(all: Record<string, string>): Map<string, Record<string, string>> {
  const groups = new Map<string, Record<string, string>>();
  for (const [path, sql] of Object.entries(all)) {
    const folder = path.split("/")[1] ?? "";
    const group = groups.get(folder) ?? {};
    group[path] = sql;
    groups.set(folder, group);
  }
  return groups;
}

export const featureMigrations: Migration[] = [...groupByFolder(files).entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .flatMap(([folder, group]) => migrationsFromGlob(folder, group));
