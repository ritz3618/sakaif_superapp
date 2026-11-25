-- 第2段階: 設定、通知の履歴、定期実行の記録。

-- 設定の値。user_id = 0 は夫婦共通、それ以外はそのユーザーだけの値。値は JSON。
CREATE TABLE core_settings (
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  user_id INTEGER NOT NULL DEFAULT 0,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by INTEGER,
  PRIMARY KEY (namespace, key, user_id)
);

-- 送った通知の履歴(ユーザーごと)。dedupe_key が同じ通知は、送信済みなら二度と送らない。
CREATE TABLE core_notification_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  feature_id TEXT NOT NULL,
  type TEXT NOT NULL,
  dedupe_key TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  url TEXT,
  status TEXT NOT NULL,
  sent_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX core_notification_log_user_time ON core_notification_log(user_id, created_at);
CREATE INDEX core_notification_log_dedupe ON core_notification_log(user_id, dedupe_key);

-- 機能ごとの定期実行の状態(連続失敗の回数など)。
CREATE TABLE core_job_runs (
  feature_id TEXT PRIMARY KEY,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  streak_started_at TEXT,
  last_success_at TEXT,
  last_failure_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL
);
