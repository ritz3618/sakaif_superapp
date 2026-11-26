/**
 * 保存した記録の CSV(バックアップ用)。保存しているすべての期間の記録が入る(削除の印が付いたものは除く)。
 * 日時は日本時間。Excel でも文字化けしないよう、先頭に BOM を付ける。
 */
import { JST_OFFSET_MS } from "../../../core/shared/time";
import { recordLabel, TEXT_ID_PREFIX } from "../shared/records";
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
  const header = ["日時(日本時間)", "種類", "種類(英語)", "値", "単位", "メモ", "取得元", "記録ID"];
  const lines = rows.map((r) =>
    [
      jstDateTime(r.recordedAt),
      recordLabel(r.kind, r.payload),
      r.kind,
      r.value,
      r.unit,
      r.note,
      r.id.startsWith(TEXT_ID_PREFIX) ? "テキストの取り込み" : "フィード",
      r.id,
    ]
      .map(cell)
      .join(","),
  );
  return `﻿${[header.join(","), ...lines].join("\r\n")}\r\n`;
}
