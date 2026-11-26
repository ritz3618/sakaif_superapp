/**
 * ぴよログの記録の種類(公式のデータ仕様 v1、2026-09-18 更新版で確認)。
 * 我が家は完全ミルクで、記録はミルクの飲み始めの時刻と量だけ(2026-11-26 ユーザー)。
 * ただし、母乳・搾母乳の記録が入った場合も、授乳として数える。
 */

/** 共通データ(core_records)での、この機能の記録の出どころの名前 */
export const PIYOLOG_SOURCE = "piyolog";

/** 授乳として数える種類 */
export const FEEDING_TYPES = ["Formula", "ExpressedBreastMilk", "BreastFeeding"] as const;
/** おむつ替えとして数える種類 */
export const DIAPER_TYPES = ["Pee", "Poop"] as const;
export const SLEEP_TYPE = "Sleep";
export const WAKE_TYPE = "WakeUp";

/** 種類の日本語名(公式仕様の一覧)。未知の種類は英語のまま表示する。 */
export const TYPE_LABELS: Readonly<Record<string, string>> = {
  BreastFeeding: "母乳",
  Formula: "ミルク",
  ExpressedBreastMilk: "搾母乳",
  Pumping: "搾乳",
  Sleep: "寝る",
  WakeUp: "起きる",
  Pee: "おしっこ",
  Poop: "うんち",
  Temperature: "体温",
  Height: "身長",
  Weight: "体重",
  Head: "頭囲",
  Chest: "胸囲",
  Foot: "足サイズ",
  Solid: "離乳食",
  Snack: "おやつ",
  Meal: "ごはん",
  Drink: "のみもの",
  Cough: "せき",
  Vomiting: "吐く",
  Rash: "発疹",
  Injury: "けが",
  Bath: "お風呂",
  Medicine: "くすり",
  Hospital: "病院",
  Walking: "さんぽ",
  Vaccine: "予防接種",
  Milestone: "できた",
  Other: "その他",
  Memo: "メモ",
};

export function typeLabel(type: string): string {
  const custom = /^Custom(\d*)$/.exec(type);
  if (custom) return `カスタム${custom[1]}`;
  return TYPE_LABELS[type] ?? type;
}

/** テキストの取り込みで作った記録の ID の先頭(フィードの記録の ID と区別する) */
export const TEXT_ID_PREFIX = "text:";

/**
 * 記録の種類の表示名。テキストの取り込みで作った記録は、書き出しに書かれていた名前(カスタム記録の名前など)を使う。
 */
export function recordLabel(kind: string, payload: string | null): string {
  if (payload) {
    try {
      const parsed = JSON.parse(payload) as { label?: unknown; origin?: unknown };
      if (parsed.origin === "monthly-text" && typeof parsed.label === "string" && parsed.label) return parsed.label;
    } catch {
      // 読めなければ、種類から決める
    }
  }
  return typeLabel(kind);
}
