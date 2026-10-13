import { Reorder, motion } from 'motion/react'
import { AlertTriangle, ArrowDown, ArrowUp, ChevronDown, Eye, EyeOff, Image, Bell, LayoutGrid, List, Monitor, Pin, Plus, Rocket, Rows3, Rows4, Scale, ShieldAlert, ShieldCheck, Smartphone, Wallet } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { SOL_MINT, STABLES, type ExcludeReason } from '@shared/types'
import { AreaChart } from '@/components/Chart'
import { AnimatedNumber, Delta, EASE, Empty, SearchInput, Segmented, TokenIcon } from '@/components/ui'
import { RANGE_OPTIONS, allTimePnl, buildRows, estimatedSeries, mood, perfOver, recordedSeries, type Perf, type Range, type Row } from '@/lib/derive'
import { PALETTE, cls, fmtCompact, fmtPct, fmtPrice, fmtSigned, fmtUsd, timeAgo } from '@/lib/format'
import { act, call, useStore } from '@/lib/store'
import { CollisionBadge, useCollisions } from './Extras'

const REASON: Record<ExcludeReason, string> = {
  'no-price': 'No reliable price',
  'low-liquidity': 'Pool too thin to trust',
  'exceeds-liquidity': 'Bigger than its exit liquidity'
}

type SortKey = 'value' | 'price' | 'change' | 'pnl' | 'symbol'

/** First run: three ways to add a wallet, what the app will do with it, and what it will never ask for. */
function Onboarding() {
  const { bridge, setModal } = useStore()
  const [addr, setAddr] = useState('')
  const waiting = bridge?.status === 'opened'
  const watch = (): void => void act(call('wallets.addWatch', addr, ''), 'Wallet added. Reading balances…').then((ok) => ok !== undefined && setAddr(''))
  const gets: [typeof Rocket, string, string][] = [
    [Wallet, 'One real total', 'Every wallet added up from on-chain balances. Illiquid dust never inflates it.'],
    [ShieldAlert, 'Rug radar', 'Liquidity, holder concentration, developer wallet and same-name fakes, per coin.'],
    [Scale, 'Honest performance', 'PnL from your actual buys, and how you did against SOL, BTC or the S&P 500.'],
    [Bell, 'Alerts', 'Price levels, whale trades and liquidity pulls as Windows notifications.']
  ]
  return (
    <motion.div className="page" style={{ paddingTop: 18 }} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.42, ease: EASE }}>
      <div style={{ textAlign: 'center', padding: '10px 0 4px' }}>
        <div className="empty-icon" style={{ margin: '0 auto 14px' }}><Rocket size={24} /></div>
        <h1 className="display" style={{ fontSize: 34, fontWeight: 600 }}>gm. Let's find your bags.</h1>
        <p className="muted" style={{ maxWidth: 520, margin: '8px auto 0', fontSize: 14 }}>
          Add your first wallet to get started. Bagscope is view-only: it reads public addresses and can never move your funds.
        </p>
      </div>

      <div className="onboard-grid">
        <div className="card pad onboard-card primary">
          <Monitor size={20} className="accent" />
          <b>Phantom on this PC</b>
          <p>Opens your browser. Approve the connection and sign a short message. Switch account in Phantom to add each wallet.</p>
          <button className="btn primary" onClick={() => void act(call('wallets.connect'))}>{waiting ? 'Open Phantom again' : 'Connect Phantom'}</button>
          {waiting && <span className="accent pulse" style={{ fontSize: 12 }}>Waiting for you to approve in the browser…</span>}
        </div>
        <div className="card pad onboard-card">
          <Smartphone size={20} className="accent" />
          <b>Phantom on your phone</b>
          <p>Scan a QR code with your phone camera, approve in the Phantom app, done. Needs the same Wi-Fi as this PC.</p>
          <button className="btn" onClick={() => setModal({ kind: 'wallets' })}>Show QR code options</button>
        </div>
        <div className="card pad onboard-card">
          <Eye size={20} className="accent" />
          <b>Just watch an address</b>
          <p>Paste any Solana address to track it without connecting anything. Good for cold wallets.</p>
          <div className="row-flex" style={{ width: '100%' }}>
            <input className="input mono" placeholder="Solana address" aria-label="Solana address to watch" value={addr} onChange={(e) => setAddr(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addr.trim() && watch()} spellCheck={false} />
            <button className="btn" disabled={!addr.trim()} onClick={watch}>Watch</button>
          </div>
        </div>
      </div>

      <div className="onboard-gets">
        {gets.map(([Icon, title, text], i) => (
          <motion.div key={title} className="row-flex" style={{ alignItems: 'flex-start', gap: 10 }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 + i * 0.05, duration: 0.22, ease: EASE }}>
            <Icon size={16} className="accent" style={{ marginTop: 2, flex: 'none' }} />
            <div><b>{title}</b><p className="muted" style={{ fontSize: 12.5 }}>{text}</p></div>
          </motion.div>
        ))}
      </div>

      <p className="faint" style={{ fontSize: 12, textAlign: 'center' }}>
        <ShieldCheck size={12} style={{ verticalAlign: -2 }} /> No seed phrase, no private key, ever. If anything asks for one, it is not Bagscope. Everything is stored on this PC.
      </p>
    </motion.div>
  )
}
function PerfTile({ label, perf, hint, delay }: { label: string; perf: Perf | null; hint: string; delay: number }) {
  const partial = perf && perf.coverage < 0.999
  return (
    <motion.div className="perf" title={hint} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.3, ease: EASE }}>
      <div className="label">{label}</div>
      {perf ? (
        <>
          <div className={`v num ${cls(perf.pct)}`}>
            <AnimatedNumber value={perf.pct} format={(n) => fmtPct(n)} />
          </div>
          <div className="num muted truncate" style={{ fontSize: 12 }}>
            {fmtSigned(perf.abs)}
            {partial ? ` · ${(perf.coverage * 100).toFixed(0)}% of bag` : ''}
          </div>
        </>
      ) : (
        <>
          <div className="v faint">—</div>
          <div className="faint truncate" style={{ fontSize: 12 }}>{hint}</div>
        </>
      )}
    </motion.div>
  )
}

type HoverBind = React.MutableRefObject<((v: number | null) => void) | null>

/** Owns the chart-hover value itself, so scrubbing the chart does not re-render the token table. */
function HeroTotal({ total, bind }: { total: number; bind: HoverBind }) {
  const [hover, setHover] = useState<number | null>(null)
  bind.current = setHover
  const split = (n: number) => {
    const [w, c] = fmtUsd(n).split('.')
    return <>{w}<span className="cents">.{c}</span></>
  }
  return <div className="hero-total num">{hover == null ? <AnimatedNumber value={total} format={split} /> : split(hover)}</div>
}

export function Dashboard() {
  const { state, portfolio, history, wallet, openToken, setModal } = useStore()
  const [range, setRange] = useState<Range>('7D')
  const [mode, setMode] = useState<'Estimated' | 'Recorded'>('Estimated')
  const [q, setQ] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [layout, setLayout] = useState<'list' | 'grid'>('list')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'value', dir: -1 })
  const [showExcluded, setShowExcluded] = useState(false)
  const hoverBind: HoverBind = useRef(null)
  const draggedAt = useRef(0)

  const s = state!
  const p = portfolio!
  const { rows, total } = useMemo(() => buildRows(p.holdings, wallet, s.tokenMeta, s.lots), [p.holdings, wallet, s.tokenMeta, s.lots])
  const d1 = useMemo(() => perfOver(p.holdings, wallet, history, 1), [p.holdings, wallet, history])
  const d7 = useMemo(() => perfOver(p.holdings, wallet, history, 7), [p.holdings, wallet, history])
  const d30 = useMemo(() => perfOver(p.holdings, wallet, history, 30), [p.holdings, wallet, history])
  const d180 = useMemo(() => perfOver(p.holdings, wallet, history, 180), [p.holdings, wallet, history])
  const d365 = useMemo(() => perfOver(p.holdings, wallet, history, 365), [p.holdings, wallet, history])
  const all = useMemo(() => allTimePnl(rows, s.lots, wallet), [rows, s.lots, wallet])
  const est = useMemo(() => estimatedSeries(p.holdings, wallet, history, range), [p.holdings, wallet, history, range])
  const rec = useMemo(() => recordedSeries(s.series, wallet, range, total), [s.series, wallet, range, total])

  const counted = rows.filter((r) => !r.h.excluded)
  const excluded = rows.filter((r) => r.h.excluded)
  const degen = s.settings.degenMode
  const compact = s.settings.density === 'compact'
  const collisions = useCollisions()
  /** Degen mode always hides dust; otherwise the "hide small" preference decides and pins stay visible. */
  const shown = (r: Row): boolean => (degen ? r.counted >= s.settings.smallThreshold : !s.settings.hideSmall || r.counted >= s.settings.smallThreshold || !!r.meta.pinned)
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const val = (r: Row): number | string =>
      sort.key === 'value' ? r.counted : sort.key === 'price' ? (r.h.price ?? 0) : sort.key === 'change' ? (r.h.change24h ?? -1e9) : sort.key === 'pnl' ? (r.upnl ?? -1e18) : r.h.symbol.toLowerCase()
    const list = counted
      .filter(shown)
      .filter((r) => !needle || r.h.symbol.toLowerCase().includes(needle) || r.h.name.toLowerCase().includes(needle) || r.h.mint.toLowerCase() === needle)
      .filter((r) => !tag || r.meta.tags?.includes(tag))
    if (degen) {
      // Biggest 24h movers first; SOL and stablecoins sink to the bottom.
      const core = (r: Row): number => (r.h.mint === SOL_MINT || STABLES.has(r.h.mint) ? 1 : 0)
      return list.sort((a, b) => core(a) - core(b) || Math.abs(b.h.change24h ?? -1) - Math.abs(a.h.change24h ?? -1))
    }
    const pinIndex = (r: Row): number => {
      const i = s.pinOrder.indexOf(r.h.mint)
      return i < 0 ? 1e6 : i
    }
    return list.sort((a, b) => {
      if (!!a.meta.pinned !== !!b.meta.pinned) return a.meta.pinned ? -1 : 1
      if (a.meta.pinned && b.meta.pinned) return pinIndex(a) - pinIndex(b)
      const [x, y] = [val(a), val(b)]
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counted, q, tag, sort, degen, s.settings.hideSmall, s.settings.smallThreshold, s.pinOrder])
  const hidden = counted.length - counted.filter(shown).length

  // Pinned rows can be dragged; the local order is shown until the saved order catches up.
  const [pinDrag, setPinDrag] = useState<string[] | null>(null)
  const pinLatest = useRef<string[]>([])
  useEffect(() => setPinDrag(null), [s.pinOrder.join(',')])

  if (!s.wallets.length) return <Onboarding />

  const walletLabel = wallet ? (s.wallets.find((w) => w.address === wallet)?.label ?? 'Wallet') : 'All wallets'
  const status = p.wallets.find((w) => w.address === wallet)
  const loadingFirst = p.refreshing && !p.updatedAt
  const points = mode === 'Estimated' ? est.points : rec
  const top = [...counted].sort((a, b) => b.counted - a.counted)
  const bar = [...top.slice(0, 7), ...(top.length > 7 ? [{ h: { mint: 'other', symbol: 'Other' }, alloc: top.slice(7).reduce((x, r) => x + r.alloc, 0) }] : [])]
  const usedTags = s.tags.filter((t) => rows.some((r) => r.meta.tags?.includes(t)))
  const cols = degen ? 'cols-degen' : 'cols-tokens'
  const draggable = !degen && !q && !tag
  const pinnedAll = draggable ? visible.filter((r) => r.meta.pinned) : []
  const pinnedRows = pinDrag ? (pinDrag.map((m) => pinnedAll.find((r) => r.h.mint === m)).filter(Boolean) as Row[]) : pinnedAll
  const restRows = draggable ? visible.filter((r) => !r.meta.pinned) : visible
  const togglePin = (r: Row): void => void act(call('meta.set', r.h.mint, { pinned: !r.meta.pinned }), r.meta.pinned ? `${r.h.symbol} unpinned` : `${r.h.symbol} pinned to top`)
  const cells = (r: Row) => (
    <>
      <div className="row-flex" style={{ gap: 11, minWidth: 0 }}>
        <TokenIcon src={r.h.icon} mint={r.h.mint} symbol={r.h.symbol} />
        <div className="col" style={{ minWidth: 0 }}>
          <div className="row-flex" style={{ gap: 6 }}>
            <b className="truncate">{r.h.symbol}</b>
            {collisions.has(r.h.symbol.trim().toLowerCase()) && <CollisionBadge symbol={r.h.symbol} />}
            {r.meta.tags?.slice(0, 2).map((t) => <span key={t} className="tag">{t}</span>)}
          </div>
          <span className="muted truncate sub" style={{ fontSize: 12 }}>{r.h.name}</span>
        </div>
      </div>
      <span className="r num">{fmtPrice(r.h.price)}</span>
      <span className="r"><Delta pct={r.h.change24h} pill={degen} /></span>
      {!degen && <span className="r num muted">{fmtCompact(r.amount)}</span>}
      <b className="r num">{fmtUsd(r.value)}</b>
      {!degen && (
        <div className="r" style={{ width: '100%', maxWidth: 110 }}>
          <span className="num muted" style={{ fontSize: 12.5 }}>{(r.alloc * 100).toFixed(1)}%</span>
          <div className="mini-bar"><div style={{ width: `${Math.max(2, r.alloc * 100)}%` }} /></div>
        </div>
      )}
      <span className={`r num ${cls(r.upnl)}`}>{r.upnl == null ? <span className="faint">—</span> : fmtSigned(r.upnl)}</span>
      <button className={`icon-btn row-actions ${r.meta.pinned ? 'on keep' : ''}`} title={r.meta.pinned ? 'Unpin' : 'Pin to top'} aria-pressed={!!r.meta.pinned} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); togglePin(r) }}>
        <Pin size={14} />
      </button>
    </>
  )
  const th = (key: SortKey, label: string, right = true) => (
    <button className={`${right ? 'r' : ''} ${sort.key === key ? 'sorted' : ''}`} onClick={() => setSort({ key, dir: sort.key === key ? (sort.dir === 1 ? -1 : 1) : key === 'symbol' ? 1 : -1 })}>
      {label}
      {sort.key === key && (sort.dir === -1 ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
    </button>
  )

  return (
    <div className="page">
      {p.error && (
        <div className={`banner ${p.offline ? '' : 'error'}`}>
          <AlertTriangle size={16} />
          <div className="grow">
            {p.offline ? `Showing last known data from ${timeAgo(p.updatedAt)}. ` : ''}
            {p.error}
          </div>
          <button className="btn sm" onClick={() => void act(call('app.refresh'))}>Retry</button>
        </div>
      )}
      {wallet && status && !status.ok && (
        <div className="banner error">
          <AlertTriangle size={16} />
          <div className="grow">This wallet could not be read. {status.updatedAt ? `Balances are from ${timeAgo(status.updatedAt)}.` : 'No balances are available yet.'}</div>
        </div>
      )}

      <section className="card hero">
        <div className="row-flex" style={{ justifyContent: 'space-between', position: 'relative' }}>
          <div className="label">Total balance · {walletLabel}</div>
          <div className="row-flex">
            <span className="pill accent">{mood(d1?.pct ?? null)}</span>
            <button className="btn sm ghost" onClick={() => setModal({ kind: 'pnl', mint: null })}>
              <Image size={14} /> PnL card
            </button>
          </div>
        </div>
        {loadingFirst ? (
          <div className="skeleton" style={{ width: 320, height: 62, margin: '8px 0 12px' }} />
        ) : (
          <HeroTotal total={total} bind={hoverBind} />
        )}
        <div className="row-flex" style={{ marginBottom: 18 }}>
          {d1 ? (
            <>
              <span className={`num ${cls(d1.abs)}`} style={{ fontWeight: 600 }}>{fmtSigned(d1.abs)}</span>
              <Delta pct={d1.pct} pill />
              <span className="faint">past 24h</span>
            </>
          ) : (
            <span className="faint">{loadingFirst ? 'Reading balances from chain…' : '24h change unavailable'}</span>
          )}
        </div>

        <div className="perf-grid">
          <PerfTile label="24H" perf={d1} delay={0} hint="Price move on what you hold now" />
          <PerfTile label="7D" perf={d7 && d7.coverage >= 0.85 ? d7 : null} delay={0.04} hint={d7 ? 'Not enough price history yet' : 'Loading price history…'} />
          <PerfTile label="30D" perf={d30 && d30.coverage >= 0.85 ? d30 : null} delay={0.08} hint={d30 ? 'Some coins are younger than 30d' : 'Loading price history…'} />
          <PerfTile label="6M" perf={d180 && d180.coverage >= 0.85 ? d180 : null} delay={0.12} hint={d180 ? 'Some coins are younger than 6 months' : 'Loading price history…'} />
          <PerfTile label="1Y" perf={d365 && d365.coverage >= 0.85 ? d365 : null} delay={0.16} hint={d365 ? 'Some coins are younger than 1 year' : 'Loading price history…'} />
          <PerfTile
            label="All-time PnL"
            perf={all && all.invested > 0 ? { pct: (all.pnl / all.invested) * 100, abs: all.pnl, coverage: 1 } : null}
            delay={0.2}
            hint={all ? 'Realized + unrealized on tracked trades' : s.settings.autoHistory ? 'Filling in from your history…' : 'Add buys to track'}
          />
        </div>

        <div className="row-flex" style={{ justifyContent: 'space-between', margin: '20px 0 4px' }}>
          <Segmented value={mode} options={['Estimated', 'Recorded'] as const} onChange={setMode} />
          <Segmented value={range} options={RANGE_OPTIONS} onChange={setRange} />
        </div>
        <AreaChart
          points={points}
          height={210}
          format={(v) => fmtUsd(v)}
          loading={mode === 'Estimated' && !Object.keys(history).length && total > 0}
          onHover={(pt) => hoverBind.current?.(pt ? pt[1] : null)}
          empty={
            mode === 'Recorded' ? (
              <span>Bagscope records your real balance each time it refreshes. Leave it running and this chart fills in.</span>
            ) : (
              <span>No price history available for these holdings yet.</span>
            )
          }
        />
        <div className="faint" style={{ fontSize: 11.5, padding: '6px 0 10px' }}>
          {mode === 'Estimated'
            ? `Estimate: today's holdings at past prices${est.points.length ? `, price history covers ${(est.coverage * 100).toFixed(0)}% of value` : ''}. Not your actual trading history.`
            : `Recorded by this app${rec.length ? ` · ${rec.length - 1} readings in range` : ''}.`}
        </div>
      </section>

      {counted.length > 0 && (
        <section className="card pad">
          <div className="alloc-bar">
            {bar.map((r, i) => (
              <div key={r.h.mint} style={{ flexGrow: Math.max(r.alloc, 0.004), background: PALETTE[i % PALETTE.length] }} title={`${r.h.symbol} ${(r.alloc * 100).toFixed(1)}%`} />
            ))}
          </div>
          <div className="row-flex" style={{ flexWrap: 'wrap', gap: 14, marginTop: 12 }}>
            {bar.map((r, i) => (
              <span key={r.h.mint} className="row-flex" style={{ gap: 6, fontSize: 12.5 }}>
                <span className="dot" style={{ background: PALETTE[i % PALETTE.length] }} />
                <b>{r.h.symbol}</b>
                <span className="muted num">{(r.alloc * 100).toFixed(1)}%</span>
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <div className="row-flex" style={{ padding: '14px 16px', gap: 10, flexWrap: 'wrap' }}>
          <div className="h2">Bags</div>
          <span className="pill">{visible.length}</span>
          {degen && <span className="pill accent">Degen mode</span>}
          {usedTags.map((t) => (
            <button key={t} className={`chip sm ${tag === t ? 'active' : ''}`} onClick={() => setTag(tag === t ? null : t)}>{t}</button>
          ))}
          <div className="grow" />
          <div style={{ width: 220 }}>
            <SearchInput id="token-search" value={q} onChange={setQ} placeholder="Search tokens  /" />
          </div>
          <button className={`icon-btn ${s.settings.hideSmall || degen ? 'on' : ''}`} disabled={degen} title={degen ? `Degen mode always hides balances under $${s.settings.smallThreshold}` : `${s.settings.hideSmall ? 'Showing' : 'Hide'} balances under $${s.settings.smallThreshold} (H)`} onClick={() => void call('settings.set', { hideSmall: !s.settings.hideSmall })}>
            {s.settings.hideSmall || degen ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
          <button className={`icon-btn ${compact ? 'on' : ''}`} aria-pressed={compact} title={`${compact ? 'Comfortable' : 'Compact'} rows (C)`} onClick={() => void act(call('settings.set', { density: compact ? 'comfortable' : 'compact' }), compact ? 'Comfortable rows' : 'Compact rows')}>
            {compact ? <Rows4 size={16} /> : <Rows3 size={16} />}
          </button>
          <Segmented value={layout} options={[{ value: 'list', label: 'List' }, { value: 'grid', label: 'Grid' }]} onChange={setLayout} />
        </div>

        {loadingFirst ? (
          <div style={{ padding: 16, display: 'grid', gap: 10 }}>
            {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 42 }} />)}
          </div>
        ) : !visible.length ? (
          <Empty icon={<LayoutGrid size={22} />} title={counted.length ? 'Nothing matches' : 'No priced tokens here'}>
            <p>{counted.length ? 'Try a different search, tag, or show small balances.' : 'This wallet holds no tokens with a trustworthy price right now.'}</p>
          </Empty>
        ) : layout === 'list' ? (
          <motion.div key={`${compact}${degen}`} className="table" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.22, ease: EASE }}>
            <div className={`thead ${cols}`}>
              {degen ? <span>Token · ranked by 24h move</span> : th('symbol', 'Token', false)}
              {degen ? <span className="r">Price</span> : th('price', 'Price')}
              {degen ? <span className="r">24h</span> : th('change', '24h')}
              {!degen && <span className="r">Holdings</span>}
              {degen ? <span className="r">Value</span> : th('value', 'Value')}
              {!degen && <span className="r">Allocation</span>}
              {degen ? <span className="r">Unrealized</span> : th('pnl', 'Unrealized')}
              <span />
            </div>
            {pinnedRows.length > 0 && (
              <Reorder.Group
                as="div"
                axis="y"
                values={pinnedRows.map((r) => r.h.mint)}
                onReorder={(order) => {
                  pinLatest.current = order
                  setPinDrag(order)
                }}
              >
                {pinnedRows.map((r) => (
                  <Reorder.Item
                    as="div"
                    key={r.h.mint}
                    value={r.h.mint}
                    className={`trow reorder ${cols}`}
                    tabIndex={0}
                    title="Drag, or Alt + ↑ ↓, to reorder pinned tokens"
                    whileDrag={{ scale: 1.01, boxShadow: '0 12px 32px rgba(0,0,0,0.35)' }}
                    transition={{ duration: 0.22, ease: EASE }}
                    onDragStart={() => (draggedAt.current = Date.now())}
                    onDragEnd={() => {
                      draggedAt.current = Date.now()
                      if (pinLatest.current.length) void call('pins.reorder', pinLatest.current)
                    }}
                    onClick={() => Date.now() - draggedAt.current > 250 && openToken(r.h.mint)}
                    onKeyDown={(e: React.KeyboardEvent) => {
                      if (e.key === 'Enter') openToken(r.h.mint)
                      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                        e.preventDefault()
                        const order = pinnedRows.map((x) => x.h.mint)
                        const i = order.indexOf(r.h.mint)
                        const j = i + (e.key === 'ArrowUp' ? -1 : 1)
                        if (j < 0 || j >= order.length) return
                        order.splice(j, 0, order.splice(i, 1)[0])
                        setPinDrag(order)
                        void call('pins.reorder', order)
                      }
                    }}
                  >
                    {cells(r)}
                  </Reorder.Item>
                ))}
              </Reorder.Group>
            )}
            {restRows.map((r, i) => (
              <div key={r.h.mint} className={`trow ${cols}`} tabIndex={0} style={{ animationDelay: `${Math.min(i, 14) * 22}ms` }} onClick={() => openToken(r.h.mint)} onKeyDown={(e) => e.key === 'Enter' && openToken(r.h.mint)}>
                {cells(r)}
              </div>
            ))}
          </motion.div>
        ) : (
          <div className="grid-tokens">
            {visible.map((r, i) => (
              <div key={r.h.mint} className="tile" style={{ animationDelay: `${Math.min(i, 14) * 22}ms` }} onClick={() => openToken(r.h.mint)}>
                <div className="row-flex">
                  <TokenIcon src={r.h.icon} mint={r.h.mint} symbol={r.h.symbol} size={30} />
                  <b className="grow truncate">{r.h.symbol}</b>
                  {r.meta.pinned && <Pin size={13} className="accent" />}
                  <Delta pct={r.h.change24h} pill />
                </div>
                <div className="display num" style={{ fontSize: 22, fontWeight: 600, margin: '12px 0 2px' }}>{fmtUsd(r.value)}</div>
                <div className="muted num" style={{ fontSize: 12 }}>{fmtCompact(r.amount)} · {fmtPrice(r.h.price)}</div>
                <div className="mini-bar" style={{ marginTop: 12 }}><div style={{ width: `${Math.max(2, r.alloc * 100)}%` }} /></div>
              </div>
            ))}
          </div>
        )}

        {hidden > 0 && !q && !tag && (
          <div className="faint" style={{ padding: '10px 16px', fontSize: 12, borderTop: '1px solid var(--border)' }}>
            {hidden} small balance{hidden > 1 ? 's' : ''} under ${s.settings.smallThreshold} hidden but still counted in the total. <a onClick={() => void call('settings.set', { hideSmall: false })}>Show</a>
          </div>
        )}
      </section>

      {excluded.length > 0 && (
        <section className="card">
          <button className="btn ghost" style={{ width: '100%', justifyContent: 'space-between', height: 46, padding: '0 16px' }} onClick={() => setShowExcluded(!showExcluded)}>
            <span>Not counted in total · {excluded.length} token{excluded.length > 1 ? 's' : ''} without a trustworthy price</span>
            <ChevronDown size={16} style={{ transform: showExcluded ? 'rotate(180deg)' : '', transition: 'transform var(--base) var(--ease)' }} />
          </button>
          {showExcluded && (
            <div className="table">
              {excluded.slice(0, 150).map((r) => (
                <div key={r.h.mint} className="trow dim" style={{ gridTemplateColumns: '2fr 1fr 1fr 1.4fr', height: 48 }} onClick={() => openToken(r.h.mint)}>
                  <div className="row-flex" style={{ minWidth: 0 }}>
                    <TokenIcon src={r.h.icon} mint={r.h.mint} symbol={r.h.symbol} size={26} />
                    <b className="truncate">{r.h.symbol}</b>
                    <span className="muted truncate" style={{ fontSize: 12 }}>{r.h.name}</span>
                  </div>
                  <span className="r num muted">{fmtCompact(r.amount)}</span>
                  <span className="r num muted">{r.value == null ? '—' : `${fmtUsd(r.value)} quoted`}</span>
                  <span className="r"><span className="pill warn">{REASON[r.h.excluded!]}</span></span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <button className="btn ghost" style={{ alignSelf: 'center' }} onClick={() => setModal({ kind: 'wallets' })}>
        <Plus size={15} /> Add another wallet
      </button>
    </div>
  )
}
