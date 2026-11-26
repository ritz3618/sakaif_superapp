import { defineFeature } from "../../core/shared/feature";

/**
 * 室温・湿度(SwitchBot の温湿度計)の宣言(2026-11-26)。
 * 値は5分おきに SwitchBot の API(v1.1)から読み、共通データ(source = "switchbot")に置く。
 * ほかの機能(育児ログなど)は、共通データを読んで表示できる。
 *
 * 共通データの中身: kind = "temperature"(unit "celsius")/ "humidity"(unit "percent")、value = 値、
 * id = <温湿度計のID>:<種類>:<時刻(分)>、payload = { deviceName, warning: { direction: "low" | "high", threshold } | null }
 */
const THRESHOLD_NOTE = "画面の注意の表示と、通知の両方に使います(夫婦共通)。";

export default defineFeature({
  id: "room",
  name: "室温・湿度",
  shortName: "室温",
  kind: "internal",
  color: "#3A86A8",
  order: 20,
  notifications: [
    { type: "temperature_out", label: "室温が基準の外" },
    { type: "humidity_out", label: "湿度が基準の外" },
  ],
  dataSources: [
    {
      id: "switchbot",
      label: "SwitchBot の温湿度",
      description: "SwitchBot の温湿度計から5分おきに読んだ、室温と湿度",
    },
  ],
  settings: [
    {
      key: "token",
      label: "SwitchBot のトークン",
      description:
        "SwitchBot のアプリの「プロフィール → 設定 → アプリについて」で、アプリのバージョンを10回たたくと出る「開発者向けオプション」から取得します。パスワードと同じ扱いで、保存後は画面に表示しません。",
      scope: "shared",
      type: "secret",
    },
    {
      key: "clientSecret",
      label: "SwitchBot のクライアントシークレット",
      description: "トークンと同じ画面にある、もう1つの値です。保存後は画面に表示しません。",
      scope: "shared",
      type: "secret",
    },
    {
      key: "deviceName",
      label: "使う温湿度計の名前(任意)",
      description:
        "温湿度計が複数あるときに、SwitchBot のアプリでの名前を入れます。空のときは、最初に見つかった温湿度計を使います。",
      scope: "shared",
      type: "text",
      default: "",
    },
    {
      key: "temperatureLow",
      label: "室温の下限",
      description: `これより低いと注意を出します。${THRESHOLD_NOTE}`,
      scope: "shared",
      type: "number",
      default: 20,
      unit: "℃",
      min: 0,
      max: 40,
      step: 0.5,
    },
    {
      key: "temperatureHigh",
      label: "室温の上限(任意)",
      description: `これより高いと注意を出します。未設定なら使いません。${THRESHOLD_NOTE}`,
      scope: "shared",
      type: "number",
      default: null,
      unit: "℃",
      min: 0,
      max: 45,
      step: 0.5,
    },
    {
      key: "humidityLow",
      label: "湿度の下限",
      description: `これより低いと注意を出します。${THRESHOLD_NOTE}`,
      scope: "shared",
      type: "number",
      default: 40,
      unit: "%",
      min: 0,
      max: 100,
      step: 1,
    },
    {
      key: "humidityHigh",
      label: "湿度の上限(任意)",
      description: `これより高いと注意を出します。未設定なら使いません。${THRESHOLD_NOTE}`,
      scope: "shared",
      type: "number",
      default: null,
      unit: "%",
      min: 0,
      max: 100,
      step: 1,
    },
    {
      key: "alertTarget",
      label: "通知する対象",
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
      key: "alertAfterMinutes",
      label: "通知するまでの時間",
      description:
        "基準の外の状態がこの時間続いたら、通知します。0分にすると、基準の外になったらすぐに通知します(同じ状態が続く間は1回だけ)。",
      scope: "shared",
      type: "minutes",
      default: 30,
      min: 0,
      max: 180,
    },
  ],
});
