/**
 * 設定基盤(サーバーと画面の両方で使う)。
 *
 * - 機能は、feature.ts の settings に設定項目を宣言するだけでよい。設定画面は自動で作られる。
 * - 保存先は2種類: shared(夫婦共通)と user(ユーザーごと)。
 *   「共通の設定」は名前空間 "core"、「機能ごとの設定」は名前空間 = 機能ID で区別する。
 * - 値の検査は、この1か所の関数で行い、画面とサーバーの両方で使う。
 */

export type SettingScope = "shared" | "user";

export interface TimeRange {
  /** "HH:MM"(日本時間) */
  start: string;
  /** "HH:MM"(日本時間)。start より前なら、日付をまたぐ(例: 22:00〜06:00) */
  end: string;
}

interface SettingBase {
  /** 名前空間の中で一意なキー(英数字) */
  key: string;
  label: string;
  description?: string;
  scope: SettingScope;
  /** 設定画面で、まとめて見出しを付ける単位(例: 「睡眠」)。同じ group の項目は並べて書く */
  group?: string;
}

export type SettingDef =
  | (SettingBase & { type: "boolean"; default: boolean })
  | (SettingBase & { type: "minutes"; default: number; min?: number; max?: number })
  | (SettingBase & { type: "timeRanges"; default: TimeRange[] })
  | (SettingBase & { type: "date"; default: string | null })
  | (SettingBase & { type: "text"; default: string })
  /** 数値(単位付き)。default が null なら「未設定」から始まり、クリアもできる */
  | (SettingBase & { type: "number"; default: number | null; unit?: string; min?: number; max?: number; step?: number })
  /** 選択肢から1つ選ぶ */
  | (SettingBase & { type: "select"; default: string; options: { value: string; label: string }[] })
  /** 秘密の値(フィードURLなど)。入力はできるが、画面には「設定済み」としか出さない。 */
  | (SettingBase & { type: "secret" });

/** 秘密の値は、画面には中身を返さず、設定済みかどうかだけを返す。 */
export interface SecretStatus {
  isSet: boolean;
  updatedAt: string | null;
}

export type SettingValue = boolean | number | TimeRange[] | string | null;

export const NAMESPACE_CORE = "core";
const KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,40}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_TIME_RANGES = 10;

export function defaultValue(def: SettingDef): SettingValue {
  return def.type === "secret" ? null : def.default;
}

export type ValidationResult = { ok: true; value: SettingValue } | { ok: false; error: string };

/** 入力値を検査し、保存する形に整える。 */
export function validateSettingValue(def: SettingDef, input: unknown): ValidationResult {
  const fail = (error: string): ValidationResult => ({ ok: false, error: `${def.label}: ${error}` });
  switch (def.type) {
    case "boolean":
      return typeof input === "boolean" ? { ok: true, value: input } : fail("オンかオフを選んでください");
    case "minutes": {
      if (typeof input !== "number" || !Number.isInteger(input)) return fail("分の数(整数)で指定してください");
      const min = def.min ?? 0;
      const max = def.max ?? 24 * 60 * 7;
      if (input < min || input > max) return fail(`${min}分から${max}分の間で指定してください`);
      return { ok: true, value: input };
    }
    case "timeRanges": {
      if (!Array.isArray(input)) return fail("時間帯の一覧で指定してください");
      if (input.length > MAX_TIME_RANGES) return fail(`時間帯は${MAX_TIME_RANGES}個までです`);
      const ranges: TimeRange[] = [];
      for (const item of input) {
        const start = (item as Partial<TimeRange>)?.start;
        const end = (item as Partial<TimeRange>)?.end;
        if (typeof start !== "string" || typeof end !== "string" || !TIME_PATTERN.test(start) || !TIME_PATTERN.test(end)) {
          return fail("時刻は HH:MM の形で指定してください");
        }
        if (start === end) return fail("開始と終了が同じ時間帯は指定できません");
        ranges.push({ start, end });
      }
      return { ok: true, value: ranges };
    }
    case "date": {
      if (input === null) return { ok: true, value: null };
      if (typeof input !== "string" || !DATE_PATTERN.test(input) || Number.isNaN(Date.parse(`${input}T00:00:00Z`))) {
        return fail("日付は YYYY-MM-DD の形で指定してください");
      }
      return { ok: true, value: input };
    }
    case "number": {
      if (input === null) return def.default === null ? { ok: true, value: null } : fail("数値を入れてください");
      if (typeof input !== "number" || !Number.isFinite(input)) return fail("数値で指定してください");
      const unit = def.unit ?? "";
      if (def.min !== undefined && input < def.min) return fail(`${def.min}${unit}以上で指定してください`);
      if (def.max !== undefined && input > def.max) return fail(`${def.max}${unit}以下で指定してください`);
      return { ok: true, value: input };
    }
    case "select":
      if (typeof input !== "string" || !def.options.some((o) => o.value === input)) return fail("選択肢から選んでください");
      return { ok: true, value: input };
    case "text":
      if (typeof input !== "string") return fail("文字で指定してください");
      if (input.length > 500) return fail("500文字までです");
      return { ok: true, value: input };
    case "secret": {
      if (input === null) return { ok: true, value: null };
      if (typeof input !== "string" || input.trim() === "") return fail("値を入力してください");
      if (input.length > 2000) return fail("2000文字までです");
      return { ok: true, value: input.trim() };
    }
  }
}

/** 宣言の誤り(キーの形式と重複)を返す。 */
export function validateSettingDefs(defs: readonly SettingDef[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const def of defs) {
    if (!KEY_PATTERN.test(def.key)) errors.push(`設定のキー "${def.key}" は英字で始まる英数字にしてください`);
    if (seen.has(def.key)) errors.push(`設定のキー "${def.key}" が重複しています`);
    seen.add(def.key);
    if (def.type !== "secret") {
      const check = validateSettingValue(def, def.default);
      if (!check.ok) errors.push(`設定 "${def.key}" の既定値が正しくありません(${check.error})`);
    }
  }
  return errors;
}

/** "HH:MM" を、0時からの分に直す。 */
export function minutesOfDay(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** 時刻(0時からの分)が、時間帯のどれかに入っているか。終了時刻ちょうどは含まない。 */
export function isWithinTimeRanges(minuteOfDay: number, ranges: readonly TimeRange[]): boolean {
  return ranges.some(({ start, end }) => {
    const s = minutesOfDay(start);
    const e = minutesOfDay(end);
    if (s === e) return false;
    return s < e ? minuteOfDay >= s && minuteOfDay < e : minuteOfDay >= s || minuteOfDay < e;
  });
}

// ---- 共通部分が持つ設定 ----

/** 夫婦共通の設定と、各自の設定のうち、機能に属さないもの */
export const CORE_SETTINGS: readonly SettingDef[] = [
  {
    key: "quietHours",
    label: "通知を避ける時間帯",
    description:
      "この時間帯は通知を送りません。時間帯の間に通知の時刻を過ぎた場合は、時間帯が明けたときに1回だけ送ります(夫婦共通)。",
    scope: "shared",
    type: "timeRanges",
    default: [],
  },
  {
    key: "errorAlerts",
    label: "エラー通知を受け取る",
    description: "機能の定期処理が続けて失敗したときに、通知でお知らせします(自分だけの設定)。",
    scope: "user",
    type: "boolean",
    default: true,
  },
];

/** 通知を送る機能に、自動で付く「この機能の通知を受け取る」設定のキー */
export const FEATURE_NOTIFY_KEY = "notificationsEnabled";

export function featureNotifySetting(featureName: string): SettingDef {
  return {
    key: FEATURE_NOTIFY_KEY,
    label: "通知を受け取る",
    description: `「${featureName}」の通知を、自分の端末で受け取ります(自分だけの設定)。`,
    scope: "user",
    type: "boolean",
    default: true,
  };
}

// ---- 画面とサーバーのやり取り ----

export interface SettingItem {
  namespace: string;
  def: SettingDef;
  /** 秘密の値以外は値そのもの。秘密の値は SecretStatus。 */
  value: SettingValue | SecretStatus;
  updatedAt: string | null;
}

export interface SettingSection {
  namespace: string;
  title: string;
  items: SettingItem[];
}
