-- 共通データ: 機能をまたいで使い回せる記録(例: 育児の記録、温湿度、天気)。
-- source は「データの出どころ」(機能の宣言 dataSources で決める)。どの機能からも読めるが、
-- 書けるのは、その source を宣言した機能だけ(共通部分が確認する)。
-- 機能だけで使うデータは、従来どおり「フォルダ名_」で始まる機能のテーブルに置く。
CREATE TABLE core_records (
  source TEXT NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  value REAL,
  unit TEXT,
  note TEXT,
  payload TEXT,
  fingerprint TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (source, id)
);
CREATE INDEX core_records_source_time ON core_records(source, recorded_at);
CREATE INDEX core_records_source_kind_time ON core_records(source, kind, recorded_at);
