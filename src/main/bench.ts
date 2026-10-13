// Benchmark price series for the portfolio comparison chart.
//
// Everything uses the same Jupiter price candles as the rest of the app: BTC and ETH
// through their wrapped Solana tokens, and the S&P 500, Nasdaq 100 and gold through
// tokenised funds that track them (SPYx, QQQx, GLDx). Every series reports its source.

import { SOL_MINT, type BenchSeries, type Candle } from '@shared/types'
import { errMsg } from './http'
import { jupCandles } from './market'

interface Bench {
  label: string
  mint?: string
  /** set for benchmarks followed through a tokenised version of the real asset */
  tracks?: string
  /** equal-weight basket of mints */
  basket?: string[]
}

const MEME_BASKET = [
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK
  'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', // WIF
  '6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN', // TRUMP
  '2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv', // PENGU
  '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump', // Fartcoin
  '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', // POPCAT
  '2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump', // PNUT
  'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5' // MEW
]

const BENCH: Record<string, Bench> = {
  sol: { label: 'SOL', mint: SOL_MINT },
  btc: { label: 'Bitcoin', mint: '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh' },
  eth: { label: 'Ethereum', mint: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs' },
  meme: { label: 'Meme index', basket: MEME_BASKET },
  spx: { label: 'S&P 500', tracks: 'SPYx, a tokenised S&P 500 fund', mint: 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W' },
  ndx: { label: 'Nasdaq 100', tracks: 'QQQx, a tokenised Nasdaq 100 fund', mint: 'Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ' },
  gold: { label: 'Gold', tracks: 'GLDx, a tokenised gold fund', mint: 'Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re' }
}

interface Spec {
  seconds: number
  jup: [string, number]
  ttl: number
}

// Each request reaches back further than the window so there is a price to anchor the start on.
const RANGES: Record<string, Spec> = {
  '1D': { seconds: 86400, jup: ['15_MINUTE', 130], ttl: 120_000 },
  '7D': { seconds: 7 * 86400, jup: ['1_HOUR', 200], ttl: 600_000 },
  '30D': { seconds: 30 * 86400, jup: ['4_HOUR', 210], ttl: 1800_000 },
  '90D': { seconds: 90 * 86400, jup: ['1_DAY', 110], ttl: 3600_000 },
  '180D': { seconds: 180 * 86400, jup: ['1_DAY', 200], ttl: 3600_000 },
  '1Y': { seconds: 365 * 86400, jup: ['1_DAY', 385], ttl: 3600_000 }
}

const toPoints = (candles: Candle[]): [number, number][] => candles.map((c) => [c.t * 1000, c.c])

/** Keeps the window plus the last point before it, so the start can be anchored on a real price. */
function trim(points: [number, number][], startMs: number): [number, number][] {
  let first = 0
  for (let i = 0; i < points.length; i++) if (points[i][0] <= startMs) first = i
  return points.slice(first)
}

function priceAt(points: [number, number][], t: number): number | null {
  let best: number | null = null
  for (const p of points) {
    if (p[0] > t) break
    best = p[1]
  }
  return best
}

/** Equal-weight basket: the average of each coin's growth since the window start, as an index starting at 100. */
async function basket(mints: string[], spec: Spec, startMs: number): Promise<{ points: [number, number][]; used: number }> {
  const all = await Promise.all(mints.map((m) => jupCandles(m, spec.jup[0], spec.jup[1], spec.ttl).then(toPoints, () => [] as [number, number][])))
  const usable = all.map((pts) => ({ pts, base: priceAt(pts, startMs) })).filter((x): x is { pts: [number, number][]; base: number } => x.base != null && x.base > 0)
  if (!usable.length) throw new Error('No price history for the basket')
  const steps = 140
  const now = Date.now()
  const points: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const t = startMs + ((now - startMs) * i) / steps
    let sum = 0
    for (const u of usable) sum += (priceAt(u.pts, t) ?? u.base) / u.base
    points.push([t, (sum / usable.length) * 100])
  }
  return { points, used: usable.length }
}

export async function benchSeries(ids: string[], range: string): Promise<BenchSeries[]> {
  const spec = RANGES[range] ?? RANGES['7D']
  const startMs = Date.now() - spec.seconds * 1000
  return Promise.all(
    ids
      .filter((id) => Object.hasOwn(BENCH, id))
      .map(async (id): Promise<BenchSeries> => {
        const b = BENCH[id]
        try {
          if (b.basket) {
            const { points, used } = await basket(b.basket, spec, startMs)
            return { id, points, source: `Equal-weight basket of ${used} Solana meme coins (BONK, WIF, TRUMP, PENGU, Fartcoin, POPCAT, PNUT, MEW) · Jupiter`, error: null }
          }
          const points = trim(toPoints(await jupCandles(b.mint!, spec.jup[0], spec.jup[1], spec.ttl)), startMs)
          if (points.length < 2) throw new Error('No price history in this range')
          return { id, points, source: b.tracks ? `${b.label}, followed through ${b.tracks} on Solana · Jupiter` : `${b.label} · Jupiter aggregated price`, error: null }
        } catch (e) {
          return { id, points: [], source: '', error: errMsg(e) }
        }
      })
  )
}
