/**
 * フィードの内容を D1 に反映する。
 * - 内容が変わった記録と、新しい記録だけを書き込む(D1 の書き込み枠の節約)。
 * - フィードの範囲(from 〜 to)の中にあるのに、フィードに無くなった記録には、削除の印を付ける(論理削除)。
 *   公式仕様では、削除と「日時が範囲の外に編集された」を区別できないため、消さずに印を付けて戻せるようにする。
 * - 削除の印が付いた記録が、再びフィードに現れたら、印を外す。
 */
import type { Feed, FeedRecord } from "./feed";

export interface StoredRecordRef {
  event_id: string;
  raw: string;
  recorded_at: string;
  deleted_at: string | null;
}

export interface NormalizedRecord {
  eventId: string;
  type: string;
  recordedAt: string;
  value: number | null;
  unit: string | null;
  memo: string | null;
  raw: string;
}

export interface SyncPlan {
  upserts: NormalizedRecord[];
  deletes: string[];
}

export function normalizeRecord(record: FeedRecord): NormalizedRecord {
  const v = record.value;
  return {
    eventId: record.event_id,
    type: record.type,
    recordedAt: new Date(record.datetime).toISOString(),
    value: typeof v?.value === "number" && Number.isFinite(v.value) ? v.value : null,
    unit: typeof v?.unit === "string" ? v.unit : null,
    memo: typeof record.memo === "string" ? record.memo : null,
    raw: JSON.stringify(record),
  };
}

/** 書き込みが必要なものだけを選ぶ(純粋な計算。テストで確認している)。 */
export function planSync(feed: Feed, existing: readonly StoredRecordRef[]): SyncPlan {
  const byId = new Map(existing.map((row) => [row.event_id, row]));
  const feedIds = new Set<string>();
  const upserts: NormalizedRecord[] = [];
  for (const record of feed.records) {
    if (feedIds.has(record.event_id)) continue;
    feedIds.add(record.event_id);
    const normalized = normalizeRecord(record);
    const row = byId.get(record.event_id);
    if (!row || row.raw !== normalized.raw || row.deleted_at !== null) upserts.push(normalized);
  }
  const deletes = existing
    .filter(
      (row) =>
        row.deleted_at === null &&
        !feedIds.has(row.event_id) &&
        row.recorded_at >= feed.from &&
        row.recorded_at < feed.to,
    )
    .map((row) => row.event_id);
  return { upserts, deletes };
}

const ID_CHUNK = 90; // D1 の1つの文で使える値は100個まで

async function existingRows(db: D1Database, feed: Feed): Promise<StoredRecordRef[]> {
  const inRange = await db
    .prepare(
      "SELECT event_id, raw, recorded_at, deleted_at FROM piyolog_records WHERE recorded_at >= ? AND recorded_at < ?",
    )
    .bind(feed.from, feed.to)
    .all<StoredRecordRef>();
  const rows = [...inRange.results];
  // 日時が編集されて、範囲の外から移ってきた記録も比べる
  const known = new Set(rows.map((r) => r.event_id));
  const missing = [...new Set(feed.records.map((r) => r.event_id))].filter((id) => !known.has(id));
  for (let i = 0; i < missing.length; i += ID_CHUNK) {
    const chunk = missing.slice(i, i + ID_CHUNK);
    const found = await db
      .prepare(
        `SELECT event_id, raw, recorded_at, deleted_at FROM piyolog_records WHERE event_id IN (${chunk.map(() => "?").join(",")})`,
      )
      .bind(...chunk)
      .all<StoredRecordRef>();
    rows.push(...found.results);
  }
  return rows;
}

export interface SyncResult {
  received: number;
  written: number;
  deleted: number;
}

export async function applyFeed(db: D1Database, feed: Feed, now: Date): Promise<SyncResult> {
  const plan = planSync(feed, await existingRows(db, feed));
  const at = now.toISOString();
  const statements = [
    ...plan.upserts.map((r) =>
      db
        .prepare(
          "INSERT INTO piyolog_records (event_id, type, recorded_at, value, unit, memo, raw, first_seen_at, updated_at, deleted_at) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL) ON CONFLICT(event_id) DO UPDATE SET type = excluded.type, " +
            "recorded_at = excluded.recorded_at, value = excluded.value, unit = excluded.unit, memo = excluded.memo, " +
            "raw = excluded.raw, updated_at = excluded.updated_at, deleted_at = NULL",
        )
        .bind(r.eventId, r.type, r.recordedAt, r.value, r.unit, r.memo, r.raw, at, at),
    ),
    ...plan.deletes.map((id) =>
      db
        .prepare("UPDATE piyolog_records SET deleted_at = ?, updated_at = ? WHERE event_id = ? AND deleted_at IS NULL")
        .bind(at, at, id),
    ),
  ];
  if (statements.length > 0) await db.batch(statements);
  return { received: feed.records.length, written: plan.upserts.length, deleted: plan.deletes.length };
}
