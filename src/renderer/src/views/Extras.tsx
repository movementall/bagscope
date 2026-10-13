import { BadgeCheck, Copy, ExternalLink, GripVertical, Heart, TriangleAlert, WalletCards } from 'lucide-react'
import QRCode from 'qrcode'
import { useEffect, useMemo, useState } from 'react'
import { totalValue } from '@shared/calc'
import { DONATE_ADDRESS, SOL_MINT, type TokenInsight } from '@shared/types'
import { AnimatedNumber, Delta, Empty, ModalHead, TokenIcon } from '@/components/ui'
import { perfOver, tickerCollisions } from '@/lib/derive'
import { fmtCompact, fmtUsd, shortAddr, timeAgo } from '@/lib/format'
import { act, call, useStore } from '@/lib/store'
import type { SearchHit } from './Watchlist'

const DONATE_AMOUNTS = [0.05, 0.1, 0.5, 1]

/**
 * Voluntary support for the developer. Bagscope itself never sends anything: this shows a
 * QR code (Solana Pay format, so a phone wallet pre-fills the address and amount) and the
 * address to copy. The donor sends from their own wallet and approves it there.
 */
export function DonateModal() {
  const { portfolio, setModal, toast } = useStore()
  const [amount, setAmount] = useState<number | null>(0.1)
  const [custom, setCustom] = useState('')
  const [qr, setQr] = useState('')
  const sol = portfolio?.holdings.find((h) => h.mint === SOL_MINT)?.price ?? portfolio?.watch.find((h) => h.mint === SOL_MINT)?.price ?? null
  const chosen = custom.trim() ? Number(custom.replace(',', '.')) : amount
  const valid = chosen != null && Number.isFinite(chosen) && chosen > 0
  // With an amount the QR is a payment request; without one it is just the address.
  const link = `solana:${DONATE_ADDRESS}${valid ? `?amount=${chosen}&label=Bagscope&message=${encodeURIComponent('Thanks for Bagscope')}` : ''}`

  useEffect(() => {
    void QRCode.toDataURL(link, { margin: 1, width: 520, errorCorrectionLevel: 'M', color: { dark: '#08090b', light: '#ffffff' } }).then(setQr)
  }, [link])

  const copy = (): void => void call('app.copy', DONATE_ADDRESS).then(() => toast('Donation address copied'), () => toast('Could not copy. Select the address and copy it by hand.', true))

  return (
    <>
      <ModalHead title="Support the dev" sub="Bagscope is free. If it saves you time or a rug, a tip in SOL keeps it going. Completely optional." onClose={() => setModal(null)} />
      <div className="row-flex" style={{ gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ padding: 10, background: '#fff', borderRadius: 16, flex: 'none' }}>
          {qr ? <img src={qr} width={200} height={200} alt="QR code to donate SOL" style={{ display: 'block' }} /> : <div style={{ width: 200, height: 200 }} />}
        </div>
        <div className="col grow" style={{ gap: 12, minWidth: 240 }}>
          <div>
            <div className="label" style={{ marginBottom: 6 }}>Amount</div>
            <div className="row-flex" style={{ flexWrap: 'wrap' }}>
              {DONATE_AMOUNTS.map((a) => (
                <button key={a} className={`chip sm ${!custom.trim() && amount === a ? 'active' : ''}`} aria-pressed={!custom.trim() && amount === a} onClick={() => (setCustom(''), setAmount(a))}>{a} SOL</button>
              ))}
              <button className={`chip sm ${!custom.trim() && amount === null ? 'active' : ''}`} aria-pressed={!custom.trim() && amount === null} onClick={() => (setCustom(''), setAmount(null))}>Any amount</button>
              <input className="input num" style={{ width: 110, height: 26 }} inputMode="decimal" placeholder="Other, in SOL" aria-label="Other amount in SOL" value={custom} onChange={(e) => setCustom(e.target.value)} />
            </div>
            <div className="faint num" style={{ fontSize: 12, marginTop: 6, minHeight: 18 }}>
              {valid ? `${chosen} SOL${sol != null ? ` · about ${fmtUsd(chosen! * sol)} right now` : ''}` : custom.trim() ? 'Enter a number above zero.' : 'You pick the amount in your wallet.'}
            </div>
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.55 }}>
            <b>On your phone:</b> scan the code with Phantom (or your phone camera). The address{valid ? ' and amount are' : ' is'} filled in for you; you approve it in your wallet.
            <br />
            <b>On this PC:</b> copy the address below and send SOL to it from Phantom.
          </div>
        </div>
      </div>
      <div className="card pad row-flex" style={{ background: 'var(--raised)', padding: '10px 12px' }}>
        <Heart size={15} className="accent" style={{ flex: 'none' }} />
        <span className="mono selectable grow" style={{ wordBreak: 'break-all', fontSize: 12.5 }}>{DONATE_ADDRESS}</span>
        <button className="btn sm primary" onClick={copy}><Copy size={13} /> Copy address</button>
        <button className="icon-btn" title="View this address on Solscan" onClick={() => void call('app.openExternal', `https://solscan.io/account/${DONATE_ADDRESS}`)}><ExternalLink size={14} /></button>
      </div>
      <p className="faint" style={{ fontSize: 11.5 }}>
        Bagscope never sends anything itself and never asks for a seed phrase. Solana network only: send SOL, not coins from another chain. Donations are gifts and cannot be refunded by the app.
      </p>
    </>
  )
}

/** Shown on pages that have nothing to work with until a wallet exists. Says why, and offers the way forward. */
export function NoWallets({ what }: { what: string }) {
  const setModal = useStore((s) => s.setModal)
  return (
    <div className="card">
      <Empty icon={<WalletCards size={22} />} title="Add a wallet first">
        <p>{what}</p>
        <div className="row-flex" style={{ marginTop: 6 }}>
          <button className="btn primary" onClick={() => void act(call('wallets.connect'))}>Connect Phantom</button>
          <button className="btn" onClick={() => setModal({ kind: 'wallets' })}>Phone or watch-only</button>
        </div>
      </Empty>
    </div>
  )
}

/** Badge shown wherever a ticker is shared by more than one mint the user holds or watches. */
export function CollisionBadge({ symbol, count }: { symbol: string; count?: number }) {
  const setModal = useStore((s) => s.setModal)
  return (
    <button
      className="badge-warn"
      title={`More than one token uses the ticker ${symbol}. Click to compare.`}
      onClick={(e) => {
        e.stopPropagation()
        setModal({ kind: 'collision', symbol })
      }}
    >
      <TriangleAlert size={11} /> {count ? `${count} same name` : 'same name'}
    </button>
  )
}

interface Candidate {
  mint: string
  symbol: string
  name: string
  icon: string | null
  verified: boolean
  liquidity: number | null
  held: boolean
}

/** Every mint sharing a ticker: the ones in the user's wallets plus exact matches from Jupiter's token list. */
export function CollisionModal({ symbol }: { symbol: string }) {
  const { portfolio, setModal, openToken } = useStore()
  const [remote, setRemote] = useState<SearchHit[] | null>(null)
  const [risk, setRisk] = useState<Record<string, TokenInsight['risk']['level'] | 'error'>>({})
  const [err, setErr] = useState<string | null>(null)
  const key = symbol.trim().toLowerCase()

  useEffect(() => {
    call<SearchHit[]>('token.search', symbol).then(setRemote, (e) => (setErr(e.message), setRemote([])))
  }, [symbol])

  const list = useMemo<Candidate[]>(() => {
    const local = [...portfolio!.holdings, ...portfolio!.watch].filter((h) => h.symbol.trim().toLowerCase() === key)
    const out = new Map<string, Candidate>(local.map((h) => [h.mint, { mint: h.mint, symbol: h.symbol, name: h.name, icon: h.icon, verified: h.verified, liquidity: h.liquidity, held: true }]))
    for (const t of remote ?? []) {
      if (t.symbol.trim().toLowerCase() !== key || out.has(t.mint)) continue
      out.set(t.mint, { mint: t.mint, symbol: t.symbol, name: t.name, icon: t.icon, verified: t.verified, liquidity: t.liquidity, held: false })
    }
    return [...out.values()].sort((a, b) => Number(b.verified) - Number(a.verified) || (b.liquidity ?? 0) - (a.liquidity ?? 0)).slice(0, 8)
  }, [portfolio, remote, key])

  // Risk levels load one by one so a slow source never blocks the list.
  useEffect(() => {
    let live = true
    void (async () => {
      for (const c of list) {
        if (!live || risk[c.mint]) continue
        const level = await call<TokenInsight>('token.insight', c.mint, false).then((i) => i.risk.level, () => 'error' as const)
        if (live) setRisk((r) => ({ ...r, [c.mint]: level }))
      }
    })()
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.map((c) => c.mint).join(',')])

  const tone = (l: string | undefined): string => (l === 'Low' ? 'up' : l === 'High' ? 'down' : l === 'Medium' ? 'warn' : '')
  return (
    <>
      <ModalHead title={`Tokens named ${symbol}`} sub="Anyone can create a token with any ticker. The mint address is the only real identity; compare liquidity and risk before trusting one." onClose={() => setModal(null)} />
      {err && <div className="banner">Could not search Jupiter for more matches: {err}</div>}
      <div>
        {list.map((c) => (
          <div key={c.mint} className="list-row" style={{ cursor: 'pointer' }} tabIndex={0} onClick={() => (setModal(null), openToken(c.mint))} onKeyDown={(e) => e.key === 'Enter' && (setModal(null), openToken(c.mint))}>
            <TokenIcon src={c.icon} mint={c.mint} symbol={c.symbol} size={30} />
            <div className="col grow">
              <span className="row-flex" style={{ gap: 5 }}>
                <b className="truncate">{c.name}</b>
                {c.verified && <BadgeCheck size={13} className="accent" />}
                {c.held && <span className="tag">in your wallets</span>}
              </span>
              <span className="mono faint">{shortAddr(c.mint, 8)}</span>
            </div>
            <div className="col" style={{ alignItems: 'flex-end' }}>
              <b className="num">{fmtCompact(c.liquidity, '$')}</b>
              <span className="faint" style={{ fontSize: 11.5 }}>liquidity</span>
            </div>
            <span className={`pill ${tone(risk[c.mint])}`} style={{ minWidth: 86, justifyContent: 'center' }}>
              {risk[c.mint] === 'error' ? 'risk n/a' : risk[c.mint] ? `${risk[c.mint]} risk` : 'checking…'}
            </span>
          </div>
        ))}
        {!list.length && remote && <p className="muted">No other tokens with this ticker were found.</p>}
      </div>
      <p className="faint" style={{ fontSize: 11.5 }}>Verified = on Jupiter's verified list. Highest liquidity is usually, not always, the original.</p>
    </>
  )
}

export function useCollisions(): Map<string, number> {
  const portfolio = useStore((s) => s.portfolio)
  return useMemo(() => {
    const out = new Map<string, number>()
    if (!portfolio) return out
    for (const [k, v] of tickerCollisions([...portfolio.holdings.filter((h) => !h.excluded || h.price != null), ...portfolio.watch])) out.set(k, v.length)
    return out
  }, [portfolio])
}

/** Content of the always-on-top mini window: live total and 24h move; click to bring back the main window. */
export function MiniView() {
  const { state, portfolio, history } = useStore()
  useEffect(() => {
    document.title = 'Bagscope mini'
  }, [])
  if (!state || !portfolio) return <div className="mini" />
  const total = totalValue(portfolio.holdings, null)
  const d1 = perfOver(portfolio.holdings, null, history, 1)
  return (
    <div className="mini">
      <div className="mini-grip" title="Drag to move"><GripVertical size={14} /></div>
      <button className="mini-main" title="Open Bagscope" onClick={() => void call('window.showMain')}>
        <div className="label">{portfolio.offline ? 'Last known · offline' : 'Total balance'}</div>
        <div className="mini-total num">{portfolio.updatedAt ? <AnimatedNumber value={total} format={(n) => fmtUsd(n)} /> : '—'}</div>
        <div className="row-flex" style={{ gap: 6, fontSize: 12 }}>
          {d1 ? <Delta pct={d1.pct} /> : <span className="faint">24h —</span>}
          <span className="faint">24h · {timeAgo(portfolio.updatedAt)}</span>
        </div>
      </button>
    </div>
  )
}
