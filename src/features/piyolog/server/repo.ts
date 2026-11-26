/** 育児ログのデータの読み出しと、取得の状態の保存(D1)。 */

export interface RecordRow {
  event_id: string;
  type: string;
  recorded_at: string;
  value: number | null;
  unit: string | null;
  memo: string | null;
}

/** 指定した時刻より後の記録(削除の印が付いたものは除く)を、古い順に返す。 */
export async function recordsSince(db: D1Database, sinceIso: string): Promise<RecordRow[]> {
  const rows = await db
    .prepare(
      "SELECT event_id, type, recorded_at, value, unit, memo FROM piyolog_records " +
        "WHERE deleted_at IS NULL AND recorded_at >= ? ORDER BY recorded_at",
    )
    .bind(sinceIso)
    .all<RecordRow>();
  return rows.results;
}

/** 指定した種類のうち、いちばん新しい記録 */
export async function latestOfTypes(db: D1Database, types: readonly string[]): Promise<RecordRow | null> {
  return db
    .prepare(
      `SELECT event_id, type, recorded_at, value, unit, memo FROM piyolog_records WHERE deleted_at IS NULL ` +
        `AND type IN (${types.map(() => "?").join(",")}) ORDER BY recorded_at DESC LIMIT 1`,
    )
    .bind(...types)
    .first<RecordRow>();
}

/** いちばん古い記録の時刻(過去との比較で、データがある日だけを使うため) */
export async function earliestRecordAt(db: D1Database): Promise<string | null> {
  const row = await db
    .prepare("SELECT MIN(recorded_at) AS at FROM piyolog_records WHERE deleted_at IS NULL")
    .first<{ at: string | null }>();
  return row?.at ?? null;
}

/** CSV 用に、すべての記録(削除の印が付いたものも含む)を古い順に返す。 */
export async function allRecords(db: D1Database): Promise<(RecordRow & { deleted_at: string | null })[]> {
  const rows = await db
    .prepare(
      "SELECT event_id, type, recorded_at, value, unit, memo, deleted_at FROM piyolog_records ORDER BY recorded_at, event_id",
    )
    .all<RecordRow & { deleted_at: string | null }>();
  return rows.results;
}

// ---- 取得の状態 ----

export interface SyncState {
  lastSuccessAt?: string;
  lastAttemptAt?: string;
  lastAttemptOk?: boolean;
  lastError?: string | null;
  /** 429(取得が多すぎる)を受けたとき、この時刻まで取得を控える */
  pauseUntil?: string | null;
}

const STATE_KEY = "sync";

export async function readSyncState(db: D1Database): Promise<SyncState> {
  const row = await db.prepare("SELECT value FROM piyolog_state WHERE key = ?").bind(STATE_KEY).first<{ value: string }>();
  return row ? (JSON.parse(row.value) as SyncState) : {};
}

export async function writeSyncState(db: D1Database, state: SyncState): Promise<void> {
  await db
    .prepare(
      "INSERT INTO piyolog_state (key, value, updated_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(STATE_KEY, JSON.stringify(state), new Date().toISOString())
    .run();
}
