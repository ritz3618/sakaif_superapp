-- グラフ用の、1日ごとの集計(授乳の量・回数・間隔、睡眠時間、おしっこ・うんちの回数)。
-- 記録から作り直せる「控え」なので、消しても困らない。昨日より前の日だけを保存する(直近はフィードで変わりうるため)。
CREATE TABLE piyolog_daily (
  date TEXT PRIMARY KEY,
  metrics TEXT NOT NULL,
  computed_at TEXT NOT NULL
);
