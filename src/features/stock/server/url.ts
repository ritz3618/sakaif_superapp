/** ストック管理を開く URL(純粋な計算。テストで確認している) */

const USER_ID_PATTERN = /^[a-z0-9_-]{1,32}$/;

/**
 * 例: https://ritz3618.github.io/stock/#user=<利用者ID>&key=<合言葉>
 * 利用者IDか合言葉が無ければ null(設定画面を開く)。
 */
export function stockUrl(base: string, userId: unknown, passphrase: unknown): string | null {
  const user = typeof userId === "string" ? userId.trim() : "";
  if (!USER_ID_PATTERN.test(user) || typeof passphrase !== "string" || !passphrase) return null;
  const fragment = new URLSearchParams({ user, key: passphrase }).toString();
  return `${base.split("#")[0]}#${fragment}`;
}
