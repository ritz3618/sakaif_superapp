-- 共通部分のテーブル。共通テーブルの名前は core_ で始める(機能のテーブルは「機能ID_」で始める)。

-- ユーザー。Cloudflare Access でログインしたメールアドレスで識別し、初回アクセスで自動登録する。
CREATE TABLE core_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

-- 通知の宛先(端末ごと)。送信先が「失効」と返したら自動で削除する。
CREATE TABLE core_push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES core_users(id),
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  device_label TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  last_success_at TEXT,
  last_error TEXT
);
CREATE INDEX core_push_subscriptions_user ON core_push_subscriptions(user_id);

-- アイコン画像(PNG)。既定のアイコンは初回に自動生成して保存する。アップロード画像も同じ表に入れる。
CREATE TABLE core_icons (
  target_id TEXT NOT NULL,
  size INTEGER NOT NULL,
  png BLOB NOT NULL,
  source TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (target_id, size)
);

-- 共通部分が使う小さな値(通知用の鍵、最後に定期実行した時刻など)。
CREATE TABLE core_kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
