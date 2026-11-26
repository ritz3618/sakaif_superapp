-- 室温・湿度だけで使うデータ。テーブル名は room_ で始める。
-- 室温と湿度の値そのものは、ほかの機能でも使えるよう、共通データ(core_records、source = "switchbot")に置く。

-- 取得の状態(使っている温湿度計、最後に成功した取得、失敗の理由など)
CREATE TABLE room_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
