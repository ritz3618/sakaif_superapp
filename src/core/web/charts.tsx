/**
 * 共通のグラフ部品(外部の部品集を使わず、SVG で描く)。どの機能からも使える。
 * - 横軸は「区切り」(日・週・月など)の並び。count 個の区切りを等間隔に置き、値の位置は 0〜count の数で表す
 *   (区切り i の中央は i + 0.5)。
 * - 縦軸は1本だけ(単位の違う値は、別のグラフにする)。
 * - 押すと、その区切りが選ばれ(onSelect)、グラフの右上に、その区切りの値が出る。
 * - 色は CSS の変数(--chart-series、--chart-band)で決まる。機能の CSS で上書きできる。
 */
import type { MouseEvent, ReactNode } from "react";

const W = 340;
const PAD = { left: 38, right: 8, top: 8, bottom: 18 };

function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

/** 目盛りに使う、きりのよい数 */
function niceStep(range: number, ticks: number): number {
  const raw = range / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

/** min〜max を、きりのよい目盛り(3〜5本)で覆う */
function niceTicks(min: number, max: number): { lo: number; hi: number; ticks: number[] } {
  const step = niceStep(Math.max(max - min, 1e-9), 3);
  const lo = Math.floor(min / step) * step;
  const hi = Math.max(Math.ceil(max / step) * step, lo + step);
  const ticks: number[] = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(Math.round(t * 1000) / 1000);
  return { lo, hi, ticks };
}

interface Frame {
  count: number;
  height: number;
  yMin: number;
  yMax: number;
}

function scales({ count, height, yMin, yMax }: Frame) {
  const plotW = W - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  return {
    plotW,
    plotH,
    x: (pos: number) => PAD.left + (pos / count) * plotW,
    y: (v: number) => PAD.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH,
  };
}

function ChartHead({ title, value }: { title: ReactNode; value: ReactNode }) {
  return (
    <div className="ui-chart__head">
      <span className="ui-chart__title">{title}</span>
      <span className="ui-chart__value">{value}</span>
    </div>
  );
}

/** 縦軸の目盛り線と数、横軸の名前(間引く)、選ばれた区切りの帯 */
function Axes({
  frame,
  ticks,
  labels,
  selected,
  format,
}: {
  frame: Frame;
  ticks: number[];
  labels: readonly string[];
  selected: number | null;
  format: (v: number) => string;
}) {
  const s = scales(frame);
  const every = Math.ceil(labels.length / 6);
  return (
    <>
      {selected !== null && (
        <rect className="ui-chart__selected" x={s.x(selected)} y={PAD.top} width={s.plotW / frame.count} height={s.plotH} />
      )}
      {ticks.map((t) => (
        <g key={t}>
          <line className="ui-chart__grid" x1={PAD.left} x2={W - PAD.right} y1={s.y(t)} y2={s.y(t)} />
          <text className="ui-chart__tick" x={PAD.left - 4} y={s.y(t)} textAnchor="end" dominantBaseline="middle">
            {format(t)}
          </text>
        </g>
      ))}
      {labels.map((l, i) =>
        (labels.length - 1 - i) % every === 0 ? (
          <text key={i} className="ui-chart__tick" x={s.x(i + 0.5)} y={frame.height - 4} textAnchor="middle">
            {l}
          </text>
        ) : null,
      )}
    </>
  );
}

function pick(e: MouseEvent<SVGSVGElement>, count: number): number | null {
  const box = e.currentTarget.getBoundingClientRect();
  const px = ((e.clientX - box.left) / box.width) * W;
  const pos = ((px - PAD.left) / (W - PAD.left - PAD.right)) * count;
  return pos < 0 || pos >= count ? null : Math.floor(pos);
}

export interface BarChartProps {
  title: ReactNode;
  labels: readonly string[];
  values: readonly (number | null)[];
  /** 途中の区切り(今日など)。薄く描く */
  partial?: readonly boolean[];
  /** 目安などの横線 */
  reference?: { value: number; label: string } | null;
  /** 選んだときの値の書き方 */
  format: (v: number) => string;
  /** 縦軸の目盛りの書き方(短く。省略時は format) */
  tick?: (v: number) => string;
  selected: number | null;
  onSelect: (index: number | null) => void;
  height?: number;
}

/** 棒グラフ(1つの値の推移。0 から始まる) */
export function BarChart({ title, labels, values, partial, reference, format, tick, selected, onSelect, height = 120 }: BarChartProps) {
  const count = labels.length;
  const top = Math.max(...values.map((v) => v ?? 0), reference?.value ?? 0, 1);
  const { hi: yMax, ticks } = niceTicks(0, top);
  const frame = { count, height, yMin: 0, yMax };
  const s = scales(frame);
  const band = s.plotW / count;
  const w = Math.max(2, band - 2);
  const r = Math.min(4, w / 2);
  const current = selected !== null ? values[selected] : null;
  return (
    <figure className="ui-chart">
      <ChartHead
        title={title}
        value={selected !== null ? `${labels[selected]}: ${current === null || current === undefined ? "記録なし" : format(current)}` : ""}
      />
      <svg viewBox={`0 0 ${W} ${height}`} className="ui-chart__svg" role="img" aria-label={String(title)} onClick={(e) => onSelect(pick(e, count))}>
        <Axes frame={frame} ticks={ticks} labels={labels} selected={selected} format={tick ?? format} />
        {values.map((v, i) => {
          if (v === null || v <= 0) return null;
          const x = s.x(i) + (band - w) / 2;
          const y = s.y(v);
          const base = s.y(0);
          const h = Math.max(1, base - y);
          const rr = Math.min(r, h);
          return (
            <path
              key={i}
              className={cx("ui-chart__bar", partial?.[i] && "ui-chart__bar--partial")}
              d={`M${x},${base} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${base} Z`}
            />
          );
        })}
        {reference && (
          <g>
            <line className="ui-chart__reference" x1={PAD.left} x2={W - PAD.right} y1={s.y(reference.value)} y2={s.y(reference.value)} />
            <text className="ui-chart__reference-label" x={W - PAD.right} y={s.y(reference.value) - 3} textAnchor="end">
              {reference.label}
            </text>
          </g>
        )}
      </svg>
    </figure>
  );
}

export interface LinePoint {
  /** 横の位置(0〜count。区切り i の中央は i + 0.5) */
  x: number;
  y: number;
}

export interface LineChartProps {
  title: ReactNode;
  labels: readonly string[];
  points: readonly LinePoint[];
  /** 線のまわりの帯(最低〜最高など) */
  band?: readonly { x: number; lo: number; hi: number }[];
  /** 縦軸の目盛りの書き方 */
  format: (v: number) => string;
  /** 選ばれた区切りの値の文(無ければ「記録なし」) */
  valueAt: (index: number) => string | null;
  selected: number | null;
  onSelect: (index: number | null) => void;
  height?: number;
}

/** 折れ線グラフ(縦軸は値の範囲に合わせる)。点が40個までなら、点に印を付ける */
export function LineChart({ title, labels, points, band, format, valueAt, selected, onSelect, height = 120 }: LineChartProps) {
  const showDots = points.length <= 40;
  const count = labels.length;
  const all = [...points.map((p) => p.y), ...(band ?? []).flatMap((b) => [b.lo, b.hi])];
  let lo = all.length ? Math.min(...all) : 0;
  let hi = all.length ? Math.max(...all) : 1;
  // 値が1つだけ・ほぼ同じときは、少し幅を持たせる(目盛りが重ならないように)
  const minSpan = Math.max(Math.abs(hi) * 0.02, 0.2);
  if (hi - lo < minSpan) {
    lo -= minSpan / 2;
    hi += minSpan / 2;
  }
  const { lo: yMin, hi: yMax, ticks } = niceTicks(lo, hi);
  const frame = { count, height, yMin, yMax };
  const s = scales(frame);
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const bands = [...(band ?? [])].sort((a, b) => a.x - b.x);
  const current = selected !== null ? valueAt(selected) : null;
  return (
    <figure className="ui-chart">
      <ChartHead title={title} value={selected !== null ? `${labels[selected]}: ${current ?? "記録なし"}` : ""} />
      <svg viewBox={`0 0 ${W} ${height}`} className="ui-chart__svg" role="img" aria-label={String(title)} onClick={(e) => onSelect(pick(e, count))}>
        <Axes frame={frame} ticks={ticks} labels={labels} selected={selected} format={format} />
        {bands.length > 1 && (
          <path
            className="ui-chart__band"
            d={`M${bands.map((b) => `${s.x(b.x)},${s.y(b.hi)}`).join(" L")} L${[...bands].reverse().map((b) => `${s.x(b.x)},${s.y(b.lo)}`).join(" L")} Z`}
          />
        )}
        {bands.length === 1 && (
          <line className="ui-chart__whisker" x1={s.x(bands[0]!.x)} x2={s.x(bands[0]!.x)} y1={s.y(bands[0]!.lo)} y2={s.y(bands[0]!.hi)} />
        )}
        {sorted.length > 1 && <polyline className="ui-chart__line" points={sorted.map((p) => `${s.x(p.x)},${s.y(p.y)}`).join(" ")} />}
        {(showDots || sorted.length === 1) &&
          sorted.map((p, i) => <circle key={i} className="ui-chart__dot" cx={s.x(p.x)} cy={s.y(p.y)} r={4} />)}
      </svg>
    </figure>
  );
}
