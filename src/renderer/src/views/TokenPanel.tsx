import { BadgeCheck, Copy, ExternalLink, Image, Pin, QrCode, RefreshCw, ShieldAlert, Star, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { amountOf, lotsFor, positionFromLots, totalValue, unrealized, valueOf } from '@shared/calc'
import type { Candle, ChartRange, FeedResult, TokenInsight, WhaleTrade } from '@shared/types'
import { AreaChart } from '@/components/Chart'
import { GrokPanel, PostCard, XGate, openUrl } from '@/components/Social'
import { Delta, Segmented, Tabs, TokenIcon, useAsync } from '@/components/ui'
import { cls, fmtCompact, fmtDateTime, fmtPct, fmtPrice, fmtSigned, fmtUsd, shortAddr, timeAgo } from '@/lib/format'
import { act, call, useStore } from '@/lib/store'
import { AlertForm, AlertList } from './Alerts'
import { CollisionBadge, useCollisions } from './Extras'
import { copy } from './Wallets'

const RANGES: ChartRange[] = ['1H', '1D', '1W', '1M', '3M', 'ALL']
const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'trades', label: 'Trades & DCA' },
  { value: 'risk', label: 'Risk' },
  { value: 'alpha', label: 'Alpha' },
  { value: 'alerts', label: 'Alerts' }
]

type ChartData = { candles: Candle[]; source: string }
type ChartState = { data: ChartData | null; shownRange: ChartRange | null; loading: boolean; error: string | null }
const chartCache = new Map<string, { at: number; data: ChartData }>()

/**
 * Chart data for a token and range. Ranges already seen switch instantly from memory
 * and refresh quietly; while a new range loads, the previous chart stays on screen.
 */
function useChart(mint: string, range: ChartRange): ChartState & { reload: () => void } {
  const [s, set] = useState<ChartState>({ data: null, shownRange: null, loading: true, error: null })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    const key = `${mint}:${range}`
    const hit = chartCache.get(key)
    if (hit) set({ data: hit.data, shownRange: range, loading: false, error: null })
    else set((p) => ({ ...p, loading: true, error: null }))
    if (!hit || Date.now() - hit.at > 30_000 || tick) {
      call<ChartData>('token.chart', mint, range).then(
        (data) => {
          chartCache.set(key, { at: Date.now(), data })
          if (live) set({ data, shownRange: range, loading: false, error: null })
        },
        (e) => live && set((p) => (hit ? { ...p, loading: false } : { data: null, shownRange: null, loading: false, error: e.message }))
      )
    }
    return () => {
      live = false
    }
  }, [mint, range, tick])
  return { ...s, reload: () => setTick((t) => t + 1) }
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="v num truncate">{value}</div>
      {sub && <div className="muted num truncate" style={{ fontSize: 12 }}>{sub}</div>}
    </div>
  )
}

function Trades({ mint, symbol, price, balance }: { mint: string; symbol: string; price: number | null; balance: number }) {
  const { state, wallet } = useStore()
  const lots = lotsFor(state!.lots, mint, wallet).sort((a, b) => b.ts - a.ts)
  const pos = positionFromLots(lots)
  const upnl = unrealized(pos, balance, price)
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [amount, setAmount] = useState('')
  const [px, setPx] = useState('')
  const [date, setDate] = useState(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16))
  const [w, setW] = useState(wallet ?? '')
  const add = (): void =>
    void act(call('lots.add', { mint, wallet: w || null, side, amount: Number(amount), priceUsd: Number(px), ts: new Date(date).getTime() }), 'Trade added').then((ok) => ok !== undefined && (setAmount(''), setPx('')))

  return (
    <>
      <div className="stat-grid">
        <Stat label="Avg entry" value={fmtPrice(pos.avgCost)} sub={price != null && pos.avgCost ? `${fmtPct((price / pos.avgCost - 1) * 100)} vs now` : `${pos.buys} buys · ${pos.sells} sells`} />
        <Stat label="Unrealized" value={<span className={cls(upnl)}>{upnl == null ? '—' : fmtSigned(upnl)}</span>} sub={`Cost basis ${fmtUsd(pos.costBasis)}`} />
        <Stat label="Realized" value={<span className={cls(pos.realized)}>{pos.sells ? fmtSigned(pos.realized) : '—'}</span>} sub={`Invested ${fmtUsd(pos.invested)}`} />
      </div>
      {pos.buys > 0 && Math.abs(pos.trackedQty - balance) > balance * 0.01 + 1e-9 && (
        <div className="banner">
          <div className="grow">
            Your trades account for {fmtCompact(pos.trackedQty)} {symbol} but you hold {fmtCompact(balance)}. PnL covers only the tracked part. Add the missing buys or transfers to complete it.
          </div>
        </div>
      )}

      <div className="card pad" style={{ background: 'var(--raised)' }}>
        <div className="section-title">
          <b>Add a trade</b>
          <Segmented value={side} options={[{ value: 'buy', label: 'Buy' }, { value: 'sell', label: 'Sell' }]} onChange={setSide} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label className="field"><span>Amount ({symbol})</span><input className="input num" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" /></label>
          <label className="field">
            <span>Price per token (USD) {price != null && <a onClick={() => setPx(String(price))}>use current</a>}</span>
            <input className="input num" type="number" min={0} value={px} onChange={(e) => setPx(e.target.value)} placeholder="0.00" />
          </label>
          <label className="field"><span>Date</span><input className="input" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="field">
            <span>Wallet</span>
            <select className="select" value={w} onChange={(e) => setW(e.target.value)}>
              <option value="">Any wallet</option>
              {state!.wallets.map((x) => <option key={x.address} value={x.address}>{x.label}</option>)}
            </select>
          </label>
        </div>
        <div className="row-flex" style={{ justifyContent: 'space-between', marginTop: 12 }}>
          <span className="muted num" style={{ fontSize: 12.5 }}>{Number(amount) > 0 && Number(px) > 0 ? `Total ${fmtUsd(Number(amount) * Number(px))}` : (state!.settings.autoHistory ? 'Your swaps are entered automatically from chain. Add one here only if something is missing.' : 'Automatic entries are off in Settings.')}</span>
          <button className="btn primary" disabled={!(Number(amount) > 0) || px === ''} onClick={add}>Add {side}</button>
        </div>
      </div>

      <div>
        <div className="label" style={{ marginBottom: 4 }}>{lots.length} recorded trade{lots.length === 1 ? '' : 's'}</div>
        {lots.map((l) => (
          <div key={l.id} className="list-row">
            <span className={`pill ${l.side === 'buy' ? 'up' : 'down'}`}>{l.side}</span>
            <div className="col grow">
              <b className="num">{fmtCompact(l.amount)} @ {fmtPrice(l.priceUsd)}</b>
              <span className="muted" style={{ fontSize: 12 }}>
                {fmtDateTime(l.ts)} · {l.source !== 'auto' ? 'manual' : l.basis === 'received' ? 'received · priced at market then (estimate)' : 'swap on chain'}
                {l.wallet && ` · ${state!.wallets.find((x) => x.address === l.wallet)?.label ?? shortAddr(l.wallet)}`}
              </span>
            </div>
            <b className="num">{fmtUsd(l.amount * l.priceUsd)}</b>
            {l.sig && <button className="icon-btn" title="View transaction" onClick={() => openUrl(`https://solscan.io/tx/${l.sig}`)}><ExternalLink size={14} /></button>}
            <button className="icon-btn" title="Delete" onClick={() => void act(call('lots.remove', l.id))}><Trash2 size={14} /></button>
          </div>
        ))}
        {!lots.length && <p className="muted" style={{ padding: '10px 0' }}>{state!.settings.autoHistory ? 'No entries found for this coin yet. Bagscope is still reading your transaction history, or this coin arrived in a way that left no price on chain.' : 'No trades yet. Add your buys to see average entry and PnL.'}</p>}
      </div>
    </>
  )
}

function Risk({ i }: { i: TokenInsight }) {
  const tone = i.risk.level === 'Low' ? 'up' : i.risk.level === 'High' ? 'down' : i.risk.level === 'Medium' ? 'warn' : ''
  return (
    <>
      <div className="card pad" style={{ background: 'var(--raised)' }}>
        <div className="row-flex" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
          <div className="row-flex">
            <ShieldAlert size={18} className={tone} />
            <span className="display" style={{ fontSize: 20, fontWeight: 600 }}>{i.risk.level} risk</span>
          </div>
          <span className="muted num">{i.risk.level === 'Unknown' ? 'Not enough data to score' : `${i.risk.score} / 100`}</span>
        </div>
        {i.risk.level !== 'Unknown' && (
          <div className="risk-meter"><div className="risk-knob" style={{ left: `${i.risk.score}%` }} /></div>
        )}
        {i.rugged && <div className="banner error" style={{ marginTop: 14 }}>RugCheck has flagged this token as rugged.</div>}
        {!i.risk.complete && <p className="faint" style={{ fontSize: 12, marginTop: 12 }}>Some inputs could not be loaded, so this score is based on partial data.</p>}
      </div>
      <div>
        {i.risk.factors.map((f) => (
          <div key={f.key} className="list-row">
            <div className="grow">{f.label}</div>
            <b className={`num ${f.known ? '' : 'faint'}`}>{f.value}</b>
            <span className={`pill ${!f.known ? '' : f.points === 0 ? 'up' : f.points >= f.max * 0.6 ? 'down' : 'warn'}`} style={{ minWidth: 62, justifyContent: 'center' }}>
              {!f.known ? 'n/a' : f.points === 0 ? 'ok' : `+${f.points} risk`}
            </span>
          </div>
        ))}
      </div>
      {i.rugcheckRisks.length > 0 && (
        <div>
          <div className="label" style={{ marginBottom: 4 }}>RugCheck flags</div>
          {i.rugcheckRisks.map((r) => (
            <div key={r.name} className="list-row">
              <span className={`pill ${r.level === 'danger' ? 'down' : 'warn'}`}>{r.level}</span>
              <div className="col grow"><b>{r.name}</b><span className="muted" style={{ fontSize: 12 }}>{r.description}</span></div>
            </div>
          ))}
        </div>
      )}
      {i.pool && (
        <div className="card pad" style={{ background: 'var(--raised)' }}>
          <div className="label">Main pool (deepest liquidity)</div>
          <div className="row-flex" style={{ marginTop: 6 }}>
            <b>{i.symbol}/{i.pool.quote}</b>
            <span className="pill">{i.pool.dex}</span>
            <span className="muted num">{fmtCompact(i.pool.liquidity, '$')} liquidity</span>
            <div className="grow" />
            <span className="mono muted">{shortAddr(i.pool.address)}</span>
            <button className="icon-btn" onClick={() => copy(i.pool!.address, 'Pool address')}><Copy size={14} /></button>
          </div>
        </div>
      )}
      <p className="faint" style={{ fontSize: 11.5 }}>
        Score built from liquidity, holder concentration, age, authorities and LP lock. Sources: Jupiter, DexScreener, RugCheck. A low score is not a guarantee.
      </p>
    </>
  )
}

function Whales({ mint }: { mint: string }) {
  const [min, setMin] = useState(5000)
  const w = useAsync(() => call<WhaleTrade[]>('token.whales', mint, min), [mint, min])
  return (
    <div>
      <div className="section-title">
        <div className="label">Large trades · main pool · last 24h</div>
        <Segmented value={String(min)} options={[{ value: '1000', label: '$1K+' }, { value: '5000', label: '$5K+' }, { value: '25000', label: '$25K+' }]} onChange={(v) => setMin(Number(v))} />
      </div>
      {w.loading && <div className="skeleton" style={{ height: 90 }} />}
      {w.error && <div className="banner error">{w.error}</div>}
      {w.data?.slice(0, 12).map((t) => (
        <div key={t.tx} className="list-row">
          <span className={`pill ${t.kind === 'buy' ? 'up' : 'down'}`}>{t.kind}</span>
          <b className="num grow">{fmtUsd(t.usd, 0)}</b>
          <span className="mono muted">{shortAddr(t.maker)}</span>
          <span className="faint" style={{ fontSize: 12, width: 60, textAlign: 'right' }}>{timeAgo(t.ts)}</span>
          <button className="icon-btn" onClick={() => openUrl(`https://solscan.io/tx/${t.tx}`)}><ExternalLink size={14} /></button>
        </div>
      ))}
      {w.data && !w.data.length && <p className="muted">No trades above {fmtUsd(min, 0)} in the last 24 hours.</p>}
    </div>
  )
}

export function TokenPanel({ mint }: { mint: string }) {
  const { state, portfolio, wallet, tokenTab, openToken, setModal } = useStore()
  const [range, setRange] = useState<ChartRange>('1D')
  const s = state!
  const h = useMemo(() => [...portfolio!.holdings, ...portfolio!.watch].find((x) => x.mint === mint) ?? null, [portfolio, mint])
  const insight = useAsync(() => call<TokenInsight>('token.insight', mint, false), [mint])
  const chart = useChart(mint, range)
  const collisions = useCollisions()
  // Posts come from the official X API once the user has signed in; otherwise the feed says it is not connected.
  const feedOn = !!s.secrets.xUser
  const feed = useAsync(() => (tokenTab === 'alpha' && feedOn ? call<FeedResult>('x.feed', mint, h?.symbol ?? insight.data?.symbol ?? '', false) : Promise.resolve(null)), [mint, tokenTab, feedOn, !!insight.data])

  const i = insight.data
  const symbol = h?.symbol ?? i?.symbol ?? shortAddr(mint)
  const price = h?.price ?? i?.price ?? null
  const meta = s.tokenMeta[mint] ?? {}
  const balance = h ? amountOf(h, wallet) : 0
  const value = h ? valueOf(h, wallet) : null
  const total = totalValue(portfolio!.holdings, wallet)
  const pos = positionFromLots(lotsFor(s.lots, mint, wallet))
  const upnl = unrealized(pos, balance, price)
  const watched = s.watchlist.includes(mint)
  const points = useMemo(() => (chart.data?.candles ?? []).map((c) => [c.t * 1000, c.c] as [number, number]), [chart.data])
  const stale = chart.loading && !!chart.data
  const rangePct = points.length > 1 ? (points[points.length - 1][1] / points[0][1] - 1) * 100 : null

  return (
    <>
      <div className="drawer-head">
        <div className="row-flex" style={{ gap: 12 }}>
          <TokenIcon src={h?.icon ?? i?.icon ?? null} mint={mint} symbol={symbol} size={46} />
          <div className="col grow">
            <div className="row-flex" style={{ gap: 6 }}>
              <span className="h1 truncate">{symbol}</span>
              {(h?.verified || i?.verified) && <BadgeCheck size={16} className="accent" />}
              {collisions.has(symbol.trim().toLowerCase()) && <CollisionBadge symbol={symbol} count={collisions.get(symbol.trim().toLowerCase())} />}
              {h?.excluded && <span className="pill warn">not counted</span>}
            </div>
            <span className="muted truncate">
              {h?.name ?? i?.name ?? 'Loading…'} · <span className="mono">{shortAddr(mint)}</span>
            </span>
          </div>
          <button className={`icon-btn ${meta.pinned ? 'on' : ''}`} title="Pin" onClick={() => void call('meta.set', mint, { pinned: !meta.pinned })}><Pin size={16} /></button>
          <button className={`icon-btn ${watched ? 'on' : ''}`} title={watched ? 'Remove from watchlist' : 'Add to watchlist'} onClick={() => void act(call('watch.toggle', mint), watched ? 'Removed from watchlist' : 'Added to watchlist')}><Star size={16} fill={watched ? 'currentColor' : 'none'} /></button>
          <button className="icon-btn" title="Copy mint address" onClick={() => copy(mint, 'Mint address')}><Copy size={16} /></button>
          <button className="icon-btn" title="QR code" onClick={() => setModal({ kind: 'qr', address: mint, label: `${symbol} mint` })}><QrCode size={16} /></button>
          <button className="icon-btn" title="Close (Esc)" onClick={() => openToken(null)}><X size={18} /></button>
        </div>
        <div className="row-flex" style={{ marginTop: 16, alignItems: 'baseline', gap: 10 }}>
          <span className="display num" style={{ fontSize: 34, fontWeight: 600 }}>{fmtPrice(price)}</span>
          <Delta pct={h?.change24h ?? i?.change.h24} pill />
          <span className="faint" style={{ fontSize: 12 }}>24h</span>
          <div className="grow" />
          {balance > 0 && <button className="btn sm" onClick={() => setModal({ kind: 'pnl', mint })}><Image size={14} /> PnL card</button>}
        </div>
        <Tabs value={tokenTab} options={TABS} onChange={(t) => openToken(mint, t)} />
      </div>

      <div className="drawer-body">
        {insight.error && <div className="banner error"><div className="grow">{insight.error}</div><button className="btn sm" onClick={insight.reload}>Retry</button></div>}

        {tokenTab === 'overview' && (
          <>
            <div>
              <div className="row-flex" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                <span className="row-flex muted" style={{ fontSize: 12.5 }}>
                  {rangePct != null && <Delta pct={rangePct} />} {rangePct != null && `over ${chart.shownRange ?? range}`}
                  {stale && <span className="faint pulse">updating…</span>}
                </span>
                <Segmented value={range} options={RANGES} onChange={setRange} />
              </div>
              <div className={stale ? 'chart stale' : undefined}>
                <AreaChart points={points} height={220} format={fmtPrice} loading={chart.loading} zoomable empty={<span>{chart.error ?? 'No chart data for this range.'} <a onClick={chart.reload}>Retry</a></span>} />
              </div>
              {chart.data && <div className="faint" style={{ fontSize: 11.5, marginTop: 4 }}>{chart.data.source} · scroll to zoom, drag to pan, double-click to reset.</div>}
            </div>

            {h && balance > 0 && (
              <div className="stat-grid">
                <Stat label="Your bag" value={fmtUsd(value)} sub={`${fmtCompact(balance)} ${symbol}`} />
                <Stat label="Position size" value={total > 0 && !h.excluded ? `${(((value ?? 0) / total) * 100).toFixed(1)}%` : '—'} sub="of portfolio" />
                <Stat label="Unrealized PnL" value={<span className={cls(upnl)}>{upnl == null ? '—' : fmtSigned(upnl)}</span>} sub={pos.avgCost ? `Avg entry ${fmtPrice(pos.avgCost)}` : 'No cost basis yet'} />
              </div>
            )}
            {h && !wallet && Object.keys(h.byWallet).length > 1 && (
              <div>
                {Object.entries(h.byWallet).map(([addr, amt]) => {
                  const w = s.wallets.find((x) => x.address === addr)
                  return (
                    <div key={addr} className="list-row">
                      <span className="dot" style={{ background: w?.color }} />
                      <span className="grow">{w?.label ?? shortAddr(addr)}</span>
                      <span className="num muted">{fmtCompact(amt)}</span>
                      <b className="num" style={{ minWidth: 120, textAlign: 'right' }}>{h.price == null ? '—' : fmtUsd(amt * h.price)}</b>
                    </div>
                  )
                })}
              </div>
            )}

            {insight.loading && !i ? <div className="skeleton" style={{ height: 130 }} /> : i && (
              <div className="stat-grid">
                <Stat label="Market cap" value={fmtCompact(i.mcap, '$')} sub={i.fdv && i.mcap && i.fdv > i.mcap * 1.02 ? `FDV ${fmtCompact(i.fdv, '$')}` : undefined} />
                <Stat label="Liquidity" value={fmtCompact(i.liquidity, '$')} sub={i.pool ? `Main pool ${fmtCompact(i.pool.liquidity, '$')}` : undefined} />
                <Stat label="24h volume" value={fmtCompact(i.volume24h, '$')} />
                <Stat label="Holders" value={fmtCompact(i.holders)} sub={i.top10Pct != null ? `Top 10 hold ${i.top10Pct.toFixed(1)}%` : undefined} />
                <Stat label="Age" value={i.risk.factors.find((f) => f.key === 'age')?.value ?? '—'} />
                <Stat label="Risk" value={<span className={i.risk.level === 'Low' ? 'up' : i.risk.level === 'High' ? 'down' : i.risk.level === 'Medium' ? 'warn' : 'faint'}>{i.risk.level}</span>} sub={<a onClick={() => openToken(mint, 'risk')}>See why</a>} />
              </div>
            )}
            {i?.dev && (
              <div className="card pad row-flex" style={{ background: 'var(--raised)', padding: '10px 13px' }} title="Based on the deployer wallet's current share of supply. Holding: 1% or more. Reduced: under 1%. Sold: nothing left. Past sales are not tracked.">
                <span className="label">Developer wallet</span>
                <span className={`pill ${i.dev.status === 'Sold' ? 'up' : i.dev.status === 'Holding' ? 'warn' : ''}`}>
                  <span className="dot" style={{ width: 6, height: 6, background: 'currentColor' }} /> {i.dev.status}
                </span>
                <span className="muted num grow truncate" style={{ fontSize: 12.5 }}>
                  {i.dev.status === 'Unknown' ? 'No deployer data from Jupiter or RugCheck' : i.dev.status === 'Sold' ? 'holds none of the supply now' : `holds ${i.dev.pct! < 0.01 ? '< 0.01' : i.dev.pct!.toFixed(2)}% of supply`}
                </span>
                {i.dev.address && (
                  <>
                    <span className="mono faint">{shortAddr(i.dev.address)}</span>
                    <button className="icon-btn" title="View developer wallet on Solscan" onClick={() => openUrl(`https://solscan.io/account/${i.dev.address}`)}><ExternalLink size={13} /></button>
                  </>
                )}
              </div>
            )}
            {i && (
              <div className="row-flex" style={{ gap: 14, flexWrap: 'wrap' }}>
                {(['m5', 'h1', 'h6', 'h24'] as const).map((k) => (
                  <span key={k} className="row-flex" style={{ gap: 5 }}><span className="faint" style={{ fontSize: 12 }}>{k.replace('m5', '5m').replace('h', '') + (k === 'm5' ? '' : 'h')}</span><Delta pct={i.change[k]} /></span>
                ))}
                <div className="grow" />
                <span className="faint" style={{ fontSize: 11.5 }}>Data {timeAgo(i.fetchedAt)}</span>
                <button className="icon-btn" title="Reload token data" onClick={() => void call('token.insight', mint, true).then(insight.reload)}><RefreshCw size={13} /></button>
              </div>
            )}

            <div>
              <div className="label" style={{ marginBottom: 8 }}>Tags</div>
              <div className="row-flex" style={{ flexWrap: 'wrap' }}>
                {s.tags.map((t) => {
                  const on = meta.tags?.includes(t)
                  return <button key={t} className={`chip sm ${on ? 'active' : ''}`} style={on ? { borderColor: 'var(--accent-line)', color: 'var(--accent-text)' } : undefined} onClick={() => void call('meta.set', mint, { tags: on ? meta.tags!.filter((x) => x !== t) : [...(meta.tags ?? []), t] })}>{t}</button>
                })}
                <input className="input" style={{ width: 120, height: 26, borderRadius: 13, fontSize: 12 }} placeholder="+ new tag" maxLength={18} onKeyDown={(e) => { const v = e.currentTarget.value.trim(); if (e.key === 'Enter' && v) { void call('tags.set', [...s.tags, v]); void call('meta.set', mint, { tags: [...new Set([...(meta.tags ?? []), v])] }); e.currentTarget.value = '' } }} />
              </div>
            </div>
            <label className="field">
              <span className="label">Notes</span>
              <textarea className="textarea" placeholder="Thesis, targets, why you aped…" defaultValue={meta.note ?? ''} onBlur={(e) => e.target.value !== (meta.note ?? '') && void act(call('meta.set', mint, { note: e.target.value }), 'Note saved')} />
            </label>
            {i && (
              <div className="row-flex" style={{ flexWrap: 'wrap' }}>
                {i.links.map((l) => <button key={l.url} className="btn sm ghost" onClick={() => openUrl(l.url)}>{l.label} <ExternalLink size={12} /></button>)}
              </div>
            )}
          </>
        )}

        {tokenTab === 'trades' && <Trades mint={mint} symbol={symbol} price={price} balance={balance} />}
        {tokenTab === 'risk' && (i ? <Risk i={i} /> : insight.loading ? <div className="skeleton" style={{ height: 240 }} /> : null)}
        {tokenTab === 'alpha' && (
          <>
            <GrokPanel mint={mint} symbol={symbol} />
            <div className="section-title" style={{ marginBottom: 0 }}>
              <div className="label">Alpha feed · recent posts on X</div>
              {feed.data && <span className="faint" style={{ fontSize: 11.5 }}>{timeAgo(feed.data.fetchedAt)} <a onClick={() => void call('x.feed', mint, symbol, true).then(feed.reload, feed.reload)}>refresh</a></span>}
            </div>
            <XGate what="The Alpha Feed" />
            {feed.loading && feedOn && (
              <>
                <div className="skeleton" style={{ height: 160 }} />
              </>
            )}
            {feed.error && <div className="banner error"><div className="grow">{feed.error}</div><button className="btn sm" onClick={feed.reload}>Retry</button></div>}
            {feed.data?.posts.map((p) => <PostCard key={p.id} post={p} />)}
            {feed.data && !feed.data.posts.length && <p className="muted">No recent posts found for ${symbol}.</p>}
          </>
        )}
        {tokenTab === 'alerts' && (
          <>
            <AlertForm mint={mint} symbol={symbol} price={price} mcap={h?.mcap ?? i?.mcap ?? null} />
            <AlertList mint={mint} />
            <Whales mint={mint} />
          </>
        )}
      </div>
    </>
  )
}
