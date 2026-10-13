// Draws the Bagscope mark (accent-green rounded square with a dark "B") without any
// image libraries and writes build/icon.ico, build/icon.png and the installer sidebar.
// Run: node scripts/make-icon.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateSync } from 'node:zlib'

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'build')
mkdirSync(out, { recursive: true })

const INK = [6, 19, 12]
// The letter B as one continuous stroke: stem, upper bowl, lower bowl (bowls are sampled arcs).
const arc = (cx, cy, r, steps = 14) => Array.from({ length: steps + 1 }, (_, i) => { const a = -Math.PI / 2 + (Math.PI * i) / steps; return [cx + r * Math.cos(a), cy + r * Math.sin(a)] })
const M = [[0.34, 0.715], [0.34, 0.285], [0.5, 0.285], ...arc(0.5, 0.385, 0.1), [0.34, 0.485], [0.53, 0.485], ...arc(0.53, 0.6, 0.115), [0.34, 0.715]]
const STROKE = 0.05

const mix = (a, b, t) => a + (b - a) * t

function distToSegment(px, py, [ax, ay], [bx, by]) {
  const [dx, dy] = [bx - ax, by - ay]
  const len2 = dx * dx + dy * dy
  // Two identical points make a zero-length segment; treat it as a dot instead of dividing by zero.
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0
  return Math.hypot(px - ax - dx * t, py - ay - dy * t)
}

/** Colour of the mark at a point in the unit square, or null outside the rounded square. */
function mark(u, v) {
  const inset = 0.035
  const radius = 0.225
  const half = 0.5 - inset
  const qx = Math.abs(u - 0.5) - (half - radius)
  const qy = Math.abs(v - 0.5) - (half - radius)
  const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius
  if (d > 0) return null
  let glyph = Infinity
  for (let i = 0; i < M.length - 1; i++) glyph = Math.min(glyph, distToSegment(u, v, M[i], M[i + 1]))
  if (glyph <= STROKE) return INK
  // Diagonal gradient: brighter mint at the top-left, deeper green at the bottom-right.
  const t = (u + v) / 2
  return [mix(116, 34, t), mix(255, 232, t), mix(196, 140, t)]
}

/** Renders the mark to RGBA with supersampled edges. */
function render(size) {
  const ss = size <= 32 ? 8 : 4
  const px = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let [r, g, b, a] = [0, 0, 0, 0]
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = mark((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size)
          if (c) {
            r += c[0]
            g += c[1]
            b += c[2]
            a++
          }
        }
      }
      const i = (y * size + x) * 4
      if (a) {
        px[i] = r / a
        px[i + 1] = g / a
        px[i + 2] = b / a
        px[i + 3] = (a / (ss * ss)) * 255
      }
    }
  }
  return px
}

function png(size, rgba) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data])
    const head = Buffer.alloc(4)
    head.writeUInt32BE(data.length)
    const tail = Buffer.alloc(4)
    tail.writeUInt32BE(crc32(body))
    return Buffer.concat([head, body, tail])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr.set([8, 6, 0, 0, 0], 8)
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

/** Classic 32-bit DIB icon image (BGRA, bottom-up, followed by an empty AND mask). */
function dib(size, rgba) {
  const head = Buffer.alloc(40)
  head.writeUInt32LE(40, 0)
  head.writeInt32LE(size, 4)
  head.writeInt32LE(size * 2, 8)
  head.writeUInt16LE(1, 12)
  head.writeUInt16LE(32, 14)
  const body = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = (y * size + x) * 4
      const d = ((size - 1 - y) * size + x) * 4
      body[d] = rgba[s + 2]
      body[d + 1] = rgba[s + 1]
      body[d + 2] = rgba[s]
      body[d + 3] = rgba[s + 3]
    }
  }
  return Buffer.concat([head, body, Buffer.alloc(Math.ceil(size / 32) * 4 * size)])
}

const sizes = [256, 128, 64, 48, 32, 24, 16]
const images = sizes.map((s) => (s === 256 ? png(s, render(s)) : dib(s, render(s))))
const header = Buffer.alloc(6)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(sizes.length, 4)
let offset = 6 + 16 * sizes.length
const entries = sizes.map((s, i) => {
  const e = Buffer.alloc(16)
  e[0] = s === 256 ? 0 : s
  e[1] = s === 256 ? 0 : s
  e.writeUInt16LE(1, 4)
  e.writeUInt16LE(32, 6)
  e.writeUInt32LE(images[i].length, 8)
  e.writeUInt32LE(offset, 12)
  offset += images[i].length
  return e
})
writeFileSync(join(out, 'icon.ico'), Buffer.concat([header, ...entries, ...images]))
writeFileSync(join(out, 'icon.png'), png(512, render(512)))

// Installer sidebar: 164x314, 24-bit BMP. Dark panel, soft green glow, the mark near the top.
const [W, H] = [164, 314]
const logo = { size: 76, x: 44, y: 54, px: render(76) }
const bmp = Buffer.alloc(54 + W * H * 3)
bmp.write('BM')
bmp.writeUInt32LE(bmp.length, 2)
bmp.writeUInt32LE(54, 10)
bmp.writeUInt32LE(40, 14)
bmp.writeInt32LE(W, 18)
bmp.writeInt32LE(H, 22)
bmp.writeUInt16LE(1, 26)
bmp.writeUInt16LE(24, 28)
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const glow = Math.max(0, 1 - Math.hypot(x - 82, y - 92) / 190) ** 2 * 0.34
    let c = [mix(8, 61, glow), mix(9, 255, glow), mix(11, 162, glow)]
    const [lx, ly] = [x - logo.x, y - logo.y]
    if (lx >= 0 && ly >= 0 && lx < logo.size && ly < logo.size) {
      const i = (ly * logo.size + lx) * 4
      const a = logo.px[i + 3] / 255
      c = [mix(c[0], logo.px[i], a), mix(c[1], logo.px[i + 1], a), mix(c[2], logo.px[i + 2], a)]
    }
    const d = 54 + ((H - 1 - y) * W + x) * 3
    bmp[d] = c[2]
    bmp[d + 1] = c[1]
    bmp[d + 2] = c[0]
  }
}
writeFileSync(join(out, 'installerSidebar.bmp'), bmp)
console.log('Wrote build/icon.ico, build/icon.png, build/installerSidebar.bmp')
