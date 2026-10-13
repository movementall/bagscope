import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Download, ExternalLink, History, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { SOL_MINT, type TxRecord } from '@shared/types'
import { openUrl } from '@/components/Social'
import { Empty, Page, SearchInput, Segmented, useAsync } from '@/components/ui'
import { fmtCompact, fmtDateTime, fmtUsd, shortAddr } from '@/lib/format'
import { call, useStore } from '@/lib/store'
import { NoWallets } from './Extras'
import { saveCsv } from './Portfolio'

type Filter = 'all' | 'swap' | 'send' | 'receive'
const ICON = { swap: ArrowLeftRight, send: ArrowUpRight, receive: ArrowDownLeft, other: History }

const sym = (t: TxRecord, mint: string): string => (mint === SOL_MINT ? 'SOL' : (t.symbols[mint] ?? shortAddr(mint, 3)))

function describe(t: TxRecord): string {
  const leg = (c: { mint: string; delta: number }): string => `${fmtCompact(Math.abs(c.delta))} ${sym(t, c.mint)}`
  const outs = t.changes.filter((c) => c.delta < 0).map(leg).join(' + ')
  const ins = t.changes.filter((c) => c.delta > 0).map(leg).join(' + ')
  if (t.type === 'swap') return `${outs} → ${ins}`
  if (t.type === 'send') return `Sent ${outs}`
  if (t.type === 'receive') return `Received ${ins}`
  return 'Contract interaction'
}

export function Activity() {
  const { state, wallet, txsync } = useStore()
  const wallets = state!.wallets
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const txs = useAsync(() => call<TxRecord[]>('tx.list'), [])
  const targets = wallet ? [wallet] : wallets.map((w) => w.address)
  const active = targets.map((a) => txsync[a]).filter((s) => s && !s.finished)
  const busy = active.length > 0
  const errors = targets.map((a) => txsync[a]?.error).filter(Boolean)

  const finishedKey = targets.map((a) => (txsync[a]?.finished ? txsync[a].done : -1)).join(',')
  useEffect(() => {
    txs.reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishedKey])

  const sync = (older: boolean): void => targets.forEach((a) => void call('tx.sync', a, older))
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (txs.data ?? [])
      .filter((t) => !wallet || t.wallet === wallet)
      .filter((t) => filter === 'all' || t.type === filter)
      .filter((t) => !needle || t.sig.toLowerCase().startsWith(needle) || t.changes.some((c) => sym(t, c.mint).toLowerCase().includes(needle) || c.mint.toLowerCase() === needle))
  }, [txs.data, wallet, filter, q])

  const exportCsv = (): void =>
    saveCsv(`bagscope-activity-${new Date().toISOString().slice(0, 10)}.csv`, [
      ['Date', 'Type', 'Description', 'Value USD', 'Fee SOL', 'Wallet', 'Failed', 'Signature'],
      ...list.map((t) => [new Date(t.ts).toISOString(), t.type, describe(t), t.usdValue, t.fee, t.wallet, t.failed ? 'yes' : '', t.sig])
    ])

  if (!wallets.length) {
    return (
      <Page title="Activity" sub="Your transactions, decoded straight from chain.">
        <NoWallets what="Activity reads each wallet's transactions from chain and turns swaps into buy and sell records." />
      </Page>
    )
  }

  return (
    <Page
      title="Activity"
      sub="Decoded straight from chain. Swaps against SOL or stablecoins become buy and sell records automatically."
      actions={
        <>
          <button className="btn primary" disabled={busy || !targets.length} onClick={() => sync(false)}>
            <RefreshCw size={14} className={busy ? 'spin' : ''} /> {busy ? `Syncing ${active.reduce((s, a) => s + a.done, 0)}/${active.reduce((s, a) => s + a.total, 0)}` : 'Sync latest'}
          </button>
          <button className="btn" disabled={!list.length} onClick={exportCsv}><Download size={14} /> CSV</button>
        </>
      }
    >
      {errors.length > 0 && <div className="banner error"><div className="grow">Sync failed: {errors[0]}. Nothing was guessed; try again or add a faster RPC in Settings.</div></div>}
      <section className="card">
        <div className="row-flex" style={{ padding: '14px 16px' }}>
          <Segmented value={filter} options={[{ value: 'all', label: 'All' }, { value: 'swap', label: 'Swaps' }, { value: 'receive', label: 'Received' }, { value: 'send', label: 'Sent' }]} onChange={setFilter} />
          <div className="grow" />
          <div style={{ width: 260 }}><SearchInput value={q} onChange={setQ} placeholder="Search token or signature" /></div>
        </div>
        {list.length ? (
          <>
            {list.slice(0, 400).map((t) => {
              const Icon = ICON[t.type]
              const w = wallets.find((x) => x.address === t.wallet)
              return (
                <div key={t.sig + t.wallet} className="trow" style={{ gridTemplateColumns: '34px 2.6fr 1fr 1fr 1.1fr 30px', opacity: t.failed ? 0.5 : 1, animation: 'none' }} onClick={() => openUrl(`https://solscan.io/tx/${t.sig}`)}>
                  <div className="token-icon" style={{ width: 32, height: 32 }}><Icon size={15} /></div>
                  <div className="col" style={{ minWidth: 0 }}>
                    <b className="truncate num">{describe(t)}</b>
                    <span className="faint mono">{shortAddr(t.sig, 6)}{t.failed && ' · failed'}</span>
                  </div>
                  <span className="r num">{t.usdValue == null ? <span className="faint">—</span> : fmtUsd(t.usdValue)}</span>
                  <span className="r row-flex" style={{ gap: 6 }}><span className="dot" style={{ background: w?.color }} />{w?.label ?? shortAddr(t.wallet)}</span>
                  <span className="r muted" style={{ fontSize: 12.5 }}>{fmtDateTime(t.ts)}</span>
                  <ExternalLink size={14} className="faint" />
                </div>
              )
            })}
            <div style={{ padding: 14, textAlign: 'center' }}>
              <button className="btn ghost" disabled={busy} onClick={() => sync(true)}>Load older transactions</button>
            </div>
          </>
        ) : (
          <Empty icon={<History size={22} />} title={txs.data?.length ? 'Nothing matches' : 'No history loaded yet'}>
            <p>{txs.error ?? (txs.data?.length ? 'Try another filter.' : 'Press “Sync latest” to read your recent transactions from chain. The public RPC is slow; expect a few seconds per wallet.')}</p>
          </Empty>
        )}
      </section>
    </Page>
  )
}
