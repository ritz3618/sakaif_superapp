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

/** 注意を引きたいとき(基準の時間を過ぎた、いつもより少ない、など)の見た目 */
export type Tone = "normal" | "warn";

/**
 * 見出し付きの枠。tone="warn" で、枠を注意の色にする。
 * aside は見出しの右に並べる大きな値(例: 「5時間15分前」)。画面を詰めたいときに使う。
 */
export function Panel({
  title,
  aside,
  children,
  className,
  tone = "normal",
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  tone?: Tone;
}) {
  return (
    <section className={cx("panel", "ui-panel", tone === "warn" && "ui-panel--warn", className)}>
      {title && !aside && <h2 className="ui-panel__title">{title}</h2>}
      {title && aside && (
        <div className="ui-panel__head">
          <h2 className="ui-panel__title">{title}</h2>
          <span className={cx("ui-panel__aside", tone === "warn" && "ui-panel__aside--warn")}>{aside}</span>
        </div>
      )}
      {children}
    </section>
  );
}

/** 大きく見せたい値(例: 「2時間10分前」)。tone="warn" で、注意の色にする */
export function BigValue({ children, tone = "normal" }: { children: ReactNode; tone?: Tone }) {
  return <p className={cx("ui-big", tone === "warn" && "ui-big--warn")}>{children}</p>;
}

/** 数値のタイルを並べる枠 */
export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="ui-stat-grid">{children}</div>;
}

/** 数値のタイル(ラベル・値と、補足)。tone="warn" で、値を注意の色にする */
export function Stat({
  label,
  value,
  children,
  tone = "normal",
}: {
  label: ReactNode;
  value: ReactNode;
  children?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className={cx("ui-stat", tone === "warn" && "ui-stat--warn")}>
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

export interface CompareRow {
  label: ReactNode;
  /** 今の値 */
  value: ReactNode;
  /** 比べる相手の値(例: いつもの平均) */
  reference?: ReactNode;
  /** 増えた・減ったの表示 */
  trend?: { direction: TrendDirection; text: ReactNode };
  /** 注意の文(例: 「少なめ」)。あれば、その行を注意の見た目にする */
  warning?: ReactNode;
  /** 参考程度の行(文字を薄くする) */
  muted?: boolean;
}

/**
 * 今の値と、比べる相手の値を並べる表(例: 今日と、いつもの同じ時刻まで)。
 * headers は [項目, 今の値, 比べる相手] の見出し。
 */
export function CompareTable({
  caption,
  headers,
  rows,
  dense = false,
}: {
  caption?: ReactNode;
  headers: [ReactNode, ReactNode, ReactNode];
  rows: readonly CompareRow[];
  /** 行の高さを詰める */
  dense?: boolean;
}) {
  return (
    <table className={cx("ui-compare", dense && "ui-compare--dense")}>
      {caption && <caption className="ui-compare__caption">{caption}</caption>}
      <thead>
        <tr>
          <th scope="col">{headers[0]}</th>
          <th scope="col">{headers[1]}</th>
          <th scope="col">{headers[2]}</th>
          <th scope="col">
            <span className="visually-hidden">差</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className={cx(row.warning != null && "ui-compare__row--warn", row.muted && "ui-compare__row--muted")}>
            <th scope="row">{row.label}</th>
            <td className="ui-compare__value">{row.value}</td>
            <td className="ui-compare__reference">{row.reference ?? "—"}</td>
            <td className="ui-compare__trend">
              {row.trend && <Trend direction={row.trend.direction}>{row.trend.text}</Trend>}
              {row.warning != null && <span className="ui-compare__warning">⚠ {row.warning}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export interface TimelineSegment {
  /** 始まりと終わり(0〜max) */
  start: number;
  end: number;
  /** 色(CSS の色。機能の CSS で決めた変数を使うとよい) */
  color: string;
  /** full: 帯の高さいっぱい(背景になる時間帯)、mark: 帯の下半分(できごとの印) */
  layer?: "full" | "mark";
  /** 長押しやマウスを重ねたときに出る説明 */
  title?: string;
}

export interface TimelineRow {
  label: ReactNode;
  segments: readonly TimelineSegment[];
  /** ここから先は、まだ来ていない時間として薄く表示する */
  until?: number;
  /** 縦線の印(例: 今の時刻) */
  marker?: number;
}

/**
 * 横向きの時間の帯(例: 0〜24時)。行ごとに、時間帯の背景と、できごとの印を重ねて描く。
 * 目盛りは ticks(0〜max の値)と、その表示 tickLabel で決める。
 */
export function Timeline({
  rows,
  max,
  ticks,
  tickLabel,
  legend,
}: {
  rows: readonly TimelineRow[];
  max: number;
  ticks: readonly number[];
  tickLabel: (value: number) => ReactNode;
  legend?: readonly { label: ReactNode; color: string }[];
}) {
  const pct = (v: number) => `${(Math.max(0, Math.min(max, v)) / max) * 100}%`;
  return (
    <div className="ui-timeline">
      {rows.map((row, i) => (
        <div key={i} className="ui-timeline__row">
          <div className="ui-timeline__label">{row.label}</div>
          <div className="ui-timeline__bar">
            {row.segments.map((seg, j) => (
              <span
                key={j}
                className={cx("ui-timeline__seg", seg.layer === "mark" && "ui-timeline__seg--mark")}
                style={{ left: pct(seg.start), width: pct(Math.max(seg.end - seg.start, 0)), background: seg.color }}
                title={seg.title}
              />
            ))}
            {row.until !== undefined && row.until < max && (
              <span className="ui-timeline__future" style={{ left: pct(row.until), width: pct(max - row.until) }} />
            )}
            {row.marker !== undefined && <span className="ui-timeline__marker" style={{ left: pct(row.marker) }} />}
          </div>
        </div>
      ))}
      <div className="ui-timeline__row ui-timeline__row--ticks" aria-hidden="true">
        <div className="ui-timeline__label" />
        <div className="ui-timeline__ticks">
          {ticks.map((t) => (
            <span key={t} style={{ left: pct(t) }}>
              {tickLabel(t)}
            </span>
          ))}
        </div>
      </div>
      {legend && (
        <ul className="ui-timeline__legend">
          {legend.map((item, i) => (
            <li key={i}>
              <span className="ui-timeline__swatch" style={{ background: item.color }} />
              {item.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
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

/** ファイルを選ぶボタン(選んだファイルを onSelect に渡す。同じファイルを選び直しても、もう一度呼ぶ) */
export function FileButton({
  children,
  accept,
  onSelect,
  disabled,
}: {
  children: ReactNode;
  accept?: string;
  onSelect: (file: File) => void;
  disabled?: boolean;
}) {
  return (
    <label className={cx("file-button", disabled && "file-button--disabled")}>
      {children}
      <input
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (file) onSelect(file);
        }}
      />
    </label>
  );
}

/**
 * 1日の中での進み具合を、1本の棒で見せる(今の値は1回だけ書く)。
 * - 棒の右端 = 1日の基準(goal。目安やふだんの1日分)
 * - 塗り = 今の値
 * - 点線 = 今の時刻までの基準(pace。ふだんの同じ時刻まで、など)
 * behind(今の時刻までの基準より少ない)なら、塗りを注意の色にする。
 */
export function PaceBar({
  label,
  value,
  valueText,
  goal,
  pace,
  behind = false,
  children,
}: {
  label: ReactNode;
  value: number;
  valueText: ReactNode;
  goal: { value: number; label: ReactNode } | null;
  pace: number | null;
  behind?: boolean;
  /** 棒の下に出す説明(差など) */
  children?: ReactNode;
}) {
  const max = goal && goal.value > 0 ? Math.max(goal.value, value) : Math.max(value, pace ?? 0, 1) * 1.2;
  const pct = (v: number) => `${Math.min(100, (Math.max(0, v) / max) * 100)}%`;
  return (
    <div className={cx("ui-pace", behind && "ui-pace--behind")}>
      <div className="ui-pace__head">
        <span className="ui-pace__label">{label}</span>
        <span className="ui-pace__value">{valueText}</span>
        {goal && <span className="ui-pace__goal">{goal.label}</span>}
      </div>
      <div className="ui-pace__track">
        <span className="ui-pace__bar" style={{ width: pct(value) }} />
        {goal && <span className="ui-pace__goal-mark" style={{ left: pct(goal.value) }} />}
        {pace !== null && <span className="ui-pace__pace" style={{ left: pct(pace) }} />}
      </div>
      {children && <div className="ui-pace__detail">{children}</div>}
    </div>
  );
}
