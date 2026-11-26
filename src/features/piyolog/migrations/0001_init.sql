-- 育児ログだけで使うデータ。テーブル名は piyolog_ で始める。
-- 育児の記録そのものは、ほかの機能でも使えるよう、共通データ(core_records、source = "piyolog")に置く。

-- 取得の状態(最後に成功した取得、最後の試行、一時停止の期限など)
CREATE TABLE piyolog_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
