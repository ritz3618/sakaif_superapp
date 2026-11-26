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
  settings: [
    {
      key: "feedingIntervalMinutes",
      label: "授乳の通知の間隔",
      description: "最後の授乳(飲み始め)からこの時間がたったら、通知します(夫婦共通)。",
      scope: "shared",
      type: "minutes",
      default: 240,
      min: 30,
      max: 720,
    },
    {
      key: "diaperIntervalMinutes",
      label: "おむつ替えの通知の間隔",
      description: "最後のおしっこ・うんちの記録からこの時間がたったら、通知します(夫婦共通)。",
      scope: "shared",
      type: "minutes",
      default: 240,
      min: 30,
      max: 720,
    },
    {
      key: "feedUrl",
      label: "フィードURL",
      description:
        "ぴよログの「設定 → データフィード」で作ったURLを貼り付けます。URLはパスワードと同じ扱いで、保存後は画面に表示しません。",
      scope: "shared",
      type: "secret",
    },
    {
      key: "feedCreatedOn",
      label: "フィードの作成日(任意)",
      description:
        "フィードの期限(作成日から89日)の計算に使います。入れない場合は、URLを保存した日を作成日とみなします。",
      scope: "shared",
      type: "date",
      default: null,
    },
  ],
});
