-- 育児ログ(ぴよログのフィード)のデータ。テーブル名は piyolog_ で始める。

-- フィードの記録。event_id ごとに1行。内容が変わったときだけ上書きする。
-- フィードの範囲の中で見つからなくなった記録は、削除の印(deleted_at)を付ける(論理削除)。
CREATE TABLE piyolog_records (
  event_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  value REAL,
  unit TEXT,
  memo TEXT,
  raw TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX piyolog_records_time ON piyolog_records(recorded_at);
CREATE INDEX piyolog_records_type_time ON piyolog_records(type, recorded_at);

-- 取得の状態(最後に成功した取得、最後の試行、一時停止の期限など)
CREATE TABLE piyolog_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
