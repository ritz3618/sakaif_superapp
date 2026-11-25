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

/** 既定アイコンを描く。円の縁は1画素ぶんだけなめらかにする。 */
export async function renderDefaultIcon(size: number, color: string, shape: IconShape): Promise<Uint8Array> {
  const [r, g, b] = parseHexColor(color);
  const rgba = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = 255;
  }

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

  for (const { cx, cy, radius } of circles) {
    const x0 = Math.max(0, Math.floor(cx - radius - 1));
    const x1 = Math.min(size - 1, Math.ceil(cx + radius + 1));
    const y0 = Math.max(0, Math.floor(cy - radius - 1));
    const y1 = Math.min(size - 1, Math.ceil(cy + radius + 1));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        const coverage = Math.min(1, Math.max(0, radius + 0.5 - d));
        if (coverage <= 0) continue;
        const i = (y * size + x) * 4;
        rgba[i] = Math.round(rgba[i]! + (255 - rgba[i]!) * coverage);
        rgba[i + 1] = Math.round(rgba[i + 1]! + (255 - rgba[i + 1]!) * coverage);
        rgba[i + 2] = Math.round(rgba[i + 2]! + (255 - rgba[i + 2]!) * coverage);
      }
    }
  }
  return encodePng(size, size, rgba);
}
