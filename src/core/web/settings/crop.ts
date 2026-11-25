/**
 * アイコンの切り抜き範囲の計算(画面に依存しない純粋な計算。テストで確認している)。
 * 切り抜き範囲は、元の画像の上の正方形(中心 cx, cy と一辺 side。単位は元画像の画素)。
 */

export interface CropState {
  cx: number;
  cy: number;
  side: number;
}

/** 拡大の上限(画像の短い辺の 1/8 まで切り抜ける) */
export const MAX_ZOOM = 8;

/** 最初は、画像の中央を、できるだけ大きな正方形で切り抜く。 */
export function initialCrop(width: number, height: number): CropState {
  return { cx: width / 2, cy: height / 2, side: Math.min(width, height) };
}

/** 切り抜き範囲が画像からはみ出さないように直す。 */
export function clampCrop(state: CropState, width: number, height: number): CropState {
  const maxSide = Math.min(width, height);
  const side = Math.min(maxSide, Math.max(maxSide / MAX_ZOOM, state.side));
  const half = side / 2;
  return {
    side,
    cx: Math.min(width - half, Math.max(half, state.cx)),
    cy: Math.min(height - half, Math.max(half, state.cy)),
  };
}

/** 現在の拡大率(1 = 短い辺いっぱい) */
export function zoomOf(state: CropState, width: number, height: number): number {
  return Math.min(width, height) / state.side;
}

/** 拡大率を変える(中心はそのまま)。 */
export function setZoom(state: CropState, zoom: number, width: number, height: number): CropState {
  return clampCrop({ ...state, side: Math.min(width, height) / zoom }, width, height);
}

/**
 * 画面上で指を動かした分だけ、画像を動かす。
 * 画像を右に動かす = 切り抜き範囲は左に動く。viewSize は表示枠の一辺(画面の画素)。
 */
export function panCrop(state: CropState, dx: number, dy: number, viewSize: number, width: number, height: number): CropState {
  const scale = state.side / viewSize;
  return clampCrop({ ...state, cx: state.cx - dx * scale, cy: state.cy - dy * scale }, width, height);
}

/** 描画に使う、元画像の上の切り抜き範囲(左上と一辺) */
export function cropRect(state: CropState): { sx: number; sy: number; size: number } {
  return { sx: state.cx - state.side / 2, sy: state.cy - state.side / 2, size: state.side };
}
