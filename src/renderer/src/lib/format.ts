const SUB = '₀₁₂₃₄₅₆₇₈₉'

/** Prices: two decimals above $1, then enough precision to be meaningful. Tiny prices use 0.0₅123 notation. */
export function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const a = Math.abs(n)
  if (a === 0) return '$0.00'
  if (a >= 1) return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  if (a >= 0.01) return `$${n.toFixed(4)}`
  if (a >= 0.0001) return `$${n.toFixed(6)}`
  const zeros = Math.max(0, -Math.floor(Math.log10(a)) - 1)
  const digits = (a * 10 ** (zeros + 4)).toFixed(0).slice(0, 4)
  const sub = String(zeros).split('').map((d) => SUB[Number(d)]).join('')
  return `${n < 0 ? '-' : ''}$0.0${sub}${digits}`
}

export function fmtUsd(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const sign = n < 0 ? '-' : ''
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
}

export function fmtSigned(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${n >= 0 ? '+' : '-'}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function fmtCompact(n: number | null | undefined, prefix = ''): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const a = Math.abs(n)
  const f = (v: number, s: string): string => `${prefix}${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)}${s}`
  if (a >= 1e12) return f(n / 1e12, 'T')
  if (a >= 1e9) return f(n / 1e9, 'B')
  if (a >= 1e6) return f(n / 1e6, 'M')
  if (a >= 1e3) return f(n / 1e3, 'K')
  return `${prefix}${n.toLocaleString('en-US', { maximumFractionDigits: a >= 1 ? 2 : 6 })}`
}

export function fmtPct(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const a = Math.abs(n)
  return `${n >= 0 ? '+' : '-'}${a >= 1000 ? fmtCompact(a) : a.toFixed(digits)}%`
}

export const cls = (n: number | null | undefined): string => (n == null || Math.abs(n) < 1e-9 ? 'muted' : n > 0 ? 'up' : 'down')

export const shortAddr = (a: string, n = 4): string => (a.length > n * 2 + 2 ? `${a.slice(0, n)}…${a.slice(-n)}` : a)

export function timeAgo(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return 'never'
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export const fmtDateTime = (ts: number): string =>
  new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
export const fmtDate = (ts: number): string => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((r) => r.map((c) => (c == null ? '' : /[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(',')).join('\r\n')
}

/** Black or white ink for text on top of an arbitrary accent colour. */
export function inkFor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return '#04130b'
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#06100b' : '#ffffff'
}

export const PALETTE = ['#3DFFA2', '#FF4D9D', '#3DE0FF', '#FF8A3D', '#9B7BFF', '#FFD23D', '#5B8CFF', '#FF6B6B', '#7CF5D0', '#C6F135']
