/**
 * 既定アイコン用の、小さなPNG生成処理(外部ライブラリなし)。
 * 背景色の正方形に、白い図形(本体は3×3の点、機能は円)を描く。
 * 生成したPNGは core_icons に保存し、2回目以降は保存したものを返す。
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function zlibDeflate(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** RGBA(1画素4バイト)の画素列を PNG にする。 */
export async function encodePng(width: number, height: number, rgba: Uint8Array): Promise<Uint8Array> {
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // フィルターなし
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8; // ビット深度
  ihdr[9] = 6; // RGBA
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", await zlibDeflate(raw)),
    chunk("IEND", new Uint8Array()),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    png.set(p, offset);
    offset += p.length;
  }
  return png;
}

function parseHexColor(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

export type IconShape = "grid" | "circle";

/** 1画素(RGBA)を、Uint32Array に書き込める1つの数にする(CPU のバイト順に依存しない書き方)。 */
function packPixel(r: number, g: number, b: number): number {
  return new Uint32Array(new Uint8Array([r, g, b, 255]).buffer)[0]!;
}

/**
 * 既定アイコンを描く。円の縁は1画素ぶんだけなめらかにする。
 * 無料プランの CPU 時間(1回10ms)に収まるよう、塗りつぶしはまとめて行い、計算は円の縁の画素だけにする。
 */
export async function renderDefaultIcon(size: number, color: string, shape: IconShape): Promise<Uint8Array> {
  const [r, g, b] = parseHexColor(color);
  const rgba = new Uint8Array(size * size * 4);
  const pixels = new Uint32Array(rgba.buffer);
  pixels.fill(packPixel(r, g, b));
  const white = packPixel(255, 255, 255);

  const circles: { cx: number; cy: number; radius: number }[] = [];
  if (shape === "circle") {
    circles.push({ cx: size / 2, cy: size / 2, radius: size * 0.27 });
  } else {
    const step = size * 0.22;
    for (let row = -1; row <= 1; row++) {
      for (let col = -1; col <= 1; col++) {
        circles.push({ cx: size / 2 + col * step, cy: size / 2 + row * step, radius: size * 0.075 });
      }
    }
  }

  // 画素の中心と円の中心の距離 d から、白の割合を clamp(radius + 0.5 - d) とする。
  const blendEdge = (x: number, y: number, dy: number, cx: number, radius: number) => {
    if (x < 0 || x >= size) return;
    const dx = x + 0.5 - cx;
    const coverage = Math.min(1, Math.max(0, radius + 0.5 - Math.sqrt(dx * dx + dy * dy)));
    if (coverage <= 0) return;
    const i = (y * size + x) * 4;
    rgba[i] = Math.round(rgba[i]! + (255 - rgba[i]!) * coverage);
    rgba[i + 1] = Math.round(rgba[i + 1]! + (255 - rgba[i + 1]!) * coverage);
    rgba[i + 2] = Math.round(rgba[i + 2]! + (255 - rgba[i + 2]!) * coverage);
  };

  for (const { cx, cy, radius } of circles) {
    const outer = radius + 0.5;
    const inner = radius - 0.5;
    const y0 = Math.max(0, Math.floor(cy - outer));
    const y1 = Math.min(size - 1, Math.ceil(cy + outer));
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy;
      if (Math.abs(dy) >= outer) continue;
      const halfOuter = Math.sqrt(outer * outer - dy * dy);
      const halfInner = Math.abs(dy) < inner ? Math.sqrt(inner * inner - dy * dy) : -1;
      // 完全に円の内側の画素は、まとめて白で塗る
      let fullStart = size;
      let fullEnd = -1;
      if (halfInner >= 0) {
        fullStart = Math.max(0, Math.ceil(cx - halfInner - 0.5));
        fullEnd = Math.min(size - 1, Math.floor(cx + halfInner - 0.5));
        if (fullEnd >= fullStart) pixels.fill(white, y * size + fullStart, y * size + fullEnd + 1);
      }
      // 縁の画素だけ、割合を計算して混ぜる
      const edgeLeft = Math.floor(cx - halfOuter - 0.5);
      const edgeRight = Math.ceil(cx + halfOuter - 0.5);
      if (fullEnd < fullStart) {
        for (let x = edgeLeft; x <= edgeRight; x++) blendEdge(x, y, dy, cx, radius);
      } else {
        for (let x = edgeLeft; x < fullStart; x++) blendEdge(x, y, dy, cx, radius);
        for (let x = fullEnd + 1; x <= edgeRight; x++) blendEdge(x, y, dy, cx, radius);
      }
    }
  }
  return encodePng(size, size, rgba);
}
