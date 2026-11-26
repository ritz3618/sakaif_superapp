/**
 * 月ごとのテキストの取り込み(過去の記録を足す)。
 *
 * 決まり(2026-11-26):
 * - フィードで取得できている期間(フィードの範囲の始まり以降)は、フィードを正とし、テキストからは取り込まない。
 * - それより前は、テキストの記録を足す。すでに保存しているフィードの記録と、同じ種類・同じ時刻(分)のものは、
 *   同じ記録とみなして、フィードの記録をそのまま残す(フィードのほうが情報が多いため)。
 * - フィードの記録は、取り込みで消さない。消すのは、前回の取り込みで足した記録のうち、今回のテキストに無いものだけ。
 * - 同じ月を何度取り込んでも、同じ結果になる(テキストから作る記録の ID は、日時・種類・その分の中での順番で決める)。
 */
import type { DataRecord, DataRecordInput, SharedData } from "../../../core/server/feature-api";
import { JST_OFFSET_MS, addDays, jstDayStart } from "../../../core/shared/time";
import type { ImportResult } from "../shared/api";
import { PIYOLOG_SOURCE, TEXT_ID_PREFIX } from "../shared/records";
import { parseMonthlyText, TextImportError, type ParsedRecord } from "../shared/text-import";

/** 1回の送信で受け付ける日数の上限(画面からは7日ずつ送る) */
export const MAX_DAYS_PER_IMPORT = 10;

const isCustom = (kind: string) => /^Custom\d*$/.test(kind);
const sameKind = (a: string, b: string) => a === b || (isCustom(a) && isCustom(b));
const minuteOf = (iso: string) => Math.floor(Date.parse(iso) / 60_000);

function stamp(iso: string): string {
  // 日本時間の YYYYMMDDHHmm
  return new Date(Date.parse(iso) + JST_OFFSET_MS).toISOString().slice(0, 16).replace(/[-T:]/g, "");
}

function storedToInput(r: DataRecord): DataRecordInput {
  return { id: r.id, kind: r.kind, recordedAt: r.recordedAt, value: r.value, unit: r.unit, note: r.note, payload: r.payload };
}

/** テキストの記録を、共通データの形にする(payload は、フィードの記録に近い形にする) */
export function textToInput(record: ParsedRecord, id: string): DataRecordInput {
  const payload: Record<string, unknown> = {
    event_id: id,
    datetime: record.at,
    type: record.kind,
    label: record.label,
    origin: "monthly-text",
  };
  if (record.value !== null) payload.value = { value: record.value, unit: record.unit };
  if (record.details) payload.details = record.details;
  if (record.detailText) payload.detail_text = record.detailText;
  if (record.note) payload.memo = record.note;
  return {
    id,
    kind: record.kind,
    recordedAt: record.at,
    value: record.value,
    unit: record.unit,
    note: record.note,
    payload: JSON.stringify(payload),
  };
}

export interface ImportPlan {
  /** applySnapshot に渡す、期間内のすべての記録 */
  records: DataRecordInput[];
  matched: number;
}

/**
 * 取り込みの計画(純粋な計算。テストで確認している)。
 * records は期間内のテキストの記録、existing は期間内に保存している記録(削除の印が付いたものを除く)。
 */
export function planImport(records: readonly ParsedRecord[], existing: readonly DataRecord[]): ImportPlan {
  const feedRecords = existing.filter((r) => !r.id.startsWith(TEXT_ID_PREFIX));
  // 分ごとに引けるようにしておく(1回の処理を軽くするため)
  const byMinute = new Map<number, DataRecord[]>();
  for (const r of feedRecords) {
    const minute = minuteOf(r.recordedAt);
    byMinute.set(minute, [...(byMinute.get(minute) ?? []), r]);
  }
  const used = new Set<string>();
  const occurrences = new Map<string, number>();
  const out: DataRecordInput[] = [];
  let matched = 0;

  for (const record of records) {
    const candidates = byMinute.get(minuteOf(record.at)) ?? [];
    const match = candidates.find((r) => !used.has(r.id) && sameKind(r.kind, record.kind));
    if (match) {
      used.add(match.id);
      out.push(storedToInput(match));
      matched++;
      continue;
    }
    const key = `${stamp(record.at)}:${record.kind}`;
    const n = occurrences.get(key) ?? 0;
    occurrences.set(key, n + 1);
    out.push(textToInput(record, `${TEXT_ID_PREFIX}${key}:${n}`));
  }
  // テキストと一致しなかったフィードの記録も、消さずにそのまま残す
  for (const r of feedRecords) if (!used.has(r.id)) out.push(storedToInput(r));
  return { records: out, matched };
}

/**
 * 1回の送信分(数日分のテキスト)を取り込む。
 * cutoff は、フィードの範囲の始まり(フィードを使っていなければ今)。これ以降の記録は取り込まない。
 */
export async function importMonthlyText(data: SharedData, text: string, cutoff: Date): Promise<ImportResult> {
  const parsed = parseMonthlyText(text);
  if (parsed.days.length === 0) throw new TextImportError("日付の行が見つかりません");
  if (parsed.days.length > MAX_DAYS_PER_IMPORT) {
    throw new TextImportError(`1回に送れるのは${MAX_DAYS_PER_IMPORT}日分までです`);
  }
  const days = [...parsed.days].sort();
  const firstDay = days[0]!;
  const lastDay = days.at(-1)!;
  const from = jstDayStart(firstDay);
  const end = jstDayStart(addDays(lastDay, 1));
  const to = new Date(Math.min(end.getTime(), cutoff.getTime()));

  const inRange = parsed.records.filter((r) => Date.parse(r.at) >= from.getTime() && Date.parse(r.at) < to.getTime());
  const ignored = parsed.records.length - inRange.length;
  if (to.getTime() <= from.getTime()) {
    return { firstDay, lastDay, received: 0, matched: 0, written: 0, deleted: 0, ignored };
  }

  const existing = await data.query(PIYOLOG_SOURCE, { from: from.toISOString(), to: to.toISOString() });
  const plan = planImport(inRange, existing);
  const result = await data.applySnapshot(PIYOLOG_SOURCE, {
    from: from.toISOString(),
    to: to.toISOString(),
    records: plan.records,
  });
  return {
    firstDay,
    lastDay,
    received: inRange.length,
    matched: plan.matched,
    written: result.written,
    deleted: result.deleted,
    ignored,
  };
}
