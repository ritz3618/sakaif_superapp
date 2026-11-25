import { defineFeature } from "../../core/shared/feature";

/** ぴよログ(育児記録のデータフィードを使う機能)の宣言 */
export default defineFeature({
  id: "piyolog",
  name: "ぴよログ",
  kind: "internal",
  color: "#E8A317",
  order: 10,
  notifications: [
    { type: "feeding_due", label: "授乳の経過時間" },
    { type: "diaper_due", label: "おむつ替えの経過時間" },
    { type: "feed_expiring", label: "フィードURLの期限" },
  ],
});
