/** core_kv(共通部分が使う小さな値)の読み書き。 */

export async function kvGet(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM core_kv WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function kvSet(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(
      "INSERT INTO core_kv (key, value, updated_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(key, value, new Date().toISOString())
    .run();
}

/** まだ値が無いときだけ書き込み、最終的に保存されている値を返す(同時実行でも1つの値に決まる)。 */
export async function kvSetIfAbsent(db: D1Database, key: string, value: string): Promise<string> {
  await db
    .prepare("INSERT OR IGNORE INTO core_kv (key, value, updated_at) VALUES (?, ?, ?)")
    .bind(key, value, new Date().toISOString())
    .run();
  const stored = await kvGet(db, key);
  if (stored === null) throw new Error(`core_kv の ${key} を保存できませんでした`);
  return stored;
}
