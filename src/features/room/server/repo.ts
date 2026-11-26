/** 室温・湿度だけで使う、取得の状態の保存(D1 の room_state)。値そのものは共通データにある。 */

export interface RoomState {
  /** 使っている温湿度計(設定の名前が変わったら、選び直す) */
  device?: { id: string; name: string; type: string; chosenFor: string };
  lastSuccessAt?: string;
  lastAttemptAt?: string;
  lastError?: string | null;
}

const KEY = "state";

export async function readState(db: D1Database): Promise<RoomState> {
  const row = await db.prepare("SELECT value FROM room_state WHERE key = ?").bind(KEY).first<{ value: string }>();
  return row ? (JSON.parse(row.value) as RoomState) : {};
}

export async function writeState(db: D1Database, state: RoomState): Promise<void> {
  await db
    .prepare(
      "INSERT INTO room_state (key, value, updated_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(KEY, JSON.stringify(state), new Date().toISOString())
    .run();
}
