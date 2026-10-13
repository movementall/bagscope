import { countedValue, totalValue } from '@shared/calc'
import {
  SOL_MINT,
  STABLES,
  type ExcludeReason,
  type Holding,
  type Lot,
  type PastHolding,
  type PastView,
  type Portfolio,
  type PriceHistory,
  type Snapshot,
  type TxRecord,
  type WalletStatus
} from '@shared/types'
import { errMsg } from './http'
import { getMeta, getPriceHistory, getPrices, priceAt, solPriceAt, type Meta, type PriceQuote } from './market'
import { getSignatures, getTxRecord, getWalletBalances, type WalletBalances } from './solana'
import { cacheGet, cacheSet, emit, getDb, uid, update } from './store'

type BalanceCache = Record<string, { at: number; tokens: WalletBalances['tokens'] }>

let portfolio: Portfolio = { updatedAt: null, pricesAt: null, holdings: [], watch: [], wallets: [], offline: false, error: null, refreshing: false }
let inFlight: Promise<void> | null = null
let histories: Record<string, PriceHistory> = {}
let historyRun = 0
const afterRefresh: ((p: Portfolio) => void)[] = []

export const getPortfolio = (): Portfolio => portfolio
export const getHistories = (): Record<string, PriceHistory> => histories
export const onRefreshed = (fn: (p: Portfolio) => void): void => void afterRefresh.push(fn)

export function initPortfolio(): void {
  const cached = cacheGet<Portfolio>('portfolio')
  if (cached) portfolio = { ...cached, watch: cached.watch ?? [], refreshing: false, offline: true, error: null }
  histories = cacheGet<Record<string, PriceHistory>>('histories:400d') ?? {}
}

function push(patch: Partial<Portfolio>): void {
  portfolio = { ...portfolio, ...patch }
  emit({ type: 'portfolio', portfolio })
}

function buildHolding(mint: string, byWallet: Record<string, number>, decimals: number, q: PriceQuote | undefined, meta: Meta | undefined): Holding {
  const { minLiquidity, excludeOverLiquidity } = getDb().settings
  const amount = Object.values(byWallet).reduce((s, n) => s + n, 0)
  const core = mint === SOL_MINT || STABLES.has(mint)
  let excluded: ExcludeReason | null = null
  if (!q) excluded = 'no-price'
  else if (!core && q.liquidity != null && q.liquidity < minLiquidity) excluded = 'low-liquidity'
  else if (!core && excludeOverLiquidity && q.liquidity != null && amount * q.price > q.liquidity * 2) excluded = 'exceeds-liquidity'
  return {
    mint,
    symbol: meta?.symbol ?? `${mint.slice(0, 4)}…`,
    name: meta?.name ?? 'Unknown token',
    icon: meta?.icon ?? null,
    decimals,
    byWallet,
    price: q?.price ?? null,
    priceSource: q?.source ?? null,
    change24h: q?.change24h ?? null,
    liquidity: q?.liquidity ?? null,
    mcap: q && meta?.circSupply ? meta.circSupply * q.price : null,
    verified: meta?.verified ?? false,
    excluded
  }
}

let refreshAgain = false

export function refresh(): Promise<void> {
  // A request that arrives mid-refresh (a coin just added to the watchlist, a new wallet)
  // would be missed by the run already under way, so one more run is queued behind it.
  if (inFlight) {
    refreshAgain = true
    return inFlight
  }
  inFlight = doRefresh().finally(() => {
    inFlight = null
    if (refreshAgain) {
      refreshAgain = false
      void refresh()
    }
  })
  return inFlight
}

async function doRefresh(): Promise<void> {
  const { wallets, watchlist } = getDb()
  push({ refreshing: true })
  const balances: BalanceCache = {}
  const prev = cacheGet<BalanceCache>('balances') ?? {}
  const statuses: WalletStatus[] = []

  for (const w of wallets) {
    try {
      balances[w.address] = { at: Date.now(), tokens: (await getWalletBalances(w.address)).tokens }
      statuses.push({ address: w.address, ok: true, updatedAt: balances[w.address].at, error: null })
    } catch (e) {
      // Keep this wallet's last on-chain reading and say so, rather than dropping it from the total.
      if (prev[w.address]) balances[w.address] = prev[w.address]
      statuses.push({ address: w.address, ok: false, updatedAt: prev[w.address]?.at ?? null, error: errMsg(e) })
    }
  }
  cacheSet('balances', balances)

  const amounts = new Map<string, { byWallet: Record<string, number>; decimals: number }>()
  for (const [address, b] of Object.entries(balances)) {
    for (const [mint, t] of Object.entries(b.tokens)) {
      if (t.amount <= 0) continue
      const entry = amounts.get(mint) ?? { byWallet: {}, decimals: t.decimals }
      entry.byWallet[address] = t.amount
      amounts.set(mint, entry)
    }
  }
  const watchMints = watchlist.filter((m) => !amounts.has(m))
  const alertMints = getDb().alerts.map((a) => a.mint).filter((m) => !amounts.has(m) && !watchMints.includes(m))
  const allMints = [...amounts.keys(), ...watchMints, ...alertMints]

  if (!allMints.length) {
    const bad = statuses.find((s) => !s.ok)
    if (bad) {
      push({ wallets: statuses, offline: true, error: `Wallets could not be read from chain. ${bad.error}`, refreshing: false })
      return
    }
    push({ updatedAt: Date.now(), pricesAt: Date.now(), holdings: [], watch: [], wallets: statuses, offline: false, error: null, refreshing: false })
    cacheSet('portfolio', portfolio)
    return
  }

  let prices: Map<string, PriceQuote>
  try {
    prices = await getPrices(allMints)
  } catch (e) {
    // Without live prices we show the last complete portfolio, clearly marked as stale.
    push({ wallets: statuses, offline: true, error: errMsg(e), refreshing: false })
    return
  }
  // Names and icons: everything with a price first (largest positions lead), then a
  // bounded number of unpriced tokens. Wallets can hold thousands of spam mints.
  const worth = (mint: string): number => {
    const a = amounts.get(mint)
    const q = prices.get(mint)
    return a && q ? Object.values(a.byWallet).reduce((s, n) => s + n, 0) * q.price : q ? 0 : -1
  }
  const ordered = [...allMints].sort((a, b) => worth(b) - worth(a))
  const priced = ordered.filter((m) => prices.has(m))
  const meta = await getMeta([...priced, ...ordered.filter((m) => !prices.has(m)).slice(0, 200)])

  const holdings = [...amounts].map(([mint, a]) => buildHolding(mint, a.byWallet, a.decimals, prices.get(mint), meta.get(mint)))
  const watch = [...watchMints, ...alertMints].map((mint) => buildHolding(mint, {}, 0, prices.get(mint), meta.get(mint)))
  const failed = statuses.filter((s) => !s.ok)
  const allFailed = wallets.length > 0 && failed.length === wallets.length
  const now = Date.now()
  push({
    updatedAt: allFailed ? portfolio.updatedAt : now,
    pricesAt: now,
    holdings,
    watch,
    wallets: statuses,
    offline: allFailed,
    error: failed.length
      ? `${failed.length === wallets.length ? 'No wallet' : `${wallets.length - failed.length} of ${wallets.length} wallets`} could be read from chain. ${failed[0].error}`
      : null,
    refreshing: false
  })
  cacheSet('portfolio', portfolio)
  if (!failed.length && wallets.length) recordSeries(holdings)
  for (const fn of afterRefresh) fn(portfolio)
  void loadHistories(holdings)
}

// ---------- recorded history: series points + snapshots ----------

function byWalletTotals(holdings: Holding[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const w of getDb().wallets) out[w.address] = totalValue(holdings, w.address)
  return out
}

function makeSnapshot(holdings: Holding[], kind: Snapshot['kind'], label: string): Snapshot {
  return {
    id: uid(),
    ts: Date.now(),
    kind,
    label,
    total: totalValue(holdings, null),
    byWallet: byWalletTotals(holdings),
    positions: holdings
      .filter((h) => countedValue(h, null) > 0)
      .map((h) => {
        const value = countedValue(h, null)
        return { mint: h.mint, symbol: h.symbol, amount: value / h.price!, price: h.price!, value }
      })
      .sort((a, b) => b.value - a.value)
  }
}

function recordSeries(holdings: Holding[]): void {
  const db = getDb()
  const now = Date.now()
  const last = db.series[db.series.length - 1]
  const day = new Date(now).toDateString()
  const needsDaily = db.settings.autoSnapshot && !db.snapshots.some((s) => s.kind !== 'manual' && new Date(s.ts).toDateString() === day)
  if (last && now - last.ts < 10 * 60_000 && !needsDaily) return
  update((d) => {
    if (!last || now - last.ts >= 10 * 60_000) d.series.push({ ts: now, total: totalValue(holdings, null), byWallet: byWalletTotals(holdings) })
    if (d.series.length > 6000) {
      // Thin older points to one per hour; the most recent week stays at full resolution.
      const cutoff = now - 7 * 86400_000
      const seen = new Set<number>()
      d.series = d.series.filter((p) => p.ts >= cutoff || (!seen.has(Math.floor(p.ts / 3600_000)) && !!seen.add(Math.floor(p.ts / 3600_000))))
    }
    if (needsDaily) {
      const date = new Date(now)
      const monday = date.getDay() === 1
      const label = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      d.snapshots.push(makeSnapshot(holdings, monday ? 'weekly' : 'daily', monday ? `Week of ${label}` : label))
    }
  })
}

export function saveSnapshot(label: string): Snapshot {
  if (!portfolio.holdings.length || portfolio.offline) throw new Error('A snapshot needs fresh balances. Refresh first.')
  const snap = makeSnapshot(portfolio.holdings, 'manual', label.trim() || 'Manual snapshot')
  update((d) => void d.snapshots.push(snap))
  return snap
}

// ---------- price history for charts and 7d / 30d performance ----------

async function loadHistories(holdings: Holding[]): Promise<void> {
  const run = ++historyRun
  const total = totalValue(holdings, null)
  if (total <= 0) return
  const ranked = holdings
    .filter((h) => !h.excluded && !STABLES.has(h.mint))
    .map((h) => ({ mint: h.mint, value: countedValue(h, null) }))
    .sort((a, b) => b.value - a.value)
  let covered = holdings.filter((h) => STABLES.has(h.mint)).reduce((s, h) => s + countedValue(h, null), 0)
  const targets: string[] = []
  for (const r of ranked) {
    if (targets.length >= 12 || covered / total >= 0.985) break
    targets.push(r.mint)
    covered += r.value
  }
  const keep = new Set(targets)
  histories = Object.fromEntries(Object.entries(histories).filter(([m]) => keep.has(m)))
  for (const mint of targets) {
    if (run !== historyRun) return
    const have = histories[mint]
    if (have && Date.now() - have.updatedAt < 30 * 60_000) continue
    try {
      const h = await getPriceHistory(mint)
      if (h) histories[mint] = h
      emit({ type: 'history', history: histories })
    } catch {
      // Missing history only lowers chart coverage, which the UI reports.
    }
  }
  cacheSet('histories:400d', histories)
  emit({ type: 'history', history: histories })
}

// ---------- transaction history + automatic cost basis ----------

const syncing = new Set<string>()

export function getTransactions(): TxRecord[] {
  return getDb()
    .wallets.flatMap((w) => cacheGet<TxRecord[]>(`tx:${w.address}`) ?? [])
    .sort((a, b) => b.ts - a.ts)
}

async function valueTx(rec: Omit<TxRecord, 'usdValue' | 'symbols'>): Promise<number | null> {
  const stable = rec.changes.find((c) => STABLES.has(c.mint))
  if (stable) return Math.abs(stable.delta)
  const sol = rec.changes.find((c) => c.mint === SOL_MINT)
  if (sol) {
    const price = await solPriceAt(rec.ts).catch(() => null)
    return price == null ? null : Math.abs(sol.delta) * price
  }
  // Token-to-token swap: value it by whichever side had a market price at that moment.
  if (rec.type !== 'swap') return null
  for (const c of rec.changes) {
    const price = await priceAt(c.mint, rec.ts).catch(() => null)
    if (price != null) return Math.abs(c.delta) * price
  }
  return null
}

function autoLots(rec: TxRecord): Lot[] {
  if (rec.type !== 'swap' || rec.failed || rec.usdValue == null || rec.changes.length !== 2) return []
  return rec.changes
    .filter((c) => c.mint !== SOL_MINT && !STABLES.has(c.mint))
    .map((c) => ({
      id: `auto:${rec.sig}:${c.mint}`,
      mint: c.mint,
      wallet: rec.wallet,
      side: c.delta > 0 ? ('buy' as const) : ('sell' as const),
      amount: Math.abs(c.delta),
      priceUsd: rec.usdValue! / Math.abs(c.delta),
      ts: rec.ts,
      source: 'auto' as const,
      sig: rec.sig,
      basis: 'swap' as const
    }))
}

/** Reads recent (or older) signatures for a wallet, decodes the swaps and derives buy/sell lots. */
export async function syncTransactions(wallet: string, older = false): Promise<void> {
  if (syncing.has(wallet)) return
  syncing.add(wallet)
  const key = `tx:${wallet}`
  const have = cacheGet<TxRecord[]>(key) ?? []
  const known = new Set(have.map((t) => t.sig))
  try {
    const before = older && have.length ? [...have].sort((a, b) => a.ts - b.ts)[0].sig : undefined
    const sigs = (await getSignatures(wallet, 40, before)).filter((s) => !known.has(s.signature))
    emit({ type: 'txsync', wallet, done: 0, total: sigs.length, finished: sigs.length === 0 })
    const added: TxRecord[] = []
    for (let i = 0; i < sigs.length; i++) {
      const rec = await getTxRecord(sigs[i].signature, wallet)
      if (rec) {
        const symbols: Record<string, string> = {}
        for (const [mint, m] of await getMeta(rec.changes.map((c) => c.mint))) symbols[mint] = m.symbol
        added.push({ ...rec, usdValue: await valueTx(rec), symbols })
      }
      emit({ type: 'txsync', wallet, done: i + 1, total: sigs.length, finished: false })
    }
    cacheSet(key, [...have, ...added].sort((a, b) => b.ts - a.ts))
    const lots = added.flatMap(autoLots)
    if (lots.length) {
      update((d) => {
        const skip = new Set([...d.lots.map((l) => l.id), ...d.deletedAutoLots])
        d.lots.push(...lots.filter((l) => !skip.has(l.id)))
      })
    }
    emit({ type: 'txsync', wallet, done: sigs.length, total: sigs.length, finished: true })
  } catch (e) {
    emit({ type: 'txsync', wallet, done: 0, total: 0, finished: true, error: errMsg(e) })
  } finally {
    syncing.delete(wallet)
  }
}

// ---------- time machine: balances at a past moment ----------
// Past balances are rebuilt by starting from today's on-chain balance and undoing every
// transaction that happened after the chosen moment. That is exact as long as the
// transaction list is complete, so completeness is tracked and checked: a balance that
// would have to be negative proves history is missing, and that coin is flagged instead
// of being shown as fact.

const PAGE = 100
const MAX_PER_RUN = 600

async function parseOne(sig: string, wallet: string): Promise<TxRecord | null> {
  const rec = await getTxRecord(sig, wallet)
  if (!rec) return null
  const symbols: Record<string, string> = {}
  for (const [mint, m] of await getMeta(rec.changes.map((c) => c.mint))) symbols[mint] = m.symbol
  return { ...rec, usdValue: await valueTx(rec), symbols }
}

/**
 * Brings a wallet's transaction list up to date and extends it back to `untilTs`.
 * Also checks the wallet's token accounts, because a plain token transfer *to* you
 * references your token account, not your wallet address.
 */
export async function syncBack(wallet: string, untilTs: number): Promise<void> {
  if (syncing.has(wallet)) return
  syncing.add(wallet)
  const key = `tx:${wallet}`
  const have = cacheGet<TxRecord[]>(key) ?? []
  const known = new Set(have.map((t) => t.sig))
  const added: TxRecord[] = []
  let note: string | undefined
  const progress = (finished: boolean, error?: string): void => emit({ type: 'txsync', wallet, done: added.length, total: Math.max(added.length, 1), finished, error, note })
  let failures = 0
  const take = async (sig: string): Promise<void> => {
    if (known.has(sig)) return
    known.add(sig)
    let rec: TxRecord | null
    try {
      rec = await parseOne(sig, wallet)
      failures = 0
    } catch (e) {
      // One unreadable transaction must not stall the whole history; it is retried on the next pass.
      known.delete(sig)
      if (++failures >= 5) throw e
      return
    }
    if (rec) {
      have.push(rec)
      added.push(rec)
      // Entries show up as each swap is read, not only when the whole pass is finished.
      const lots = autoLots(rec)
      if (lots.length) {
        const db = getDb()
        const skip = new Set([...db.lots.map((l) => l.id), ...db.deletedAutoLots])
        const fresh = lots.filter((l) => !skip.has(l.id))
        if (fresh.length) update((d) => void d.lots.push(...fresh))
      }
      if (added.length % 25 === 0) save()
    }
    progress(false)
  }
  const save = (): void => cacheSet(key, [...have].sort((a, b) => b.ts - a.ts))
  try {
    progress(false)
    // 1. Head: everything newer than what is stored, so today's balance and the list agree.
    let before: string | undefined
    for (let guard = 0; guard < 10 && added.length < MAX_PER_RUN; guard++) {
      const page = await getSignatures(wallet, PAGE, before)
      const metKnown = page.some((s) => known.has(s.signature))
      for (const s of page) await take(s.signature)
      save()
      if (page.length < PAGE && !metKnown) cacheSet(`txdone:${wallet}`, true)
      if (metKnown || page.length < PAGE) break
      before = page[page.length - 1].signature
    }
    cacheSet(`txhead:${wallet}`, Date.now())

    // 2. Tail: older pages until the chosen moment is covered or the wallet's first transaction is reached.
    while (added.length < MAX_PER_RUN && !cacheGet<boolean>(`txdone:${wallet}`)) {
      const oldest = [...have].sort((a, b) => a.ts - b.ts)[0]
      if (!oldest || oldest.ts <= untilTs) break
      const page = await getSignatures(wallet, PAGE, oldest.sig)
      for (const s of page) {
        if (added.length >= MAX_PER_RUN) break
        await take(s.signature)
      }
      save()
      if (page.length < PAGE) cacheSet(`txdone:${wallet}`, true)
      if (!page.length) break
    }
    if (added.length >= MAX_PER_RUN) note = `Loaded ${MAX_PER_RUN} transactions this round. Run it again to go further back.`

    // 3. Token accounts: incoming transfers that never mention the wallet address.
    // This pass costs one request per token account, so it runs at most once an hour per wallet.
    const accountsDue = Date.now() - (cacheGet<number>(`txacc:${wallet}`) ?? 0) > 3600_000
    const accounts = accountsDue ? Object.values((cacheGet<BalanceCache>('balances') ?? {})[wallet]?.tokens ?? {}).flatMap((t) => t.accounts ?? []).slice(0, 60) : []
    for (const acc of accounts) {
      if (added.length >= MAX_PER_RUN) break
      const sigs = await getSignatures(acc, PAGE)
      for (const s of sigs) if ((s.blockTime ?? 0) * 1000 >= untilTs) await take(s.signature)
    }
    if (accountsDue && added.length < MAX_PER_RUN) cacheSet(`txacc:${wallet}`, Date.now())
    save()
    const lots = added.flatMap(autoLots)
    if (lots.length) {
      update((d) => {
        const skip = new Set([...d.lots.map((l) => l.id), ...d.deletedAutoLots])
        d.lots.push(...lots.filter((l) => !skip.has(l.id)))
      })
    }
    progress(true)
  } catch (e) {
    save()
    progress(true, errMsg(e))
  } finally {
    syncing.delete(wallet)
  }
}

export async function holdingsAt(ts: number, wallet: string | null): Promise<PastView> {
  const balances = cacheGet<BalanceCache>('balances') ?? {}
  const targets = getDb().wallets.filter((w) => !wallet || w.address === wallet)
  const then = new Map<string, number>()
  const now = new Map<string, number>()
  const incomplete = new Set<string>()
  let solApprox = false
  const info: PastView['wallets'] = []

  for (const w of targets) {
    const txs = cacheGet<TxRecord[]>(`tx:${w.address}`) ?? []
    const complete = cacheGet<boolean>(`txdone:${w.address}`) === true
    const oldestTs = txs.length ? Math.min(...txs.map((t) => t.ts)) : null
    const head = cacheGet<number>(`txhead:${w.address}`) ?? 0
    const fresh = head >= (balances[w.address]?.at ?? 0) - 120_000
    info.push({ address: w.address, covered: fresh && (complete || (oldestTs != null && oldestTs <= ts)), complete, oldestTs, txCount: txs.length })

    const bal = new Map<string, number>()
    for (const [mint, t] of Object.entries(balances[w.address]?.tokens ?? {})) {
      bal.set(mint, t.amount)
      now.set(mint, (now.get(mint) ?? 0) + t.amount)
    }
    for (const tx of txs) {
      if (tx.ts <= ts) continue
      if (tx.solDelta != null) bal.set(SOL_MINT, (bal.get(SOL_MINT) ?? 0) - tx.solDelta)
      else if (tx.changes.some((c) => c.mint === SOL_MINT)) solApprox = true
      for (const c of tx.changes) {
        if (c.mint === SOL_MINT && tx.solDelta != null) continue
        bal.set(c.mint, (bal.get(c.mint) ?? 0) - c.delta)
      }
    }
    for (const [mint, amount] of bal) {
      // A negative balance is impossible, so some transaction for this coin is missing.
      if (amount < -Math.max(1e-6, Math.abs(now.get(mint) ?? 0) * 1e-9)) incomplete.add(mint)
      then.set(mint, (then.get(mint) ?? 0) + Math.max(0, amount))
    }
  }

  const mints = [...then].filter(([mint, amount]) => amount > 1e-9 || incomplete.has(mint)).map(([mint]) => mint)
  const meta = await getMeta(mints.slice(0, 400))
  const rows: PastHolding[] = mints.map((mint) => {
    const m = meta.get(mint)
    const amountThen = then.get(mint) ?? 0
    return {
      mint,
      symbol: m?.symbol ?? `${mint.slice(0, 4)}…`,
      name: m?.name ?? 'Unknown token',
      icon: m?.icon ?? null,
      amountThen,
      amountNow: now.get(mint) ?? 0,
      supplyPct: m?.circSupply ? (amountThen / m.circSupply) * 100 : null,
      incomplete: incomplete.has(mint),
      approx: mint === SOL_MINT && solApprox
    }
  })
  return { ts, rows, wallets: info }
}

// ---------- automatic entries ----------
// Entries (buy and sell records) are derived from the wallets' own transactions so the
// user does not have to type them in:
//   - a swap becomes a buy or sell at the price actually paid;
//   - optionally, a token received from outside the tracked wallets becomes a buy at
//     the market price at that moment (an estimate, and labelled as one);
//   - a transfer between two tracked wallets is neither.
// Entries the user deleted are never recreated.

let lotsRunning = false

export async function rebuildLots(): Promise<void> {
  if (lotsRunning) return
  lotsRunning = true
  try {
    const db = getDb()
    const perWallet = db.wallets.map((w) => ({ wallet: w.address, txs: cacheGet<TxRecord[]>(`tx:${w.address}`) ?? [] }))
    // Which wallet sent which token in which transaction, to recognise moves between own wallets.
    const sentBy = new Map<string, Set<string>>()
    for (const { wallet, txs } of perWallet) {
      for (const tx of txs) {
        for (const c of tx.changes) {
          if (c.delta >= 0) continue
          const key = `${tx.sig}:${c.mint}`
          sentBy.set(key, (sentBy.get(key) ?? new Set()).add(wallet))
        }
      }
    }
    // Only coins that matter get a price lookup: currently priced holdings and coins that already have entries.
    const relevant = new Set([...portfolio.holdings.filter((h) => h.price != null && !h.excluded).map((h) => h.mint), ...db.lots.map((l) => l.mint)])
    const desired: Lot[] = []
    for (const { wallet, txs } of perWallet) {
      let dirty = false
      for (const tx of txs) {
        if (tx.failed) continue
        if (tx.type === 'swap') {
          if (tx.usdValue == null && tx.changes.length === 2) {
            const v = await valueTx(tx)
            if (v != null) {
              tx.usdValue = v
              dirty = true
            }
          }
          desired.push(...autoLots(tx))
        } else if (tx.type === 'receive' && db.settings.receivesAsBuys && tx.changes.length === 1) {
          const c = tx.changes[0]
          if (c.mint === SOL_MINT || STABLES.has(c.mint) || !relevant.has(c.mint)) continue
          const senders = sentBy.get(`${tx.sig}:${c.mint}`)
          if (senders && [...senders].some((s) => s !== wallet)) continue // moved between own wallets
          const price = await priceAt(c.mint, tx.ts).catch(() => null)
          if (price == null) continue
          desired.push({ id: `auto:${tx.sig}:${c.mint}`, mint: c.mint, wallet, side: 'buy', amount: c.delta, priceUsd: price, ts: tx.ts, source: 'auto', sig: tx.sig, basis: 'received' })
        }
      }
      if (dirty) cacheSet(`tx:${wallet}`, txs)
    }
    const want = new Map(desired.map((l) => [l.id, l]))
    const current = getDb()
    const deleted = new Set(current.deletedAutoLots)
    const have = new Set(current.lots.map((l) => l.id))
    const stale = current.lots.filter((l) => l.source === 'auto' && l.basis === 'received' && !want.has(l.id))
    const fresh = desired.filter((l) => !have.has(l.id) && !deleted.has(l.id))
    if (stale.length || fresh.length) {
      update((d) => {
        const drop = new Set(stale.map((l) => l.id))
        d.lots = [...d.lots.filter((l) => !drop.has(l.id)), ...fresh]
      })
    }
  } finally {
    lotsRunning = false
  }
}

let autoRunning = false

/** Background pass: keeps every wallet's transaction history complete, then refreshes the derived entries. */
export async function autoSync(): Promise<void> {
  if (autoRunning || !getDb().settings.autoHistory || portfolio.offline) return
  autoRunning = true
  try {
    for (const w of getDb().wallets) {
      const done = cacheGet<boolean>(`txdone:${w.address}`) === true
      const head = cacheGet<number>(`txhead:${w.address}`) ?? 0
      if (done && Date.now() - head < 10 * 60_000) continue
      // Very busy wallets stop going further back after 5,000 transactions; newer ones are still picked up.
      const loaded = (cacheGet<TxRecord[]>(`tx:${w.address}`) ?? []).length
      if (loaded >= 5000 && Date.now() - head < 10 * 60_000) continue
      await syncBack(w.address, loaded >= 5000 ? Date.now() : 0)
    }
    await rebuildLots()
  } catch {
    // The next refresh cycle tries again; entries are only ever created from parsed transactions.
  } finally {
    autoRunning = false
  }
}

/** Per-wallet progress of the background history read, for the status line. */
export function historyStatus(): { wallet: string; loaded: number; complete: boolean; oldestTs: number | null }[] {
  return getDb().wallets.map((w) => {
    const txs = cacheGet<TxRecord[]>(`tx:${w.address}`) ?? []
    return { wallet: w.address, loaded: txs.length, complete: cacheGet<boolean>(`txdone:${w.address}`) === true, oldestTs: txs.length ? Math.min(...txs.map((t) => t.ts)) : null }
  })
}