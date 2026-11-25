import { migrationsFromGlob } from "./migrate";

const files = import.meta.glob<string>("./migrations/*.sql", { query: "?raw", import: "default", eager: true });

/** 共通部分のマイグレーション(機能のマイグレーションより先に適用する) */
export const coreMigrations = migrationsFromGlob("core", files);
