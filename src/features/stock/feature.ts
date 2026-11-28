import { defineFeature } from "../../core/shared/feature";

/**
 * ストック管理(別に作った外部のWebアプリ。GitHub Pages)を開くカード(2026-11-28 ユーザー決定)。
 * - 同じ画面のまま開く(iframe は使わない)。
 * - 押した人の「ストック管理での利用者ID」と、夫婦共通の「合言葉」から、その場で URL を組み立てる。
 *   合言葉はソースに書かず、設定画面の秘密の値として保存する。
 * - URL の「#」の後ろに入れて渡す(GitHub のサーバーにも、GAS への通信の参照元にも送られない)。
 */
export default defineFeature({
  id: "stock",
  name: "ストック管理",
  kind: "external",
  url: "https://ritz3618.github.io/stock/",
  color: "#5C6B7A",
  order: 30,
  settings: [
    {
      key: "passphrase",
      label: "合言葉",
      description:
        "ストック管理の合言葉です(夫婦共通)。パスワードと同じ扱いで、保存後は画面に表示しません。チャットなどには貼らないでください。",
      scope: "shared",
      type: "secret",
    },
    {
      key: "userId",
      label: "ストック管理での利用者ID",
      description: "ストック管理で、だれとして更新するかの ID です(自分だけの設定。英小文字・数字)。",
      scope: "user",
      type: "text",
      default: "",
    },
  ],
});
