// ============ 生成插件图标（favicon.png / favicon@0.5x.png） ============
// 不引入任何图形库：直接按像素画一个「生词卡」图标，再用 zlib deflate 写成 PNG。
// 图形：深蓝圆角底 + 白色卡片 + 三条蓝色释义线（对应插件的蓝色词性徽章配色）。
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "../addon/content/icons");

const BG = [13, 71, 161, 255];      // #0d47a1 与弹窗词性徽章同色
const CARD = [255, 255, 255, 255];
const LINE = [13, 71, 161, 255];

/** 圆角矩形命中判定 */
function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function draw(size) {
  const px = Buffer.alloc(size * size * 4);
  const s = size / 96; // 以 96px 为设计基准等比缩放
  const put = (x, y, [r, g, b, a]) => {
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const X = x / s, Y = y / s;
      let color = null;
      // 背景圆角方块
      if (inRoundRect(X, Y, 2, 2, 94, 94, 18)) color = BG;
      // 白色卡片
      if (inRoundRect(X, Y, 20, 22, 76, 74, 6)) color = CARD;
      // 三条释义线（长度依次递减）
      const lines = [[38, 66], [50, 60], [62, 52]];
      for (const [ly, lx1] of lines) {
        if (inRoundRect(X, Y, 30, ly, lx1, ly + 5, 2.5)) color = LINE;
      }
      put(x, y, color || [0, 0, 0, 0]);
    }
  }
  return px;
}

// ---- 最小 PNG 编码器（RGBA，无隔行） ----
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type: RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace
  // 每行前面加一个 filter byte(0)
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });
const targets = [
  ["favicon.png", 96],
  ["favicon@0.5x.png", 48],
];
for (const [name, size] of targets) {
  const file = resolve(OUT_DIR, name);
  writeFileSync(file, encodePng(size, draw(size)));
  console.log(`✔ ${name} (${size}×${size}) → ${file}`);
}
