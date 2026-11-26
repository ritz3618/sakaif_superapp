/**
 * 共通データ(core_records)。機能をまたいで使い回せる記録の置き場所。
 *
 * - データの出どころ(source)は、機能の宣言(feature.ts の dataSources)で決める。source はアプリ全体で一意。
 * - どの機能からも読める。書けるのは、その source を宣言した機能だけ(ここで確認する)。
 * - 書き込みは、内容が変わったものだけ行う(D1 の書き込み枠の節約)。削除は論理削除(印を付けるだけ)。
 */

export interface DataRecordInput {
  /** source の中で一意なID(例: 元のサービスの記録ID) */
  id: string;
  /** 記録の種類(例: "Formula"、"temperature") */
  kind: string;
  /** 記録の日時(ISO 8601。保存時に UTC にそろえる) */
  recordedAt: string;
  value?: number | null;
  unit?: string | null;
  /** メモなどの短い文 */
  note?: string | null;
  /** 元のデータ(JSON の文字列)。そのまま保存する。 */
  payload?: string | null;
}

export interface DataRecord {
  source: string;
  id: string;
  kind: string;
  recordedAt: string;
  value: number | null;
  unit: string | null;
  note: string | null;
  payload: string | null;
  firstSeenAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface DataQuery {
  kinds?: readonly string[];
  /** この日時以降(含む) */
  from?: string;
  /** この日時より前(含まない) */
  to?: string;
  /** 削除の印が付いた記録も含める */
  includeDeleted?: boolean;
  order?: "asc" | "desc";
  limit?: number;
}

export interface SnapshotResult {
  received: number;
  written: number;
  deleted: number;
}

/** 読み出し(どの機能からも使える) */
export interface SharedDataReader {
  query(source: string, query?: DataQuery): Promise<DataRecord[]>;
  /** いちばん新しい記録(削除の印が付いたものは除く) */
  latest(source: string, kinds?: readonly string[]): Promise<DataRecord | null>;
  /** いちばん古い記録の日時(削除の印が付いたものは除く) */
  earliestAt(source: string): Promise<string | null>;
  /** 記録の件数と、いちばん古い・新しい記録の日時(削除の印が付いたものは除く) */
  stats(source: string): Promise<{ count: number; earliestAt: string | null; latestAt: string | null }>;
}

/** 読み出しと、自分が宣言した source への書き込み */
export interface SharedData extends SharedDataReader {
  /**
   * ある期間のすべての記録(スナップショット)を反映する。
   * 新しい・変わった記録だけを書き、期間内で無くなった記録には削除の印を付け、再び現れたら印を外す。
   */
  applySnapshot(
    source: string,
    snapshot: { from: string; to: string; records: readonly DataRecordInput[] },
  ): Promise<SnapshotResult>;
  /** 記録を追加・更新する(追記していく種類のデータ向け)。変わっていない記録は書かない。 */
  upsert(source: string, records: readonly DataRecordInput[]): Promise<{ written: number }>;
}

// ---- 純粋な計算(テストで確認している) ----

export interface NormalizedInput {
  id: string;
  kind: string;
  recordedAt: string;
  value: number | null;
  unit: string | null;
  note: string | null;
  payload: string | null;
  fingerprint: string;
}

export function normalizeInput(input: DataRecordInput): NormalizedInput {
  const recordedAt = new Date(input.recordedAt).toISOString();
  const value = typeof input.value === "number" && Number.isFinite(input.value) ? input.value : null;
  const base = {
    id: input.id,
    kind: input.kind,
    recordedAt,
    value,
    unit: input.unit ?? null,
    note: input.note ?? null,
    payload: input.payload ?? null,
  };
  return { ...base, fingerprint: JSON.stringify([base.kind, base.recordedAt, base.value, base.unit, base.note, base.payload]) };
}

export interface StoredRef {
  id: string;
  fingerprint: string;
  recorded_at: string;
  deleted_at: string | null;
}

export interface SnapshotPlan {
  upserts: NormalizedInput[];
  deletes: string[];
}

/** 書き込みが必要なものだけを選ぶ。 */
export function planSnapshot(
  snapshot: { from: string; to: string; records: readonly DataRecordInput[] },
  existing: readonly StoredRef[],
): SnapshotPlan {
  const from = new Date(snapshot.from).toISOString();
  const to = new Date(snapshot.to).toISOString();
  const byId = new Map(existing.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const upserts: NormalizedInput[] = [];
  for (const input of snapshot.records) {
    if (seen.has(input.id)) continue;
    seen.add(input.id);
    const n = normalizeInput(input);
    const row = byId.get(n.id);
    if (!row || row.fingerprint !== n.fingerprint || row.deleted_at !== null) upserts.push(n);
  }
  const deletes = existing
    .filter((r) => r.deleted_at === null && !seen.has(r.id) && r.recorded_at >= from && r.recorded_at < to)
    .map((r) => r.id);
  return { upserts, deletes };
}

// ---- D1 とのやり取り ----

const ID_CHUNK = 90; // D1 の1つの文で使える値は100個まで

interface Row {
  source: string;
  id: string;
  kind: string;
  recorded_at: string;
  value: number | null;
  unit: string | null;
  note: string | null;
  payload: string | null;
  first_seen_at: string;
  updated_at: string;
  deleted_at: string | null;
}

const COLUMNS = "source, id, kind, recorded_at, value, unit, note, payload, first_seen_at, updated_at, deleted_at";

function toRecord(r: Row): DataRecord {
  return {
    source: r.source,
    id: r.id,
    kind: r.kind,
    recordedAt: r.recorded_at,
    value: r.value,
    unit: r.unit,
    note: r.note,
    payload: r.payload,
    firstSeenAt: r.first_seen_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  };
}

function reader(db: D1Database): SharedDataReader {
  const query: SharedDataReader["query"] = async (source, q = {}) => {
      const where = ["source = ?"];
      const binds: unknown[] = [source];
      if (!q.includeDeleted) where.push("deleted_at IS NULL");
      if (q.from) {
        where.push("recorded_at >= ?");
        binds.push(new Date(q.from).toISOString());
      }
      if (q.to) {
        where.push("recorded_at < ?");
        binds.push(new Date(q.to).toISOString());
      }
      if (q.kinds?.length) {
        where.push(`kind IN (${q.kinds.map(() => "?").join(",")})`);
        binds.push(...q.kinds);
      }
      const order = q.order === "desc" ? "DESC" : "ASC";
      const limit = q.limit ? ` LIMIT ${Math.max(1, Math.floor(q.limit))}` : "";
      const rows = await db
        .prepare(`SELECT ${COLUMNS} FROM core_records WHERE ${where.join(" AND ")} ORDER BY recorded_at ${order}, id ${order}${limit}`)
        .bind(...binds)
        .all<Row>();
      return rows.results.map(toRecord);
  };
  return {
    query,
    async latest(source, kinds) {
      const [first] = await query(source, { kinds, order: "desc", limit: 1 });
      return first ?? null;
    },
    async earliestAt(source) {
      const row = await db
        .prepare("SELECT MIN(recorded_at) AS at FROM core_records WHERE source = ? AND deleted_at IS NULL")
        .bind(source)
        .first<{ at: string | null }>();
      return row?.at ?? null;
    },
    async stats(source) {
      const row = await db
        .prepare(
          "SELECT COUNT(*) AS count, MIN(recorded_at) AS earliest, MAX(recorded_at) AS latest FROM core_records WHERE source = ? AND deleted_at IS NULL",
        )
        .bind(source)
        .first<{ count: number; earliest: string | null; latest: string | null }>();
      return { count: row?.count ?? 0, earliestAt: row?.earliest ?? null, latestAt: row?.latest ?? null };
    },
  };
}

async function existingRefs(db: D1Database, source: string, from: string | null, to: string | null, ids: readonly string[]): Promise<StoredRef[]> {
  const refs: StoredRef[] = [];
  if (from && to) {
    const inRange = await db
      .prepare("SELECT id, fingerprint, recorded_at, deleted_at FROM core_records WHERE source = ? AND recorded_at >= ? AND recorded_at < ?")
      .bind(source, from, to)
      .all<StoredRef>();
    refs.push(...inRange.results);
  }
  // 範囲の外から移ってきた記録(日時の編集など)も比べる
  const known = new Set(refs.map((r) => r.id));
  const missing = [...new Set(ids)].filter((id) => !known.has(id));
  for (let i = 0; i < missing.length; i += ID_CHUNK) {
    const chunk = missing.slice(i, i + ID_CHUNK);
    const found = await db
      .prepare(`SELECT id, fingerprint, recorded_at, deleted_at FROM core_records WHERE source = ? AND id IN (${chunk.map(() => "?").join(",")})`)
      .bind(source, ...chunk)
      .all<StoredRef>();
    refs.push(...found.results);
  }
  return refs;
}

async function write(db: D1Database, source: string, plan: SnapshotPlan, now: string): Promise<void> {
  const statements = [
    ...plan.upserts.map((r) =>
      db
        .prepare(
          "INSERT INTO core_records (source, id, kind, recorded_at, value, unit, note, payload, fingerprint, first_seen_at, updated_at, deleted_at) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL) ON CONFLICT(source, id) DO UPDATE SET kind = excluded.kind, " +
            "recorded_at = excluded.recorded_at, value = excluded.value, unit = excluded.unit, note = excluded.note, " +
            "payload = excluded.payload, fingerprint = excluded.fingerprint, updated_at = excluded.updated_at, deleted_at = NULL",
        )
        .bind(source, r.id, r.kind, r.recordedAt, r.value, r.unit, r.note, r.payload, r.fingerprint, now, now),
    ),
    ...plan.deletes.map((id) =>
      db
        .prepare("UPDATE core_records SET deleted_at = ?, updated_at = ? WHERE source = ? AND id = ? AND deleted_at IS NULL")
        .bind(now, now, source, id),
    ),
  ];
  if (statements.length > 0) await db.batch(statements);
}

/** 機能が書き込める共通データの出どころ */
export function ownedSources(feature: { dataSources?: readonly { id: string }[] }): string[] {
  return (feature.dataSources ?? []).map((d) => d.id);
}

/** 共通データの道具を作る。ownedSources は、書き込みを許す source(その機能が宣言したもの)。 */
export function sharedData(db: D1Database, ownedSources: readonly string[]): SharedData {
  const assertOwner = (source: string) => {
    if (!ownedSources.includes(source)) {
      throw new Error(`共通データ "${source}" に書き込めるのは、それを宣言した機能だけです`);
    }
  };
  return {
    ...reader(db),
    async applySnapshot(source, snapshot) {
      assertOwner(source);
      const from = new Date(snapshot.from).toISOString();
      const to = new Date(snapshot.to).toISOString();
      const refs = await existingRefs(db, source, from, to, snapshot.records.map((r) => r.id));
      const plan = planSnapshot(snapshot, refs);
      await write(db, source, plan, new Date().toISOString());
      return { received: snapshot.records.length, written: plan.upserts.length, deleted: plan.deletes.length };
    },
    async upsert(source, records) {
      assertOwner(source);
      const refs = await existingRefs(db, source, null, null, records.map((r) => r.id));
      const plan = planSnapshot({ from: "1970-01-01T00:00:00.000Z", to: "1970-01-01T00:00:00.000Z", records }, refs);
      await write(db, source, { upserts: plan.upserts, deletes: [] }, new Date().toISOString());
      return { written: plan.upserts.length };
    },
  };
}
