import { defineFeature } from "../../core/shared/feature";

/**
 * 育児ログ(ぴよログのデータフィードを使う機能)の宣言。
 * 表示名は「育児ログ」(2026-11-25 ユーザー決定)。機能ID・URL・テーブル名の接頭辞は piyolog のまま。
 */
export default defineFeature({
  id: "piyolog",
  name: "育児ログ",
  kind: "internal",
  color: "#E8A317",
  order: 10,
  notifications: [
    { type: "feeding_due", label: "授乳の経過時間" },
    { type: "diaper_due", label: "おむつ替えの経過時間" },
    { type: "feed_expiring", label: "フィードURLの期限" },
  ],
});
