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
  // 記録の入力はぴよログのアプリで行うので、画面の上から1タップで開けるようにする(2026-11-28 ユーザー)。
  // このアドレスは、ぴよログの公式サイトの apple-app-site-association で、アプリを開くリンクとして登録されている。
  // アイコンは、ぴよログの公式サイトのアイコン画像をそのまま読み込む(この中には画像を置かない。2026-11-28 ユーザー)。
  headerLink: {
    label: "ぴよログ",
    url: "https://www.piyolog.com/app/piyolog/link/",
    icon: "https://www.piyolog.com/images/apple-touch-icon-180x180.png",
  },
  notifications: [
    { type: "feeding_due", label: "授乳の経過時間" },
    { type: "diaper_due", label: "おむつ替えの経過時間" },
    { type: "awake_too_long", label: "活動限界(起きている時間)" },
    { type: "feed_expiring", label: "フィードURLの期限" },
    { type: "room_temperature_out", label: "室温が基準の外" },
    { type: "room_humidity_out", label: "湿度が基準の外" },
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
    // 室温・湿度は、育児ログの機能として取得する。今後ほかの機能でも使えるよう、共通データに置く(2026-11-26 ユーザー決定)。
    // 中身: kind = "temperature"(unit "celsius")/ "humidity"(unit "percent")、value = 値、
    //       id = <機器のID>:<種類>:<時刻(分)>、payload = { deviceName, warning: { direction: "low" | "high", threshold } | null }
    {
      id: "switchbot",
      label: "SwitchBot の室温・湿度",
      description: "SwitchBot の機器(温湿度計、Hub 2 など)から5分おきに読んだ、室温と湿度",
    },
  ],
  settings: [
    {
      key: "feedingIntervalMinutes",
      group: "授乳",
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
      group: "授乳",
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
      key: "activityLimitMinutes",
      group: "睡眠",
      label: "活動限界",
      description:
        "起きてから続けて活動できる時間の目安です(夫婦共通)。画面に「活動限界まであと○分」と出し、過ぎたら通知します。",
      scope: "shared",
      type: "minutes",
      default: 180,
      min: 30,
      max: 720,
    },
    {
      key: "diaperIntervalMinutes",
      group: "おむつ",
      label: "おむつ替えの通知の間隔",
      description: "最後のおしっこ・うんちの記録からこの時間がたったら、通知します(夫婦共通)。",
      scope: "shared",
      type: "minutes",
      default: 240,
      min: 30,
      max: 720,
    },
    {
      key: "switchbotToken",
      group: "室温・湿度",
      label: "SwitchBot のトークン",
      description:
        "室温・湿度の表示に使います。SwitchBot のアプリの「プロフィール → 設定 → アプリについて」で、アプリのバージョンを10回たたくと出る「開発者向けオプション」から取得します。パスワードと同じ扱いで、保存後は画面に表示しません。",
      scope: "shared",
      type: "secret",
    },
    {
      key: "switchbotSecret",
      group: "室温・湿度",
      label: "SwitchBot のクライアントシークレット",
      description: "トークンと同じ画面にある、もう1つの値です。保存後は画面に表示しません。",
      scope: "shared",
      type: "secret",
    },
    {
      key: "switchbotDeviceName",
      group: "室温・湿度",
      label: "室温・湿度を読む機器の名前(任意)",
      description:
        "温湿度を測れる機器(Hub 2、温湿度計など)が複数あるときに、SwitchBot のアプリでの名前を入れます。空のときは、最初に見つかった機器を使います。",
      scope: "shared",
      type: "text",
      default: "",
    },
    {
      key: "roomTemperatureLow",
      group: "室温・湿度",
      label: "室温の下限",
      description: "これより低いと注意を出します。画面の注意の表示と、通知の両方に使います(夫婦共通)。",
      scope: "shared",
      type: "number",
      default: 20,
      unit: "℃",
      min: 0,
      max: 40,
      step: 0.5,
    },
    {
      key: "roomTemperatureHigh",
      group: "室温・湿度",
      label: "室温の上限(任意)",
      description: "これより高いと注意を出します。未設定なら使いません。画面の注意の表示と、通知の両方に使います(夫婦共通)。",
      scope: "shared",
      type: "number",
      default: null,
      unit: "℃",
      min: 0,
      max: 45,
      step: 0.5,
    },
    {
      key: "roomHumidityLow",
      group: "室温・湿度",
      label: "湿度の下限",
      description: "これより低いと注意を出します。画面の注意の表示と、通知の両方に使います(夫婦共通)。",
      scope: "shared",
      type: "number",
      default: 40,
      unit: "%",
      min: 0,
      max: 100,
      step: 1,
    },
    {
      key: "roomHumidityHigh",
      group: "室温・湿度",
      label: "湿度の上限(任意)",
      description: "これより高いと注意を出します。未設定なら使いません。画面の注意の表示と、通知の両方に使います(夫婦共通)。",
      scope: "shared",
      type: "number",
      default: null,
      unit: "%",
      min: 0,
      max: 100,
      step: 1,
    },
    {
      key: "roomAlertTarget",
      group: "室温・湿度",
      label: "室温・湿度の通知",
      description: "基準の外になったときに通知する対象です(夫婦共通)。初期値はオフです。",
      scope: "shared",
      type: "select",
      default: "off",
      options: [
        { value: "off", label: "通知しない" },
        { value: "temperature", label: "室温だけ" },
        { value: "humidity", label: "湿度だけ" },
        { value: "both", label: "室温と湿度" },
      ],
    },
    {
      key: "roomAlertAfterMinutes",
      group: "室温・湿度",
      label: "室温・湿度を通知するまでの時間",
      description:
        "基準の外の状態がこの時間続いたら、通知します。0分にすると、基準の外になったらすぐに通知します(同じ状態が続く間は1回だけ)。",
      scope: "shared",
      type: "minutes",
      default: 30,
      min: 0,
      max: 180,
    },
    {
      key: "feedUrl",
      group: "ぴよログのフィード",
      label: "フィードURL",
      description:
        "ぴよログの「設定 → データフィード」で作ったURLを貼り付けます。URLはパスワードと同じ扱いで、保存後は画面に表示しません。",
      scope: "shared",
      type: "secret",
    },
    {
      key: "feedCreatedOn",
      group: "ぴよログのフィード",
      label: "フィードの作成日(任意)",
      description:
        "フィードの期限(作成日から89日)の計算に使います。入れない場合は、URLを保存した日を作成日とみなします。",
      scope: "shared",
      type: "date",
      default: null,
    },
  ],
});
