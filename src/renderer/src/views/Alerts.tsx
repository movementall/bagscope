import { Bell, BellOff, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { AlertKind, AlertRule } from '@shared/types'
import { openUrl } from '@/components/Social'
import { Empty, Page, Toggle } from '@/components/ui'
import { fmtCompact, fmtPrice, fmtUsd, timeAgo } from '@/lib/format'
import { act, call, useStore } from '@/lib/store'

const KINDS: { value: AlertKind; label: string; unit: string }[] = [
  { value: 'price-above', label: 'Price goes above', unit: '$' },
  { value: 'price-below', label: 'Price drops below', unit: '$' },
  { value: 'mcap-above', label: 'Market cap goes above', unit: '$' },
  { value: 'mcap-below', label: 'Market cap drops below', unit: '$' },
  { value: 'whale', label: 'Whale trade larger than', unit: '$' },
  { value: 'liquidity-drop', label: 'Liquidity pulled by at least', unit: '%' }
]

/** Accepts plain numbers and shorthand such as 5m, 250k or 1.2b. */
export function parseAmount(text: string): number {
  const m = /^\s*\$?\s*([\d.,]+)\s*([kmbt])?\s*$/i.exec(text)
  if (!m) return NaN
  const n = Number(m[1].replace(/,/g, ''))
  return n * ({ k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[(m[2] ?? '').toLowerCase()] ?? 1)
}

const describe = (r: AlertRule): string =>
  r.kind === 'price-above' ? `above ${fmtPrice(r.value)}` : r.kind === 'price-below' ? `below ${fmtPrice(r.value)}` : r.kind === 'mcap-above' ? `market cap above ${fmtCompact(r.value, '$')}` : r.kind === 'mcap-below' ? `market cap below ${fmtCompact(r.value, '$')}` : r.kind === 'whale' ? `trades over ${fmtUsd(r.value, 0)}` : `liquidity down ${r.value}%`

export function AlertForm({ mint, symbol, price, mcap }: { mint: string; symbol: string; price: number | null; mcap: number | null }) {
  const [kind, setKind] = useState<AlertKind>('price-above')
  const [value, setValue] = useState('')
  const k = KINDS.find((x) => x.value === kind)!
  const isPrice = kind.startsWith('price')
  const isMcap = kind.startsWith('mcap')
  const amount = isMcap ? parseAmount(value) : Number(value)
  const noMcap = isMcap && mcap == null
  return (
    <div className="card pad" style={{ background: 'var(--raised)' }}>
      <b>New alert for {symbol}</b>
      <div className="row-flex" style={{ marginTop: 10 }}>
        <select className="select" style={{ flex: 1.4 }} value={kind} onChange={(e) => { setKind(e.target.value as AlertKind); setValue('') }}>
          {KINDS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
        </select>
        <div className="row-flex" style={{ flex: 1, gap: 6 }}>
          <span className="muted">{k.unit}</span>
          <input
            className="input num"
            type={isMcap ? 'text' : 'number'}
            inputMode="decimal"
            min={0}
            aria-label={k.label}
            value={value}
            disabled={noMcap}
            onChange={(e) => setValue(e.target.value)}
            placeholder={isMcap ? (mcap != null ? `e.g. ${fmtCompact(mcap * (kind === 'mcap-above' ? 2 : 0.5)).toLowerCase()}` : 'unavailable') : isPrice && price != null ? String(Number(price.toPrecision(4))) : kind === 'whale' ? '10000' : '30'}
          />
        </div>
        <button className="btn primary" disabled={!(amount > 0) || noMcap} onClick={() => void act(call('alerts.add', { kind, mint, symbol, value: amount, repeat: !isPrice && !isMcap }), 'Alert set').then(() => setValue(''))}>
          Set alert
        </button>
      </div>
      <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>
        {noMcap
          ? 'Market cap is not available for this coin (its circulating supply is unknown), so this alert cannot be set.'
          : isMcap
            ? `Fires once. Type a number or shorthand like 5m, 250k, 1.2b${amount > 0 ? ` = ${fmtUsd(amount, 0)}` : ''}. Current market cap ${fmtCompact(mcap, '$')}.`
            : isPrice ? `Fires once. Current price ${fmtPrice(price)}.` : kind === 'whale' ? 'Watches the main pool for single trades above this size.' : 'Compares main-pool liquidity between checks, about every two minutes.'}
      </p>
    </div>
  )
}

export function AlertList({ mint }: { mint?: string }) {
  const { state, openToken } = useStore()
  const rules = state!.alerts.filter((a) => !mint || a.mint === mint)
  if (!rules.length) return mint ? null : <p className="muted" style={{ padding: '6px 0' }}>No alerts yet. Open any coin and use its Alerts tab, or add one above.</p>
  return (
    <div>
      {rules.map((r) => (
        <div key={r.id} className="list-row">
          {r.enabled ? <Bell size={15} className="accent" /> : <BellOff size={15} className="faint" />}
          <div className="col grow">
            <span><b style={{ cursor: 'pointer' }} onClick={() => openToken(r.mint)}>{r.symbol}</b> {describe(r)}</span>
            <span className="faint" style={{ fontSize: 12 }}>{r.lastFiredAt ? `Last fired ${timeAgo(r.lastFiredAt)}` : `Set ${timeAgo(r.createdAt)}`}{!r.enabled && r.lastFiredAt ? ' · done' : ''}</span>
          </div>
          <Toggle on={r.enabled} onChange={(enabled) => void call('alerts.update', r.id, { enabled })} />
          <button className="icon-btn" title="Delete alert" onClick={() => void act(call('alerts.remove', r.id))}><Trash2 size={14} /></button>
        </div>
      ))}
    </div>
  )
}

export function Alerts() {
  const { state, portfolio } = useStore()
  const coins = [...portfolio!.holdings.filter((h) => !h.excluded), ...portfolio!.watch.filter((h) => h.price != null)]
  const [mint, setMint] = useState(coins[0]?.mint ?? '')
  const coin = coins.find((c) => c.mint === mint) ?? coins[0]
  const notifs = state!.notifications
  return (
    <Page title="Alerts" sub="Native Windows notifications while Bagscope is open.">
      <section className="card pad">
        {coin ? (
          <>
            <label className="field" style={{ maxWidth: 320, marginBottom: 12 }}>
              <span>Coin</span>
              <select className="select" value={coin.mint} onChange={(e) => setMint(e.target.value)}>
                {coins.map((c) => <option key={c.mint} value={c.mint}>{c.symbol} · {c.name}</option>)}
              </select>
            </label>
            <AlertForm mint={coin.mint} symbol={coin.symbol} price={coin.price} mcap={coin.mcap} />
          </>
        ) : (
          <p className="muted">Alerts are set per coin. Add a wallet, or put a coin on your Watchlist, and it will show up here.</p>
        )}
        <div className="h2" style={{ margin: '18px 0 4px' }}>Active rules</div>
        <AlertList />
      </section>

      <section className="card pad">
        <div className="section-title">
          <div className="h2">Notification log</div>
          {notifs.length > 0 && (
            <div className="row-flex">
              <button className="btn sm ghost" onClick={() => void call('notifs.read')}>Mark all read</button>
              <button className="btn sm ghost danger" onClick={() => void call('notifs.clear')}>Clear</button>
            </div>
          )}
        </div>
        {notifs.map((n) => (
          <div key={n.id} className="list-row" style={{ cursor: n.url ? 'pointer' : undefined }} onClick={() => n.url && openUrl(n.url)}>
            <span className="dot" style={{ background: n.read ? 'var(--border-strong)' : 'var(--accent)' }} />
            <div className="col grow">
              <b>{n.title}</b>
              <span className="muted" style={{ fontSize: 12.5 }}>{n.body}</span>
            </div>
            <span className="faint" style={{ fontSize: 12 }}>{timeAgo(n.ts)}</span>
          </div>
        ))}
        {!notifs.length && <Empty icon={<Bell size={22} />} title="Quiet. Too quiet."><p>Alerts that fire show up here and as Windows notifications.</p></Empty>}
      </section>
    </Page>
  )
}
