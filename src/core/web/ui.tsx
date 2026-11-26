/**
 * 機能の画面で使う、共通の見た目の部品。各機能はこれを使うことで、アプリ全体の見た目のテイストがそろう。
 * 色・角の丸み・余白・文字の大きさは、styles.css の共通の値(CSS 変数)で決まる。
 *
 * 機能ごとの調整は、その機能の CSS ファイルで行う。
 * - クラス名は「<フォルダ名>-」で始める(例: .myfeature-chart)。
 * - 共通の値を変えたいときは、[data-feature="<機能ID>"] { --radius-lg: 20px; } のように、その機能の中だけで上書きする。
 * - 機能の色は var(--feature-color) で使える(feature.ts の color)。
 * これらの決まりは、テスト(test/boundaries.test.ts)で確認している。
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";

function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

/** 見出し付きの枠 */
export function Panel({ title, children, className }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("panel", "ui-panel", className)}>
      {title && <h2 className="ui-panel__title">{title}</h2>}
      {children}
    </section>
  );
}

/** 大きく見せたい値(例: 「2時間10分前」) */
export function BigValue({ children }: { children: ReactNode }) {
  return <p className="ui-big">{children}</p>;
}

/** 数値のタイルを並べる枠 */
export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="ui-stat-grid">{children}</div>;
}

/** 数値のタイル(ラベル・値と、補足) */
export function Stat({ label, value, children }: { label: ReactNode; value: ReactNode; children?: ReactNode }) {
  return (
    <div className="ui-stat">
      <span className="ui-stat__label">{label}</span>
      <span className="ui-stat__value">{value}</span>
      {children}
    </div>
  );
}

export type TrendDirection = "more" | "less" | "same";

/** 増えた・減った・ほぼ同じ、の表示(色と矢印) */
export function Trend({ direction, children }: { direction: TrendDirection; children: ReactNode }) {
  const arrow = direction === "more" ? "↑" : direction === "less" ? "↓" : "→";
  return (
    <span className={cx("ui-trend", `ui-trend--${direction}`)}>
      {children} {arrow}
    </span>
  );
}

/** 補足の文 */
export function Note({ children, tone }: { children: ReactNode; tone?: "warn" | "error" }) {
  return <p className={cx("note", tone === "warn" && "note--warn", tone === "error" && "message--error")}>{children}</p>;
}

/** ボタン(variant: primary は塗り、secondary は枠だけ) */
export function Button({
  variant = "primary",
  size = "normal",
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary"; size?: "normal" | "small" }) {
  return (
    <button
      type="button"
      className={cx(variant === "secondary" && "button--secondary", size === "small" && "button--small", className)}
      {...rest}
    />
  );
}
