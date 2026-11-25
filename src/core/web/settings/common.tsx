/** 設定画面で共通に使う小さな部品。 */

export function formatJst(iso: string | null, empty = "まだありません"): string {
  if (!iso) return empty;
  return new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

export function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="kv-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
