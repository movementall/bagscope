import {
  SOL_MINT,
  STABLES,
  type Candle,
  type ChartRange,
  type PriceHistory,
  type PriceSource,
  type RiskFactor,
  type TokenInsight,
  type WhaleTrade
} from '@shared/types'
import { chunk, errMsg, fetchJson, limiter } from './http'
import { cacheGet, cacheSet } from './store'

const JUP_HOSTS = ['https://lite-api.jup.ag', 'https://api.jup.ag']
const jupGate = limiter(320)
const dexGate = limiter(250)
const geckoGate = limiter(2300) // GeckoTerminal allows ~30 calls/min
const rugGate = limiter(1000)

export async function jup<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let last: unknown
  for (const host of JUP_HOSTS) {
    try {
      return await jupGate(() => fetchJson<T>(host + path, { ...init, retries: 1 }))
    } catch (e) {
      last = e
    }
  }
  throw last
}

// ---------- prices ----------

export interface PriceQuote {
  price: number
  change24h: number | null
  liquidity: number | null
  source: PriceSource
}

interface DexPair {
  chainId: string
  dexId: string
  url: string
  pairAddress: string
  baseToken: { address: string; name: string; symbol: string }
  quoteToken: { address: string; symbol: string }
  priceUsd?: string
  volume?: { h24?: number }
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number }
  liquidity?: { usd?: number }
  fdv?: number
  marketCap?: number
  pairCreatedAt?: number
  info?: { imageUrl?: string; websites?: { url: string; label?: string }[]; socials?: { url: string; type: string }[] }
}

const pairMemo = new Map<string, { at: number; pair: DexPair | null }>()

/**
 * The main pool for a token: the pair with the deepest USD liquidity where the
 * token is the base asset. DexScreener does not return pairs in liquidity order.
 */
export async function bestPairs(mints: string[], maxAgeMs = 60_000): Promise<Map<string, DexPair | null>> {
  const out = new Map<string, DexPair | null>()
  const need: string[] = []
  for (const m of mints) {
    const hit = pairMemo.get(m)
    if (hit && Date.now() - hit.at < maxAgeMs) out.set(m, hit.pair)
    else need.push(m)
  }
  for (const group of chunk(need, 30)) {
    const pairs = await dexGate(() =>
      fetchJson<DexPair[]>(`https://api.dexscreener.com/tokens/v1/solana/${group.join(',')}`)
    )
    for (const mint of group) {
      const best = pairs
        .filter((p) => p.chainId === 'solana' && p.baseToken.address === mint && Number(p.priceUsd) > 0)
        .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0]
      pairMemo.set(mint, { at: Date.now(), pair: best ?? null })
      out.set(mint, best ?? null)
    }
  }
  return out
}

interface JupPrice {
  usdPrice: number
  priceChange24h?: number
  liquidity?: number
}

/**
 * Jupiter's aggregated price first (it already rejects unreliable pools), then the
 * deepest DexScreener pool for anything Jupiter does not price. A mint missing
 * from the result has no trustworthy price; it is never guessed.
 */
export async function getPrices(mints: string[]): Promise<Map<string, PriceQuote>> {
  const out = new Map<string, PriceQuote>()
  let jupFailed: unknown = null
  for (const group of chunk(mints, 50)) {
    try {
      const res = await jup<Record<string, JupPrice | null>>(`/price/v3?ids=${group.join(',')}`)
      for (const [mint, p] of Object.entries(res)) {
        if (p && p.usdPrice > 0 && Number.isFinite(p.usdPrice)) {
          out.set(mint, { price: p.usdPrice, change24h: p.priceChange24h ?? null, liquidity: p.liquidity ?? null, source: 'jupiter' })
        }
      }
    } catch (e) {
      jupFailed = e
    }
  }
  const missing = mints.filter((m) => !out.has(m))
  if (missing.length) {
    try {
      // Unpriced wallets are mostly spam; only the first few hundred are worth a lookup.
      const pairs = await bestPairs(missing.slice(0, 300))
      for (const [mint, p] of pairs) {
        if (!p) continue
        out.set(mint, {
          price: Number(p.priceUsd),
          change24h: p.priceChange?.h24 ?? null,
          liquidity: p.liquidity?.usd ?? null,
          source: 'dexscreener'
        })
      }
    } catch (e) {
      if (jupFailed) throw new Error(`Price sources unavailable (${errMsg(jupFailed)}; ${errMsg(e)})`)
      // Jupiter answered for everything it knows; a DexScreener outage only affects long-tail tokens.
    }
  }
  if (jupFailed && !out.size) throw new Error(`Price sources unavailable (${errMsg(jupFailed)})`)
  return out
}

// ---------- metadata ----------

interface JupToken {
  id: string
  name: string
  symbol: string
  icon?: string
  decimals: number
  dev?: string
  circSupply?: number
  totalSupply?: number
  holderCount?: number
  fdv?: number
  mcap?: number
  usdPrice?: number
  liquidity?: number
  isVerified?: boolean
  firstPool?: { createdAt?: string }
  audit?: { mintAuthorityDisabled?: boolean; freezeAuthorityDisabled?: boolean; topHoldersPercentage?: number; devBalancePercentage?: number }
  stats5m?: { priceChange?: number }
  stats1h?: { priceChange?: number }
  stats6h?: { priceChange?: number }
  stats24h?: { priceChange?: number; buyVolume?: number; sellVolume?: number }
}

export interface Meta {
  symbol: string
  name: string
  icon: string | null
  verified: boolean
  circSupply: number | null
  known: boolean
}

const META_TTL = 24 * 3600_000

export async function getMeta(mints: string[]): Promise<Map<string, Meta>> {
  const out = new Map<string, Meta>()
  const need: string[] = []
  for (const m of mints) {
    const hit = cacheGet<Meta>(`meta:${m}`, META_TTL)
    if (hit) out.set(m, hit)
    else need.push(m)
  }
  for (const group of chunk(need, 100)) {
    let tokens: JupToken[]
    try {
      tokens = await jup<JupToken[]>(`/tokens/v2/search?query=${group.join(',')}`)
    } catch {
      continue // metadata is cosmetic; balances and prices still render with short addresses
    }
    const byId = new Map(tokens.map((t) => [t.id, t]))
    for (const mint of group) {
      const t = byId.get(mint)
      const meta: Meta = t
        ? { symbol: t.symbol, name: t.name, icon: t.icon ?? null, verified: !!t.isVerified, circSupply: t.circSupply ?? null, known: true }
        : { symbol: `${mint.slice(0, 4)}…`, name: 'Unknown token', icon: null, verified: false, circSupply: null, known: false }
      if (mint === SOL_MINT) Object.assign(meta, { symbol: 'SOL', name: 'Solana' })
      cacheSet(`meta:${mint}`, meta)
      out.set(mint, meta)
    }
  }
  return out
}

export async function searchTokens(query: string): Promise<{ mint: string; symbol: string; name: string; icon: string | null; verified: boolean; price: number | null; liquidity: number | null; decimals: number }[]> {
  const tokens = await jup<JupToken[]>(`/tokens/v2/search?query=${encodeURIComponent(query.trim())}`)
  return tokens.slice(0, 12).map((t) => ({
    mint: t.id,
    symbol: t.symbol,
    name: t.name,
    icon: t.icon ?? null,
    verified: !!t.isVerified,
    price: t.usdPrice ?? null,
    liquidity: t.liquidity ?? null,
    decimals: t.decimals
  }))
}

// ---------- charts ----------
// Primary: Jupiter's aggregated price candles (fast, no pool lookup, same price the
// portfolio uses). Fallback: GeckoTerminal OHLCV of the token's deepest pool.

const candleMemo = new Map<string, { at: number; candles: Candle[] }>()
const chartGate = limiter(90)

async function memo(key: string, ttlMs: number, load: () => Promise<Candle[]>): Promise<Candle[]> {
  const hit = candleMemo.get(key)
  if (hit && Date.now() - hit.at < ttlMs) return hit.candles
  const candles = await load()
  candleMemo.set(key, { at: Date.now(), candles })
  if (candleMemo.size > 400) candleMemo.delete(candleMemo.keys().next().value!)
  return candles
}

export function jupCandles(mint: string, interval: string, count: number, ttlMs: number, urgent = false): Promise<Candle[]> {
  return memo(`jup:${mint}:${interval}:${count}`, ttlMs, async () => {
    const res = await chartGate(
      () =>
        fetchJson<{ candles?: { time: number; open: number; high: number; low: number; close: number; volume: number }[] }>(
          `https://datapi.jup.ag/v2/charts/${mint}?interval=${interval}&to=${Date.now()}&candles=${count}&type=price&quote=usd`,
          { retries: 1, timeoutMs: 12_000 }
        ),
      urgent
    )
    return (res.candles ?? [])
      .filter((c) => c.close > 0 && Number.isFinite(c.close))
      .map((c) => ({ t: c.time, o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume }))
      .sort((a, b) => a.t - b.t)
  })
}

type Timeframe = 'minute' | 'hour' | 'day'

function geckoCandles(pool: string, mint: string, tf: Timeframe, aggregate: number, limit: number, ttlMs: number, urgent = false): Promise<Candle[]> {
  return memo(`gecko:${pool}:${mint}:${tf}:${aggregate}:${limit}`, ttlMs, async () => {
    const res = await geckoGate(
      () =>
        fetchJson<{ data: { attributes: { ohlcv_list: number[][] } } }>(
          `https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/ohlcv/${tf}?aggregate=${aggregate}&limit=${limit}&currency=usd&token=${mint}`
        ),
      urgent
    )
    return res.data.attributes.ohlcv_list.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v })).sort((a, b) => a.t - b.t)
  })
}

interface RangeSpec {
  interval: string
  count: number
  /** window in seconds; candles only exist where trades happened, so we over-fetch and trim by time */
  window: number | null
  ttl: number
  gecko: [Timeframe, number, number]
}

const RANGES: Record<ChartRange, RangeSpec> = {
  '1H': { interval: '1_MINUTE', count: 90, window: 3600, ttl: 20_000, gecko: ['minute', 1, 60] },
  '1D': { interval: '5_MINUTE', count: 320, window: 86400, ttl: 60_000, gecko: ['minute', 5, 288] },
  '1W': { interval: '30_MINUTE', count: 360, window: 7 * 86400, ttl: 300_000, gecko: ['hour', 1, 168] },
  '1M': { interval: '4_HOUR', count: 200, window: 30 * 86400, ttl: 900_000, gecko: ['hour', 4, 180] },
  '3M': { interval: '1_DAY', count: 95, window: 90 * 86400, ttl: 3600_000, gecko: ['day', 1, 90] },
  ALL: { interval: '1_DAY', count: 1000, window: null, ttl: 3600_000, gecko: ['day', 1, 1000] }
}

export async function getChart(mint: string, range: ChartRange): Promise<{ candles: Candle[]; source: string }> {
  const spec = RANGES[range]
  const since = spec.window ? Date.now() / 1000 - spec.window : 0
  let jupError: unknown = null
  try {
    const candles = (await jupCandles(mint, spec.interval, spec.count, spec.ttl, true)).filter((c) => c.t >= since)
    if (candles.length >= 2) return { candles, source: 'Jupiter aggregated price' }
  } catch (e) {
    jupError = e
  }
  const pair = (await bestPairs([mint], 600_000).catch(() => new Map<string, DexPair | null>())).get(mint)
  if (!pair) {
    if (jupError) throw new Error(`Chart data unavailable. ${errMsg(jupError)}`)
    throw new Error(range === 'ALL' ? 'No price history exists for this token yet.' : `No trades in the last ${range}. Try a longer range.`)
  }
  const [tf, agg, limit] = spec.gecko
  const candles = (await geckoCandles(pair.pairAddress, mint, tf, agg, limit, spec.ttl, true)).filter((c) => c.t >= since)
  if (candles.length < 2) throw new Error(range === 'ALL' ? 'No price history exists for this token yet.' : `No trades in the last ${range}. Try a longer range.`)
  return { candles, source: `${pair.dexId} pool via GeckoTerminal` }
}

export async function getPriceHistory(mint: string): Promise<PriceHistory | null> {
  if (STABLES.has(mint)) return null
  const pack = (hour: Candle[], day: Candle[]): PriceHistory => ({ hour: hour.map((c) => [c.t, c.c]), day: day.map((c) => [c.t, c.c]), updatedAt: Date.now() })
  try {
    const hour = await jupCandles(mint, '1_HOUR', 168, 1800_000)
    const day = await jupCandles(mint, '1_DAY', 400, 6 * 3600_000)
    if (hour.length + day.length > 0) return pack(hour, day)
  } catch {
    /* fall through to the pool-level source */
  }
  const pair = (await bestPairs([mint], 600_000)).get(mint)
  if (!pair) return null
  return pack(await geckoCandles(pair.pairAddress, mint, 'hour', 1, 168, 1800_000), await geckoCandles(pair.pairAddress, mint, 'day', 1, 400, 6 * 3600_000))
}

/** USD price of a token at a past moment (hourly for recent dates, daily further back). Null when no price existed then. */
export async function priceAt(mint: string, tsMs: number): Promise<number | null> {
  if (STABLES.has(mint)) return 1
  const t = Math.floor(tsMs / 1000)
  const pick = (candles: Candle[], span: number): number | null => {
    let best: Candle | null = null
    for (const c of candles) if (c.t <= t) best = c
    return best && t - best.t <= span ? best.c : null
  }
  // Hourly candles reach back about six weeks; only ask for them when the date is that recent.
  const recent = Date.now() - tsMs < 40 * 86400_000
  return (recent ? pick(await jupCandles(mint, '1_HOUR', 1000, 3600_000), 3 * 3600) : null) ?? pick(await jupCandles(mint, '1_DAY', 1000, 6 * 3600_000), 2 * 86400)
}

export const solPriceAt = (tsMs: number): Promise<number | null> => priceAt(SOL_MINT, tsMs)
export async function getWhaleTrades(mint: string, minUsd: number): Promise<WhaleTrade[]> {
  const pair = (await bestPairs([mint], 600_000)).get(mint)
  if (!pair) throw new Error('No liquid pool found for this token.')
  const res = await geckoGate(() =>
    fetchJson<{ data: { attributes: { tx_hash: string; block_timestamp: string; kind: 'buy' | 'sell'; volume_in_usd: string; tx_from_address: string } }[] }>(
      `https://api.geckoterminal.com/api/v2/networks/solana/pools/${pair.pairAddress}/trades?trade_volume_in_usd_greater_than=${Math.floor(minUsd)}`,
      { retries: 1 }
    ),
    true
  )
  return res.data.map((d) => ({
    tx: d.attributes.tx_hash,
    ts: Date.parse(d.attributes.block_timestamp),
    kind: d.attributes.kind,
    usd: Number(d.attributes.volume_in_usd),
    maker: d.attributes.tx_from_address
  }))
}

// ---------- token insight + risk ----------

interface RugReport {
  topHolders?: { owner: string; address: string; pct: number }[] | null
  knownAccounts?: Record<string, { name?: string; type?: string }> | null
  markets?: { lp?: { lpLockedPct?: number; quoteUSD?: number; baseUSD?: number } }[] | null
  mintAuthority?: string | null
  freezeAuthority?: string | null
  rugged?: boolean
  creator?: string | null
  creatorBalance?: number | null
  risks?: { name: string; level: string; description: string }[] | null
  totalHolders?: number
}

const usd = (n: number): string => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(0)}`)

function scoreRisk(i: Pick<TokenInsight, 'liquidity' | 'top10Pct' | 'createdAt' | 'mintAuthority' | 'freezeAuthority' | 'lpLockedPct' | 'rugged'>): TokenInsight['risk'] {
  const f: RiskFactor[] = []
  const liq = i.liquidity
  f.push({
    key: 'liquidity', label: 'Liquidity', max: 35, known: liq != null,
    value: liq == null ? 'Unknown' : usd(liq),
    points: liq == null ? 0 : liq < 10_000 ? 35 : liq < 50_000 ? 22 : liq < 250_000 ? 10 : 0
  })
  const top = i.top10Pct
  f.push({
    key: 'holders', label: 'Top 10 holders', max: 30, known: top != null,
    value: top == null ? 'Unknown' : `${top.toFixed(1)}%`,
    points: top == null ? 0 : top > 50 ? 30 : top > 30 ? 18 : top > 20 ? 8 : 0
  })
  const ageDays = i.createdAt ? (Date.now() - i.createdAt) / 86400_000 : null
  f.push({
    key: 'age', label: 'Token age', max: 20, known: ageDays != null,
    value: ageDays == null ? 'Unknown' : ageDays < 1 ? `${Math.max(1, Math.round(ageDays * 24))}h` : ageDays < 365 ? `${Math.round(ageDays)}d` : `${(ageDays / 365).toFixed(1)}y`,
    points: ageDays == null ? 0 : ageDays < 1 ? 20 : ageDays < 7 ? 12 : ageDays < 30 ? 6 : 0
  })
  f.push({
    key: 'mint', label: 'Mint authority', max: 15, known: i.mintAuthority != null,
    value: i.mintAuthority == null ? 'Unknown' : i.mintAuthority ? 'Enabled' : 'Revoked',
    points: i.mintAuthority ? 15 : 0
  })
  f.push({
    key: 'freeze', label: 'Freeze authority', max: 15, known: i.freezeAuthority != null,
    value: i.freezeAuthority == null ? 'Unknown' : i.freezeAuthority ? 'Enabled' : 'Revoked',
    points: i.freezeAuthority ? 15 : 0
  })
  // Unlocked LP is normal for deep, established markets; it matters when liquidity is thin.
  const lp = i.lpLockedPct
  const thin = liq != null && liq < 1_000_000
  f.push({
    key: 'lp', label: 'LP locked / burned', max: 10, known: lp != null,
    value: lp == null ? 'Unknown' : `${lp.toFixed(0)}%`,
    points: lp != null && thin && lp < 50 ? 10 : 0
  })
  const score = i.rugged ? 100 : Math.min(100, f.reduce((s, x) => s + x.points, 0))
  const known = f.filter((x) => x.known).length
  const complete = known === f.length
  const level = known < 3 ? 'Unknown' : i.rugged || score >= 55 ? 'High' : score >= 25 ? 'Medium' : 'Low'
  return { level, score, factors: f, complete }
}

export async function getInsight(mint: string, force = false): Promise<TokenInsight> {
  const cached = cacheGet<TokenInsight>(`insight:${mint}`, 90_000)
  if (cached?.dev && !force) return cached
  const errors: string[] = []
  const [jt, pairs, rug] = await Promise.all([
    jup<JupToken[]>(`/tokens/v2/search?query=${mint}`)
      .then((r) => r.find((t) => t.id === mint) ?? null)
      .catch((e) => (errors.push(`Jupiter: ${errMsg(e)}`), null)),
    bestPairs([mint], force ? 0 : 60_000)
      .then((m) => m.get(mint) ?? null)
      .catch((e) => (errors.push(`DexScreener: ${errMsg(e)}`), null)),
    rugGate(() => fetchJson<RugReport>(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`, { retries: 1, timeoutMs: 25000 })).catch(
      (e) => (errors.push(`RugCheck: ${errMsg(e)}`), null)
    )
  ])
  if (!jt && !pairs && !rug) throw new Error(`Could not load token data. ${errors.join(' · ')}`)

  let top10Pct = jt?.audit?.topHoldersPercentage ?? null
  if (top10Pct == null && rug?.topHolders?.length) {
    const amm = new Set(Object.entries(rug.knownAccounts ?? {}).filter(([, v]) => v.type === 'AMM').map(([k]) => k))
    top10Pct = rug.topHolders.filter((h) => !amm.has(h.owner) && !amm.has(h.address)).slice(0, 10).reduce((s, h) => s + h.pct, 0)
  }
  let lpLockedPct: number | null = null
  const lps = (rug?.markets ?? []).map((m) => m.lp).filter((lp): lp is NonNullable<typeof lp> => !!lp && lp.lpLockedPct != null)
  const lpUsd = lps.reduce((s, lp) => s + (lp.quoteUSD ?? 0) + (lp.baseUSD ?? 0), 0)
  if (lps.length && lpUsd > 0) lpLockedPct = lps.reduce((s, lp) => s + lp.lpLockedPct! * ((lp.quoteUSD ?? 0) + (lp.baseUSD ?? 0)), 0) / lpUsd

  const mintAuthority = jt?.audit?.mintAuthorityDisabled != null ? !jt.audit.mintAuthorityDisabled : rug ? !!rug.mintAuthority : null
  const freezeAuthority = jt?.audit?.freezeAuthorityDisabled != null ? !jt.audit.freezeAuthorityDisabled : rug ? !!rug.freezeAuthority : null
  const createdAt = jt?.firstPool?.createdAt ? Date.parse(jt.firstPool.createdAt) : (pairs?.pairCreatedAt ?? null)
  const liquidity = jt?.liquidity ?? pairs?.liquidity?.usd ?? null
  const base = { liquidity, top10Pct, createdAt, mintAuthority, freezeAuthority, lpLockedPct, rugged: !!rug?.rugged }

  const links = [
    ...(pairs?.info?.websites ?? []).map((w) => ({ label: w.label || 'Website', url: w.url })),
    ...(pairs?.info?.socials ?? []).map((s) => ({ label: s.type === 'twitter' ? 'X' : s.type[0].toUpperCase() + s.type.slice(1), url: s.url })),
    { label: 'Solscan', url: `https://solscan.io/token/${mint}` },
    { label: 'DexScreener', url: pairs?.url ?? `https://dexscreener.com/solana/${mint}` },
    { label: 'RugCheck', url: `https://rugcheck.xyz/tokens/${mint}` },
    { label: 'Birdeye', url: `https://birdeye.so/token/${mint}?chain=solana` }
  ].filter((l) => /^https:\/\//.test(l.url))

  // Developer status comes from the deployer's current share of supply. History is not
  // available from these sources, so "Reduced" means "holds a small remainder (<1%)".
  const devPct = jt?.audit?.devBalancePercentage ?? (rug?.creatorBalance === 0 ? 0 : null)
  const dev: TokenInsight['dev'] = {
    address: jt?.dev ?? rug?.creator ?? null,
    pct: devPct,
    status: devPct == null ? 'Unknown' : devPct < 0.0001 ? 'Sold' : devPct < 1 ? 'Reduced' : 'Holding'
  }

  const insight: TokenInsight = {
    mint,
    symbol: mint === SOL_MINT ? 'SOL' : (jt?.symbol ?? pairs?.baseToken.symbol ?? `${mint.slice(0, 4)}…`),
    name: jt?.name ?? pairs?.baseToken.name ?? 'Unknown token',
    icon: jt?.icon ?? pairs?.info?.imageUrl ?? null,
    price: jt?.usdPrice ?? (pairs ? Number(pairs.priceUsd) : null),
    change: {
      m5: jt?.stats5m?.priceChange ?? pairs?.priceChange?.m5 ?? null,
      h1: jt?.stats1h?.priceChange ?? pairs?.priceChange?.h1 ?? null,
      h6: jt?.stats6h?.priceChange ?? pairs?.priceChange?.h6 ?? null,
      h24: jt?.stats24h?.priceChange ?? pairs?.priceChange?.h24 ?? null
    },
    volume24h: jt?.stats24h ? (jt.stats24h.buyVolume ?? 0) + (jt.stats24h.sellVolume ?? 0) : (pairs?.volume?.h24 ?? null),
    mcap: jt?.mcap ?? pairs?.marketCap ?? null,
    fdv: jt?.fdv ?? pairs?.fdv ?? null,
    holders: jt?.holderCount ?? rug?.totalHolders ?? null,
    verified: !!jt?.isVerified,
    pool: pairs
      ? { address: pairs.pairAddress, dex: pairs.dexId, liquidity: pairs.liquidity?.usd ?? 0, url: pairs.url, quote: pairs.quoteToken.symbol }
      : null,
    rugcheckRisks: (rug?.risks ?? []).map((r) => ({ name: r.name, level: r.level, description: r.description })),
    ...base,
    dev,
    risk: scoreRisk(base),
    links,
    fetchedAt: Date.now(),
    errors
  }
  cacheSet(`insight:${mint}`, insight)
  return insight
}
