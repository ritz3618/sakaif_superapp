import { FEATURE_NOTIFY_KEY, validateSettingDefs, type SettingDef } from "./settings";

/**
 * 機能(スーパーアプリに載せる1つのアプリ)の宣言。
 * サーバーと画面の両方から読むので、ここには実行環境に依存するコードを書かない。
 */

export type FeatureKind = "internal" | "external";

export interface FeatureNotificationType {
  /** 機能の中で一意な通知の種類(例: "feeding_due") */
  type: string;
  /** 設定画面や履歴に出す名前 */
  label: string;
}

export interface FeatureMeta {
  /** 英小文字で始まる英小文字・数字(2〜31文字)。URLのパスと、D1のテーブル名の接頭辞に使う。 */
  id: string;
  /** 表示名 */
  name: string;
  /** ホーム画面に追加したときの短い名前(省略時は name) */
  shortName?: string;
  /** internal: このアプリの中の機能 / external: 外部のURL(GASなど)を開くリンク */
  kind: FeatureKind;
  /** kind が external のときの移動先 */
  url?: string;
  /** 既定アイコンの背景色(#RRGGBB) */
  color: string;
  /** ホームでの既定の並び順(小さいほど前) */
  order: number;
  /** この機能が送る通知の種類。1つ以上あると、設定画面に「通知を受け取る」が自動で付く。 */
  notifications?: FeatureNotificationType[];
  /** この機能の設定項目。宣言すると、設定画面に自動で出る。 */
  settings?: SettingDef[];
}

/** 機能のIDに使えない名前(共通部分がパスとして使っているもの) */
export const RESERVED_FEATURE_IDS: readonly string[] = [
  "api",
  "app",
  "assets",
  "core",
  "index",
  "pwa",
  "settings",
  "sw",
];

export const FEATURE_ID_PATTERN = /^[a-z][a-z0-9]{1,30}$/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** 機能の宣言を書くための関数(型を付けるだけで、何もしない)。 */
export function defineFeature<T extends FeatureMeta | FeatureMeta[]>(definition: T): T {
  return definition;
}

/** 機能のホームのパス(例: "/piyolog/") */
export function featurePath(id: string): string {
  return `/${id}/`;
}

/** 宣言の誤りを、メッセージの配列で返す(空なら問題なし)。 */
export function validateFeatures(features: readonly FeatureMeta[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const f of features) {
    if (!FEATURE_ID_PATTERN.test(f.id)) {
      errors.push(`機能ID "${f.id}" は、英小文字で始まる英小文字・数字(2〜31文字)にしてください`);
    }
    if (RESERVED_FEATURE_IDS.includes(f.id)) {
      errors.push(`機能ID "${f.id}" は予約済みのため使えません`);
    }
    if (seen.has(f.id)) {
      errors.push(`機能ID "${f.id}" が重複しています`);
    }
    seen.add(f.id);
    if (!f.name.trim()) {
      errors.push(`機能 "${f.id}" の表示名が空です`);
    }
    if (!COLOR_PATTERN.test(f.color)) {
      errors.push(`機能 "${f.id}" の色 "${f.color}" は #RRGGBB 形式にしてください`);
    }
    if (f.kind === "external" && !f.url) {
      errors.push(`外部リンクの機能 "${f.id}" に url がありません`);
    }
    for (const e of validateSettingDefs(f.settings ?? [])) errors.push(`機能 "${f.id}": ${e}`);
    if ((f.settings ?? []).some((d) => d.key === FEATURE_NOTIFY_KEY)) {
      errors.push(`機能 "${f.id}": 設定のキー "${FEATURE_NOTIFY_KEY}" は共通部分が使うため、使えません`);
    }
    const types = new Set<string>();
    for (const n of f.notifications ?? []) {
      if (types.has(n.type)) {
        errors.push(`機能 "${f.id}" の通知の種類 "${n.type}" が重複しています`);
      }
      types.add(n.type);
    }
  }
  return errors;
}
