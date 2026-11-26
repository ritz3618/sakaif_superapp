/**
 * ぴよログのアプリの「月ごとのテキストの書き出し」を読む(画面での事前確認と、サーバーでの取り込みの両方で使う)。
 * 書式は、ユーザーから受け取った実際の書き出し(2026-11-26)で確認したもの(下の例の値は架空):
 *
 *   【ぴよログ】2026年10月
 *   ----------
 *   2026/10/3(土)
 *   <子どもの名前> (1か月12日)       ← 名前は使わない(年齢の形で見分けて読み飛ばす)
 *   08:20   ミルク 100ml   メモ       ← 時刻、種類と値、メモ(区切りは3つ以上の空白)
 *   続きのメモ                        ← 時刻の無い行は、直前の記録のメモの続き(空行を含むことがある)
 *   13:40   うんち (少なめ/やわらかめ/黄)
 *   母乳合計　　   左 0分 / 右 0分    ← その日のまとめ(読み飛ばす)
 *
 * 時刻は日本時間。カスタム記録は、設定した名前のまま出てくる(例: 「爪切り」)。
 */
import { JST_OFFSET_MS } from "../../../core/shared/time";
import { TYPE_LABELS } from "./records";

export interface ParsedRecord {
  /** 記録の日時(UTC の ISO 8601) */
  at: string;
  /** 日本時間の「YYYY-MM-DD HH:MM」 */
  localTime: string;
  /** 公式仕様の type。カスタム記録など、対応する種類が無いものは "Custom" */
  kind: string;
  /** 書き出しに書かれていた種類の名前(例: 「ミルク」「爪切り」) */
  label: string;
  value: number | null;
  unit: string | null;
  note: string | null;
  /** うんちの量・かたさ・色(公式仕様の値に直したもの) */
  details?: { amount?: string; hardness?: string; color?: string };
  /** 種類の後ろに書かれていた文字(値や「(0時間55分)」など) */
  detailText: string | null;
}

export interface ParsedMonth {
  year: number;
  month: number;
  /** 書き出しに含まれる日付(YYYY-MM-DD)の一覧 */
  days: string[];
  records: ParsedRecord[];
  /** 読めなかった行(行番号と内容) */
  skipped: { line: number; text: string }[];
}

export class TextImportError extends Error {}

const HEADER = /^【ぴよログ】(\d{4})年(\d{1,2})月/;
const DATE_LINE = /^(\d{4})\/(\d{1,2})\/(\d{1,2})\(.\)\s*$/;
const AGE_LINE = /\(\d+か月\d+日\)\s*$/;
const EVENT_LINE = /^(\d{1,2}):(\d{2})\s{2,}(.+)$/;
const SUMMARY_LINE = /^(母乳|ミルク|睡眠|おしっこ|うんち)合計/;
const SEPARATOR = /^-{5,}\s*$/;

/** 日本語の種類名 → 公式仕様の type */
const LABEL_TO_TYPE: ReadonlyMap<string, string> = new Map(
  Object.entries(TYPE_LABELS).map(([type, label]) => [label, type]),
);

const AMOUNT: Record<string, string> = { ちょこっと: "minimum", 少なめ: "small", 多め: "large" };
const HARDNESS: Record<string, string> = { 下痢: "diarrhea", やわらかめ: "soft", かため: "hard" };
const COLOR: Record<string, string> = { 白: "white", 黄: "yellow", 橙: "orange", 茶: "brown", 緑: "green", 赤: "red", 黒: "black" };

function parsePoopDetails(text: string): ParsedRecord["details"] {
  const inner = /\(([^)]*)\)/.exec(text)?.[1];
  if (!inner) return undefined;
  const details: NonNullable<ParsedRecord["details"]> = {};
  for (const token of inner.split("/").map((t) => t.trim())) {
    if (AMOUNT[token]) details.amount = AMOUNT[token];
    else if (HARDNESS[token]) details.hardness = HARDNESS[token];
    else if (COLOR[token]) details.color = COLOR[token];
    else if (token === "ふつう") {
      // 「ふつう」は量とかたさの両方にあるので、先に空いているほうに入れる(書き出しは 量/かたさ/色 の順)
      if (!details.amount) details.amount = "normal";
      else if (!details.hardness) details.hardness = "normal";
    }
  }
  return Object.keys(details).length ? details : undefined;
}

function parseValue(kind: string, text: string): { value: number | null; unit: string | null } {
  const num = (re: RegExp) => {
    const m = re.exec(text);
    return m ? Number(m[1]) : null;
  };
  switch (kind) {
    case "Formula":
    case "ExpressedBreastMilk":
    case "Pumping":
    case "Drink":
    case "BreastFeeding": {
      const v = num(/(\d+(?:\.\d+)?)\s*ml/);
      return { value: v, unit: v === null ? null : "ml" };
    }
    case "Temperature": {
      const v = num(/(\d+(?:\.\d+)?)\s*°?C/);
      return { value: v, unit: v === null ? null : "celsius" };
    }
    case "Weight": {
      const v = num(/(\d+(?:\.\d+)?)\s*kg/);
      return { value: v, unit: v === null ? null : "kg" };
    }
    case "Height":
    case "Head":
    case "Chest": {
      const v = num(/(\d+(?:\.\d+)?)\s*cm/);
      return { value: v, unit: v === null ? null : "cm" };
    }
    default:
      return { value: null, unit: null };
  }
}

function toIso(y: number, m: number, d: number, hh: number, mm: number): string {
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - JST_OFFSET_MS).toISOString();
}

const pad = (n: number) => String(n).padStart(2, "0");

export function parseMonthlyText(text: string): ParsedMonth {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const header = lines.map((l) => HEADER.exec(l.trim())).find(Boolean);
  if (!header) throw new TextImportError("ぴよログの「月ごとの書き出し」のファイルではないようです(先頭に【ぴよログ】YYYY年M月 がありません)");
  const year = Number(header[1]);
  const month = Number(header[2]);

  const records: ParsedRecord[] = [];
  const skipped: ParsedMonth["skipped"] = [];
  const days: string[] = [];
  let date: { y: number; m: number; d: number } | null = null;
  let expectAge = false;
  let last: ParsedRecord | null = null;
  let pendingBlank = 0;

  lines.forEach((raw, index) => {
    const line = raw.replace(/\s+$/, "");
    const trimmed = line.trim();
    if (!trimmed) {
      if (last) pendingBlank++;
      return;
    }
    if (HEADER.test(trimmed) || SEPARATOR.test(trimmed)) {
      last = null;
      pendingBlank = 0;
      return;
    }
    const dateMatch = DATE_LINE.exec(trimmed);
    if (dateMatch) {
      date = { y: Number(dateMatch[1]), m: Number(dateMatch[2]), d: Number(dateMatch[3]) };
      days.push(`${date.y}-${pad(date.m)}-${pad(date.d)}`);
      expectAge = true;
      last = null;
      pendingBlank = 0;
      return;
    }
    if (expectAge && AGE_LINE.test(trimmed)) {
      expectAge = false;
      return;
    }
    expectAge = false;
    if (SUMMARY_LINE.test(trimmed)) {
      last = null;
      pendingBlank = 0;
      return;
    }
    const event = EVENT_LINE.exec(line);
    if (event && date) {
      const hh = Number(event[1]);
      const mm = Number(event[2]);
      const parts = event[3]!.trim().split(/\s{3,}/);
      const labelPart = parts[0]!.trim();
      const memo = parts.slice(1).join("   ").trim();
      const space = labelPart.search(/\s/);
      const label = space === -1 ? labelPart : labelPart.slice(0, space);
      const detailText = space === -1 ? null : labelPart.slice(space).trim() || null;
      const kind = LABEL_TO_TYPE.get(label) ?? "Custom";
      const { value, unit } = parseValue(kind, detailText ?? "");
      const record: ParsedRecord = {
        at: toIso(date.y, date.m, date.d, hh, mm),
        localTime: `${date.y}-${pad(date.m)}-${pad(date.d)} ${pad(hh)}:${pad(mm)}`,
        kind,
        label,
        value,
        unit,
        note: memo || null,
        detailText,
      };
      if (kind === "Poop" && detailText) {
        const details = parsePoopDetails(detailText);
        if (details) record.details = details;
      }
      records.push(record);
      last = record;
      pendingBlank = 0;
      return;
    }
    if (last) {
      // 時刻の無い行は、直前の記録のメモの続き(間の空行も保つ)
      const current: ParsedRecord = last;
      current.note = `${current.note ?? ""}${"\n".repeat(pendingBlank + 1)}${trimmed}`.replace(/^\n+/, "");
      pendingBlank = 0;
      return;
    }
    skipped.push({ line: index + 1, text: trimmed.slice(0, 80) });
  });

  return { year, month, days, records, skipped };
}

/**
 * 送信を小分けにするため、テキストを「日の区切り」でまとめ直す(先頭の【ぴよログ】の行は、それぞれに付ける)。
 * 無料プランでは、1回の処理に使える CPU 時間が短い(10ms)ので、1回に送る量を抑える。
 */
export function splitByDays(text: string, daysPerChunk = 7): string[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const headerLine = lines.find((l) => HEADER.test(l.trim()));
  if (!headerLine) throw new TextImportError("ぴよログの「月ごとの書き出し」のファイルではないようです(先頭に【ぴよログ】YYYY年M月 がありません)");
  const blocks: string[][] = [];
  for (const line of lines) {
    if (DATE_LINE.test(line.trim())) blocks.push([line]);
    else if (blocks.length > 0) blocks.at(-1)!.push(line);
  }
  const chunks: string[] = [];
  for (let i = 0; i < blocks.length; i += daysPerChunk) {
    chunks.push([headerLine, "", ...blocks.slice(i, i + daysPerChunk).flat()].join("\n"));
  }
  return chunks;
}

/** 種類ごとの件数(取り込む前の確認の表示用) */
export function countByLabel(records: readonly ParsedRecord[]): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of records) counts.set(r.label, (counts.get(r.label) ?? 0) + 1);
  return [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}
