/**
 * 設定の保存と読み出し(サーバー側)。
 * どの設定があるかは、共通部分の CORE_SETTINGS と、各機能の宣言(feature.ts の settings)から組み立てる。
 */
import type { FeatureMeta } from "../shared/feature";
import {
  CORE_SETTINGS,
  NAMESPACE_CORE,
  defaultValue,
  featureNotifySetting,
  type SecretStatus,
  type SettingDef,
  type SettingItem,
  type SettingSection,
  type SettingValue,
} from "../shared/settings";

export interface SettingsNamespace {
  namespace: string;
  title: string;
  defs: readonly SettingDef[];
}

/** 設定の一覧(共通部分 + 機能ごと)を組み立てる。 */
export function buildSettingsRegistry(features: readonly FeatureMeta[]): SettingsNamespace[] {
  const result: SettingsNamespace[] = [{ namespace: NAMESPACE_CORE, title: "共通", defs: CORE_SETTINGS }];
  for (const f of features) {
    const defs = [...(f.notifications?.length ? [featureNotifySetting(f.name)] : []), ...(f.settings ?? [])];
    if (defs.length > 0) result.push({ namespace: f.id, title: f.name, defs });
  }
  return result;
}

export function findSettingDef(
  registry: readonly SettingsNamespace[],
  namespace: string,
  key: string,
): SettingDef | undefined {
  return registry.find((n) => n.namespace === namespace)?.defs.find((d) => d.key === key);
}

interface StoredRow {
  namespace: string;
  key: string;
  user_id: number;
  value: string;
  updated_at: string;
}

function ownerId(def: SettingDef, userId: number | null): number {
  if (def.scope === "shared") return 0;
  if (userId === null) throw new Error(`設定 "${def.key}" はユーザーごとの設定なので、ユーザーの指定が必要です`);
  return userId;
}

/** 1つの設定の値を読む(保存されていなければ既定値)。 */
export async function readSetting(
  db: D1Database,
  namespace: string,
  def: SettingDef,
  userId: number | null,
): Promise<SettingValue> {
  const row = await db
    .prepare("SELECT value FROM core_settings WHERE namespace = ? AND key = ? AND user_id = ?")
    .bind(namespace, def.key, ownerId(def, userId))
    .first<{ value: string }>();
  return row ? (JSON.parse(row.value) as SettingValue) : defaultValue(def);
}

/** 1つの設定の値と、保存した時刻を読む(保存されていなければ既定値と null)。 */
export async function readSettingWithMeta(
  db: D1Database,
  namespace: string,
  def: SettingDef,
  userId: number | null,
): Promise<{ value: SettingValue; updatedAt: string | null }> {
  const row = await db
    .prepare("SELECT value, updated_at FROM core_settings WHERE namespace = ? AND key = ? AND user_id = ?")
    .bind(namespace, def.key, ownerId(def, userId))
    .first<{ value: string; updated_at: string }>();
  return row
    ? { value: JSON.parse(row.value) as SettingValue, updatedAt: row.updated_at }
    : { value: defaultValue(def), updatedAt: null };
}

/** ユーザーごとの設定を、複数のユーザーについてまとめて読む(通知の送り先を決めるときに使う)。 */
export async function readUserSettingForUsers(
  db: D1Database,
  namespace: string,
  def: SettingDef,
  userIds: readonly number[],
): Promise<Map<number, SettingValue>> {
  const result = new Map<number, SettingValue>(userIds.map((id) => [id, defaultValue(def)]));
  if (userIds.length === 0) return result;
  const rows = await db
    .prepare(
      `SELECT user_id, value FROM core_settings WHERE namespace = ? AND key = ? AND user_id IN (${userIds.map(() => "?").join(",")})`,
    )
    .bind(namespace, def.key, ...userIds)
    .all<{ user_id: number; value: string }>();
  for (const r of rows.results) result.set(r.user_id, JSON.parse(r.value) as SettingValue);
  return result;
}

/** 設定を保存する。値が null の秘密の値は、削除する。 */
export async function writeSetting(
  db: D1Database,
  namespace: string,
  def: SettingDef,
  userId: number,
  value: SettingValue,
): Promise<string> {
  const owner = ownerId(def, userId);
  const now = new Date().toISOString();
  if (def.type === "secret" && value === null) {
    await db
      .prepare("DELETE FROM core_settings WHERE namespace = ? AND key = ? AND user_id = ?")
      .bind(namespace, def.key, owner)
      .run();
    return now;
  }
  await db
    .prepare(
      "INSERT INTO core_settings (namespace, key, user_id, value, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(namespace, key, user_id) DO UPDATE SET value = excluded.value, " +
        "updated_at = excluded.updated_at, updated_by = excluded.updated_by",
    )
    .bind(namespace, def.key, owner, JSON.stringify(value), now, userId)
    .run();
  return now;
}

/** 設定画面に出す一覧を作る。秘密の値は中身を返さない。 */
export async function settingSectionsForUser(
  db: D1Database,
  registry: readonly SettingsNamespace[],
  userId: number,
): Promise<SettingSection[]> {
  const rows = await db
    .prepare("SELECT namespace, key, user_id, value, updated_at FROM core_settings WHERE user_id IN (0, ?)")
    .bind(userId)
    .all<StoredRow>();
  const stored = new Map(rows.results.map((r) => [`${r.namespace}\u0000${r.key}\u0000${r.user_id}`, r]));
  return registry.map(({ namespace, title, defs }) => ({
    namespace,
    title,
    items: defs.map((def): SettingItem => {
      const row = stored.get(`${namespace}\u0000${def.key}\u0000${def.scope === "shared" ? 0 : userId}`);
      if (def.type === "secret") {
        const status: SecretStatus = { isSet: !!row, updatedAt: row?.updated_at ?? null };
        return { namespace, def, value: status, updatedAt: row?.updated_at ?? null };
      }
      return {
        namespace,
        def,
        value: row ? (JSON.parse(row.value) as SettingValue) : defaultValue(def),
        updatedAt: row?.updated_at ?? null,
      };
    }),
  }));
}

/** 機能が自分の設定を読むための道具(名前空間はその機能に固定)。 */
export interface FeatureSettings {
  /** 夫婦共通の設定、または userId を指定してユーザーごとの設定を読む。秘密の値も読める(サーバー側だけ)。 */
  get(key: string, userId?: number): Promise<SettingValue>;
  /** 値と、保存した時刻(未保存なら null)を読む。秘密の値を保存した日を知りたいときなどに使う。 */
  getWithMeta(key: string, userId?: number): Promise<{ value: SettingValue; updatedAt: string | null }>;
}

export function featureSettings(db: D1Database, registry: readonly SettingsNamespace[], namespace: string): FeatureSettings {
  const defOf = (key: string) => {
    const def = findSettingDef(registry, namespace, key);
    if (!def) throw new Error(`設定 "${namespace}.${key}" は宣言されていません`);
    return def;
  };
  return {
    get: (key, userId) => readSetting(db, namespace, defOf(key), userId ?? null),
    getWithMeta: (key, userId) => readSettingWithMeta(db, namespace, defOf(key), userId ?? null),
  };
}
