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
  // 育児の記録は、ほかの機能でも使えるよう共通データに置く(2026-11-26 ユーザー決定)。
  // 中身: kind = 公式仕様の type(Formula、Sleep、Pee など)、value/unit = 量や体温など、
  //       note = メモ、payload = フィードの記録の JSON そのまま、id = event_id。
  dataSources: [
    {
      id: "piyolog",
      label: "ぴよログの記録",
      description: "ぴよログのデータフィードから取得した育児の記録(授乳、睡眠、おむつ、体温など)",
    },
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
      key: "dailyFeedingTargetMl",
      label: "授乳の1日の目安量",
      description:
        "1日(0時〜24時)に飲む量の目安です(夫婦共通)。画面で、今日の量がこの目安に届いているかを表示します。未設定のときは、過去7日の1日あたりの平均と比べます。",
      scope: "shared",
      type: "number",
      default: null,
      unit: "ml",
      min: 50,
      max: 3000,
      step: 10,
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
