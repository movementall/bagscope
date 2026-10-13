import { Camera, ChevronDown, Download, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { lotsFor, positionFromLots } from '@shared/calc'
import { Empty, Page, TokenIcon } from '@/components/ui'
import { allTimePnl, buildRows } from '@/lib/derive'
import { cls, fmtCompact, fmtDateTime, fmtPct, fmtPrice, fmtSigned, fmtUsd, toCsv } from '@/lib/format'
import { act, call, useStore } from '@/lib/store'
import { Compare } from './Compare'
import { NoWallets } from './Extras'

export const saveCsv = (name: string, rows: (string | number | null | undefined)[][]): void =>
  void act(call<string | null>('app.saveFile', { name, content: toCsv(rows) })).then((path) => path && useStore.getState().toast(`Saved ${path}`))

const stamp = (): string => new Date().toISOString().slice(0, 10)

export function Portfolio() {
  const { state, portfolio, wallet, openToken } = useStore()
  const s = state!
  const [label, setLabel] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const { rows, total } = useMemo(() => buildRows(portfolio!.holdings, wallet, s.tokenMeta, s.lots), [portfolio, wallet, s.tokenMeta, s.lots])
  const all = useMemo(() => allTimePnl(rows, s.lots, wallet), [rows, s.lots, wallet])
  const tracked = rows.filter((r) => r.pos.buys || r.pos.sells).sort((a, b) => Math.abs((b.upnl ?? 0) + b.pos.realized) - Math.abs((a.upnl ?? 0) + a.pos.realized))
  const held = new Set(rows.map((r) => r.h.mint))
  const exited = [...new Set(s.lots.map((l) => l.mint))].filter((m) => !held.has(m)).map((mint) => ({ mint, pos: positionFromLots(lotsFor(s.lots, mint, wallet)) })).filter((e) => e.pos.sells)
  const snaps = [...s.snapshots].sort((a, b) => b.ts - a.ts)

  const exportHoldings = (): void =>
    saveCsv(`bagscope-holdings-${stamp()}.csv`, [
      ['Symbol', 'Name', 'Mint', 'Amount', 'Price USD', 'Value USD', 'Allocation %', '24h %', 'Avg entry USD', 'Unrealized USD', 'Realized USD', 'Counted', 'Tags', 'Note'],
      ...rows.map((r) => [r.h.symbol, r.h.name, r.h.mint, r.amount, r.h.price, r.value, (r.alloc * 100).toFixed(2), r.h.change24h, r.pos.avgCost, r.upnl, r.pos.sells ? r.pos.realized : null, r.h.excluded ? `no (${r.h.excluded})` : 'yes', r.meta.tags?.join('; '), r.meta.note])
    ])
  const exportTrades = (): void =>
    saveCsv(`bagscope-trades-${stamp()}.csv`, [
      ['Date', 'Side', 'Mint', 'Amount', 'Price USD', 'Total USD', 'Wallet', 'Source', 'Signature'],
      ...s.lots.map((l) => [new Date(l.ts).toISOString(), l.side, l.mint, l.amount, l.priceUsd, l.amount * l.priceUsd, l.wallet, l.source, l.sig])
    ])
  const exportSnaps = (): void =>
    saveCsv(`bagscope-snapshots-${stamp()}.csv`, [
      ['Date', 'Kind', 'Label', 'Total USD', 'Symbol', 'Mint', 'Amount', 'Price USD', 'Value USD'],
      ...snaps.flatMap((sn) => sn.positions.map((p) => [new Date(sn.ts).toISOString(), sn.kind, sn.label, sn.total, p.symbol, p.mint, p.amount, p.price, p.value]))
    ])

  if (!s.wallets.length) {
    return (
      <Page title="Portfolio" sub="Profit and loss, benchmarks and snapshots.">
        <NoWallets what="Profit and loss, the benchmark comparison and snapshots are all built from your wallets' real balances." />
      </Page>
    )
  }

  return (
    <Page
      title="Portfolio"
      sub={wallet ? s.wallets.find((w) => w.address === wallet)?.label : 'All wallets'}
      actions={
        <>
          <button className="btn" onClick={exportHoldings} disabled={!rows.length}><Download size={14} /> Holdings CSV</button>
          <button className="btn" onClick={exportTrades} disabled={!s.lots.length}><Download size={14} /> Trades CSV</button>
        </>
      }
    >
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
        <div className="stat card"><div className="label">Value</div><div className="v num">{fmtUsd(total)}</div></div>
        <div className="stat card"><div className="label">Unrealized PnL</div><div className={`v num ${cls(all?.unreal)}`}>{all ? fmtSigned(all.unreal) : '—'}</div></div>
        <div className="stat card"><div className="label">Realized PnL</div><div className={`v num ${cls(all?.realized)}`}>{all ? fmtSigned(all.realized) : '—'}</div></div>
        <div className="stat card"><div className="label">Total on tracked trades</div><div className={`v num ${cls(all?.pnl)}`}>{all ? `${fmtSigned(all.pnl)}${all.invested > 0 ? ` · ${fmtPct((all.pnl / all.invested) * 100)}` : ''}` : '—'}</div></div>
      </div>

      <Compare />

      <section className="card">
        <div style={{ padding: '14px 16px' }} className="h2">Profit & loss by coin</div>
        {tracked.length || exited.length ? (
          <div className="table">
            <div className="thead" style={{ gridTemplateColumns: '1.8fr 1fr 1fr 1fr 1fr 1fr 1fr' }}>
              <span>Token</span><span className="r">Value</span><span className="r">Avg entry</span><span className="r">Price</span><span className="r">Unrealized</span><span className="r">Realized</span><span className="r">Position size</span>
            </div>
            {tracked.map((r) => (
              <div key={r.h.mint} className="trow" style={{ gridTemplateColumns: '1.8fr 1fr 1fr 1fr 1fr 1fr 1fr' }} onClick={() => openToken(r.h.mint, 'trades')}>
                <div className="row-flex" style={{ minWidth: 0 }}><TokenIcon src={r.h.icon} mint={r.h.mint} symbol={r.h.symbol} size={28} /><b className="truncate">{r.h.symbol}</b><span className="faint" style={{ fontSize: 12 }}>{r.pos.buys} buys</span></div>
                <b className="r num">{fmtUsd(r.value)}</b>
                <span className="r num">{fmtPrice(r.pos.avgCost)}</span>
                <span className="r num">{fmtPrice(r.h.price)}</span>
                <span className={`r num ${cls(r.upnl)}`}>{r.upnl == null ? '—' : `${fmtSigned(r.upnl)}${r.pos.avgCost && r.h.price ? ` (${fmtPct((r.h.price / r.pos.avgCost - 1) * 100, 0)})` : ''}`}</span>
                <span className={`r num ${cls(r.pos.sells ? r.pos.realized : null)}`}>{r.pos.sells ? fmtSigned(r.pos.realized) : '—'}</span>
                <span className="r num muted">{(r.alloc * 100).toFixed(1)}%</span>
              </div>
            ))}
            {exited.map((e) => (
              <div key={e.mint} className="trow dim" style={{ gridTemplateColumns: '1.8fr 1fr 1fr 1fr 1fr 1fr 1fr' }} onClick={() => openToken(e.mint, 'trades')}>
                <div className="row-flex"><span className="mono">{e.mint.slice(0, 6)}…</span><span className="pill">exited</span></div>
                <span className="r">—</span><span className="r">—</span><span className="r">—</span><span className="r">—</span>
                <span className={`r num ${cls(e.pos.realized)}`}>{fmtSigned(e.pos.realized)}</span><span className="r">—</span>
              </div>
            ))}
          </div>
        ) : (
          <Empty icon={<Camera size={22} />} title="No cost basis yet">
            <p>
              {s.settings.autoHistory
                ? 'Bagscope is reading your transaction history and fills in what you paid for each coin by itself. The first pass can take a few minutes per wallet.'
                : 'PnL needs to know what you paid. Turn on automatic entries in Settings, or open a coin and add your buys under “Trades & DCA”.'}
            </p>
          </Empty>
        )}
      </section>

      <section className="card pad">
        <div className="section-title">
          <div>
            <div className="h2">Snapshots</div>
            <p className="muted" style={{ fontSize: 12.5 }}>A frozen record of every position. {s.settings.autoSnapshot ? 'Saved automatically each day; Mondays are kept as weekly.' : 'Automatic snapshots are off.'}</p>
          </div>
          <div className="row-flex">
            <input className="input" style={{ width: 190 }} placeholder="Label (optional)" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} />
            <button className="btn primary" onClick={() => void act(call('snapshots.save', label), 'Snapshot saved').then(() => setLabel(''))}><Camera size={14} /> Save now</button>
            <button className="btn" disabled={!snaps.length} onClick={exportSnaps}><Download size={14} /> CSV</button>
          </div>
        </div>
        {snaps.map((sn, i) => {
          const prev = snaps[i + 1]
          const diff = prev && prev.total > 0 ? (sn.total / prev.total - 1) * 100 : null
          return (
            <div key={sn.id}>
              <div className="list-row" style={{ cursor: 'pointer' }} onClick={() => setOpen(open === sn.id ? null : sn.id)}>
                <ChevronDown size={15} className="faint" style={{ transform: open === sn.id ? 'rotate(180deg)' : '', transition: 'transform var(--base) var(--ease)' }} />
                <div className="col grow"><b>{sn.label}</b><span className="faint" style={{ fontSize: 12 }}>{fmtDateTime(sn.ts)} · {sn.positions.length} positions</span></div>
                <span className="pill">{sn.kind}</span>
                {diff != null && <span className={`num ${cls(diff)}`} title="Versus the previous snapshot">{fmtPct(diff)}</span>}
                <b className="num" style={{ width: 120, textAlign: 'right' }}>{fmtUsd(sn.total)}</b>
                <button className="icon-btn" title="Delete snapshot" onClick={(e) => { e.stopPropagation(); void act(call('snapshots.remove', sn.id)) }}><Trash2 size={14} /></button>
              </div>
              {open === sn.id && (
                <div style={{ padding: '4px 0 12px 27px' }}>
                  {sn.positions.slice(0, 40).map((p) => (
                    <div key={p.mint} className="row-flex num" style={{ padding: '4px 0', fontSize: 12.5 }}>
                      <b style={{ width: 110 }} className="truncate">{p.symbol}</b>
                      <span className="muted grow">{fmtCompact(p.amount)} @ {fmtPrice(p.price)}</span>
                      <span>{fmtUsd(p.value)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
        {!snaps.length && <p className="muted" style={{ paddingTop: 6 }}>No snapshots yet. The first one is saved after your next successful refresh.</p>}
      </section>
    </Page>
  )
}
