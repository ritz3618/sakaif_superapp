/**
 * D1 の変更履歴(マイグレーション)を、Worker 自身が起動時に適用する。
 *
 * - 適用済みの一覧は core_migrations に記録する。
 * - 1つの変更は db.batch() で実行する(D1 の batch はトランザクションなので、途中で失敗すると全体が取り消される)。
 * - 複数の実行が同時に適用しようとしても、記録の主キーが重複して後発が取り消されるため、二重には適用されない。
 * - 適用済みの変更ファイルは書き換えない。変更は、必ず新しいファイルを足して行う。
 */

export interface Migration {
  /** 例: "core/0001_init.sql"、"piyolog/0001_init.sql" */
  id: string;
  sql: string;
}

/** SQL ファイルを文に分ける。行コメント(--)を除き、行末の ; で区切る。 */
export function splitSqlStatements(sql: string): string[] {
  const withoutComments = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  return withoutComments
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

let migrated = false;
let inflight: Promise<void> | null = null;

/** まだなら変更を適用する。同じ実行環境(isolate)では、2回目以降は何もしない。 */
export function ensureMigrated(db: D1Database, migrations: readonly Migration[]): Promise<void> {
  if (migrated) return Promise.resolve();
  inflight ??= applyMigrations(db, migrations)
    .then(() => {
      migrated = true;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export async function applyMigrations(db: D1Database, migrations: readonly Migration[]): Promise<string[]> {
  await db
    .prepare("CREATE TABLE IF NOT EXISTS core_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)")
    .run();
  const rows = await db.prepare("SELECT id FROM core_migrations").all<{ id: string }>();
  const applied = new Set(rows.results.map((r) => r.id));
  const newlyApplied: string[] = [];

  for (const m of migrations) {
    if (applied.has(m.id)) continue;
    const statements = splitSqlStatements(m.sql).map((s) => db.prepare(s));
    statements.push(
      db.prepare("INSERT INTO core_migrations (id, applied_at) VALUES (?, ?)").bind(m.id, new Date().toISOString()),
    );
    try {
      await db.batch(statements);
      newlyApplied.push(m.id);
    } catch (error) {
      // 同時に別の実行が適用した場合は、記録があるはずなので問題にしない。
      const check = await db.prepare("SELECT 1 AS ok FROM core_migrations WHERE id = ?").bind(m.id).first();
      if (!check) {
        throw new Error(`マイグレーション ${m.id} の適用に失敗しました: ${String(error)}`);
      }
    }
  }
  return newlyApplied;
}

/** import.meta.glob の結果を、ID順に並んだ Migration の配列にする。 */
export function migrationsFromGlob(scope: string, files: Record<string, string>): Migration[] {
  return Object.entries(files)
    .map(([path, sql]) => ({ id: `${scope}/${path.split("/").pop()}`, sql }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
