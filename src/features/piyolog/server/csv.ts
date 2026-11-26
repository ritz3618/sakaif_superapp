/** 保存した記録の CSV(バックアップ用)。日時は日本時間。Excel でも文字化けしないよう、先頭に BOM を付ける。 */
import { JST_OFFSET_MS } from "../../../core/shared/time";
import { typeLabel } from "../shared/records";
import type { DataRecord } from "../../../core/server/feature-api";

function cell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function jstDateTime(iso: string): string {
  return new Date(Date.parse(iso) + JST_OFFSET_MS).toISOString().slice(0, 19).replace("T", " ");
}

export function recordsToCsv(rows: readonly DataRecord[]): string {
  const header = ["日時(日本時間)", "種類", "種類(英語)", "値", "単位", "メモ", "記録ID", "削除済み"];
  const lines = rows.map((r) =>
    [
      jstDateTime(r.recordedAt),
      typeLabel(r.kind),
      r.kind,
      r.value,
      r.unit,
      r.note,
      r.id,
      r.deletedAt ? "削除済み" : "",
    ]
      .map(cell)
      .join(","),
  );
  return `\uFEFF${[header.join(","), ...lines].join("\r\n")}\r\n`;
}
