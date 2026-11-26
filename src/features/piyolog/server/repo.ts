/** 育児ログだけで使う、取得の状態の保存(D1 の piyolog_state)。記録そのものは共通データにある。 */

// ---- 取得の状態 ----

export interface SyncState {
  lastSuccessAt?: string;
  lastAttemptAt?: string;
  lastAttemptOk?: boolean;
  lastError?: string | null;
  /** 429(取得が多すぎる)を受けたとき、この時刻まで取得を控える */
  pauseUntil?: string | null;
  /** 最後に取得できたフィードの範囲の始まり(これより後は、フィードが正。テキストの取り込みでは扱わない) */
  feedFrom?: string;
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

// ---- 室温・湿度(SwitchBot)の取得の状態 ----

export interface RoomState {
  /** 使っている機器(設定の名前が変わったら、選び直す) */
  device?: { id: string; name: string; type: string; chosenFor: string };
  lastSuccessAt?: string;
  lastAttemptAt?: string;
  lastError?: string | null;
}

const ROOM_KEY = "switchbot";

export async function readRoomState(db: D1Database): Promise<RoomState> {
  const row = await db.prepare("SELECT value FROM piyolog_state WHERE key = ?").bind(ROOM_KEY).first<{ value: string }>();
  return row ? (JSON.parse(row.value) as RoomState) : {};
}

export async function writeRoomState(db: D1Database, state: RoomState): Promise<void> {
  await db
    .prepare(
      "INSERT INTO piyolog_state (key, value, updated_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(ROOM_KEY, JSON.stringify(state), new Date().toISOString())
    .run();
}
