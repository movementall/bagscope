import { amountOf, countedValue, lotsFor, positionFromLots, totalValue, unrealized, valueOf, type Position } from '@shared/calc'
import { STABLES, type Holding, type Lot, type PriceHistory, type SeriesPoint, type TokenMeta } from '@shared/types'

export interface Row {
  h: Holding
  amount: number
  value: number | null
  counted: number
  alloc: number
  pos: Position
  upnl: number | null
  meta: TokenMeta
}

export function buildRows(holdings: Holding[], wallet: string | null, tokenMeta: Record<string, TokenMeta>, lots: Lot[]): { rows: Row[]; total: number } {
  const total = totalValue(holdings, wallet)
  const rows = holdings
    .map((h) => {
      const amount = amountOf(h, wallet)
      const pos = positionFromLots(lotsFor(lots, h.mint, wallet))
      const counted = countedValue(h, wallet)
      return { h, amount, value: valueOf(h, wallet), counted, alloc: total > 0 ? counted / total : 0, pos, upnl: unrealized(pos, amount, h.price), meta: tokenMeta[h.mint] ?? {} }
    })
    .filter((r) => r.amount > 0)
  return { rows, total }
}

export interface Perf {
  pct: number
  abs: number
  /** share of current portfolio value this figure is based on */
  coverage: number
}

/** Last close at or before `t` (unix seconds), if one exists within `maxGap` seconds. */
function closeAt(series: [number, number][], t: number, maxGap: number): number | null {
  let best: [number, number] | null = null
  for (const p of series) {
    if (p[0] > t) break
    best = p
  }
  return best && t - best[0] <= maxGap ? best[1] : null
}

function pastPrice(h: Holding, hist: PriceHistory | undefined, tSec: number): number | null {
  if (STABLES.has(h.mint)) return h.price
  if (!hist) return null
  return closeAt(hist.hour, tSec, 3 * 3600) ?? closeAt(hist.day, tSec, 2 * 86400)
}

/**
 * Price performance of the *current* holdings over a look-back window. Tokens
 * without history that far back are left out and lower the coverage figure;
 * below 85% coverage the caller shows no number.
 */
export function perfOver(holdings: Holding[], wallet: string | null, history: Record<string, PriceHistory>, days: number): Perf | null {
  const total = totalValue(holdings, wallet)
  if (total <= 0) return null
  const t = Date.now() / 1000 - days * 86400
  let now = 0
  let then = 0
  for (const h of holdings) {
    const v = countedValue(h, wallet)
    if (v <= 0) continue
    let past: number | null
    if (days === 1) past = h.change24h == null ? (STABLES.has(h.mint) ? h.price : null) : h.price! / (1 + h.change24h / 100)
    else past = pastPrice(h, history[h.mint], t)
    if (past == null || past <= 0) continue
    now += v
    then += amountOf(h, wallet) * past
  }
  if (then <= 0) return null
  return { pct: (now / then - 1) * 100, abs: now - then, coverage: now / total }
}

export type Range = '1D' | '7D' | '30D' | '90D' | '180D' | '1Y'
/** Range pickers show the two long ranges as 6M and 1Y. */
export const RANGE_OPTIONS: { value: Range; label: string }[] = [
  { value: '1D', label: '1D' },
  { value: '7D', label: '7D' },
  { value: '30D', label: '30D' },
  { value: '90D', label: '90D' },
  { value: '180D', label: '6M' },
  { value: '1Y', label: '1Y' }
]
const RANGE: Record<Range, { step: number; count: number }> = {
  '1D': { step: 3600, count: 24 },
  '7D': { step: 3600 * 4, count: 42 },
  '30D': { step: 86400, count: 30 },
  '90D': { step: 86400, count: 90 },
  '180D': { step: 86400 * 2, count: 90 },
  '1Y': { step: (365 * 86400) / 122, count: 122 }
}

/** Today's holdings valued at past prices. Tokens without history are held flat and reported via coverage. */
export function estimatedSeries(holdings: Holding[], wallet: string | null, history: Record<string, PriceHistory>, range: Range): { points: [number, number][]; coverage: number } {
  const { step, count } = RANGE[range]
  const nowSec = Math.floor(Date.now() / 1000)
  const start = nowSec - step * count
  const total = totalValue(holdings, wallet)
  const tracked: { h: Holding; amount: number }[] = []
  let flat = 0
  let covered = 0
  for (const h of holdings) {
    const v = countedValue(h, wallet)
    if (v <= 0) continue
    if (!STABLES.has(h.mint) && pastPrice(h, history[h.mint], start) != null) {
      tracked.push({ h, amount: amountOf(h, wallet) })
      covered += v
    } else {
      flat += v
      if (STABLES.has(h.mint)) covered += v
    }
  }
  if (!tracked.length || total <= 0) return { points: [], coverage: total > 0 ? covered / total : 0 }
  const points: [number, number][] = []
  for (let i = 0; i < count; i++) {
    const t = start + i * step
    let v = flat
    for (const { h, amount } of tracked) v += amount * (pastPrice(h, history[h.mint], t) ?? h.price!)
    points.push([t * 1000, v])
  }
  points.push([nowSec * 1000, total])
  return { points, coverage: covered / total }
}

export function recordedSeries(series: SeriesPoint[], wallet: string | null, range: Range, live: number): [number, number][] {
  const { step, count } = RANGE[range]
  const from = Date.now() - step * count * 1000
  const pts = series.filter((p) => p.ts >= from && (!wallet || wallet in p.byWallet)).map((p) => [p.ts, wallet ? p.byWallet[wallet] : p.total] as [number, number])
  return pts.length ? [...pts, [Date.now(), live]] : []
}

/** Total realized + unrealized PnL across every token that has a cost basis. */
export function allTimePnl(rows: Row[], lots: Lot[], wallet: string | null): { pnl: number; invested: number; unreal: number; realized: number } | null {
  let unreal = 0
  let realized = 0
  let invested = 0
  let any = false
  const held = new Set(rows.map((r) => r.h.mint))
  for (const r of rows) {
    if (!r.pos.buys && !r.pos.sells) continue
    any = true
    unreal += r.upnl ?? 0
    realized += r.pos.realized
    invested += r.pos.invested
  }
  // Fully exited positions still carry realized PnL.
  for (const mint of new Set(lots.map((l) => l.mint))) {
    if (held.has(mint)) continue
    const pos = positionFromLots(lotsFor(lots, mint, wallet))
    any = true
    realized += pos.realized
    invested += pos.invested
  }
  return any ? { pnl: unreal + realized, invested, unreal, realized } : null
}

/** Tickers used by more than one mint among the given tokens, keyed by lower-case symbol. */
export function tickerCollisions(tokens: Holding[]): Map<string, Holding[]> {
  const groups = new Map<string, Holding[]>()
  for (const h of tokens) {
    const key = h.symbol.trim().toLowerCase()
    if (!key || key.endsWith('…')) continue
    const list = groups.get(key) ?? []
    if (!list.some((x) => x.mint === h.mint)) list.push(h)
    groups.set(key, list)
  }
  for (const [k, v] of groups) if (v.length < 2) groups.delete(k)
  return groups
}

export function mood(pct: number | null): string {
  if (pct == null) return 'gm'
  if (pct >= 15) return 'sending it'
  if (pct >= 4) return 'cooking'
  if (pct >= 0.5) return 'comfy'
  if (pct > -0.5) return 'crabbing'
  if (pct > -5) return 'wobbly'
  if (pct > -15) return 'pain'
  return 'down bad'
}
