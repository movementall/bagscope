import { AnimatePresence, Reorder, motion } from 'motion/react'
import { Bell, Flame, Heart, History, LayoutDashboard, Lock, LockOpen, PictureInPicture2, PieChart, RefreshCw, Settings as SettingsIcon, Star, WalletCards, WifiOff, Zap } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { countedValue } from '@shared/calc'
import { EASE, Modal, ModalHead, TokenIcon, useNow } from './components/ui'
import { fmtUsd, inkFor, shortAddr, timeAgo } from './lib/format'
import { act, boot, call, useStore, type View } from './lib/store'
import { Activity } from './views/Activity'
import { Alerts } from './views/Alerts'
import { Alpha } from './views/Alpha'
import { Dashboard } from './views/Dashboard'
import { CollisionModal, DonateModal } from './views/Extras'
import { PnlCard } from './views/PnlCard'
import { Portfolio } from './views/Portfolio'
import { Settings } from './views/Settings'
import { TokenPanel } from './views/TokenPanel'
import { QrModal, WalletsModal } from './views/Wallets'
import { Watchlist } from './views/Watchlist'

const NAV: { view: View; label: string; icon: typeof Bell }[] = [
  { view: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { view: 'portfolio', label: 'Portfolio', icon: PieChart },
  { view: 'activity', label: 'Activity', icon: History },
  { view: 'watchlist', label: 'Watchlist', icon: Star },
  { view: 'alpha', label: 'Alpha', icon: Flame },
  { view: 'alerts', label: 'Alerts', icon: Bell },
  { view: 'settings', label: 'Settings', icon: SettingsIcon }
]

const VIEWS: Record<View, () => React.JSX.Element> = { dashboard: Dashboard, portfolio: Portfolio, activity: Activity, watchlist: Watchlist, alpha: Alpha, alerts: Alerts, settings: Settings }

const SHORTCUTS: [string, string][] = [
  ['Ctrl K', 'Search everything: coins, mint addresses, pages, actions'],
  ['1 – 7', 'Switch page'],
  ['R', 'Refresh balances and prices'],
  ['/', 'Search tokens on the dashboard'],
  ['D', 'Degen mode on / off'],
  ['C', 'Compact / comfortable rows'],
  ['L', 'Read-only lock on / off'],
  ['M', 'Mini view (always on top)'],
  ['H', 'Show or hide small balances'],
  ['T', 'Toggle dark / light'],
  ['W', 'Manage wallets'],
  ['Alt ← →', 'Move the focused wallet chip'],
  ['Alt ↑ ↓', 'Move the focused pinned token'],
  ['Esc', 'Close panel or dialog'],
  ['?', 'This list']
]

const setting = (patch: Record<string, unknown>, done?: string): void => void act(call('settings.set', patch), done)
export const toggleDegen = (): void => {
  const on = !useStore.getState().state?.settings.degenMode
  setting({ degenMode: on }, on ? 'Degen mode on' : 'Degen mode off')
}
export const toggleDensity = (): void => {
  const compact = useStore.getState().state?.settings.density !== 'compact'
  setting({ density: compact ? 'compact' : 'comfortable' }, compact ? 'Compact rows' : 'Comfortable rows')
}
export const toggleLock = (): void => {
  const on = !useStore.getState().state?.settings.readOnly
  setting({ readOnly: on }, on ? 'Read-only mode on' : 'Unlocked')
}
const toggleMini = (): void => void act(call('mini.toggle'))

interface Item {
  key: string
  label: string
  hint: string
  detail?: string
  icon?: { src: string | null; mint: string; symbol: string }
  run: () => void
}

/** Global search: every holding and watched coin by name, ticker or mint, plus pages and actions. */
function Palette() {
  const { state, portfolio, go, openToken, setModal } = useStore()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const items = useMemo<Item[]>(() => {
    const needle = q.trim().toLowerCase()
    const pages: Item[] = NAV.map((n) => ({ key: n.view, label: n.label, hint: 'Page', run: () => go(n.view) }))
    const actions: Item[] = [
      { key: 'refresh', label: 'Refresh now', hint: 'Action', run: () => void act(call('app.refresh')) },
      { key: 'wallets', label: 'Manage wallets', hint: 'Action', run: () => setTimeout(() => setModal({ kind: 'wallets' })) },
      { key: 'degen', label: `Degen mode ${state?.settings.degenMode ? 'off' : 'on'}`, hint: 'Action', run: toggleDegen },
      { key: 'density', label: `Switch to ${state?.settings.density === 'compact' ? 'comfortable' : 'compact'} rows`, hint: 'Action', run: toggleDensity },
      { key: 'lock', label: state?.settings.readOnly ? 'Unlock (leave read-only mode)' : 'Lock (read-only mode)', hint: 'Action', run: toggleLock },
      { key: 'mini', label: 'Toggle mini view', hint: 'Action', run: toggleMini },
      { key: 'donate', label: 'Support the dev (donate SOL)', hint: 'Action', run: () => setTimeout(() => setModal({ kind: 'donate' })) },
      { key: 'theme', label: 'Toggle theme', hint: 'Action', run: () => setting({ theme: state?.settings.theme === 'dark' ? 'light' : 'dark' }) }
    ]
    const held = (portfolio?.holdings ?? []).map((h) => ({ h, value: countedValue(h, null), watch: false }))
    const watched = (portfolio?.watch ?? []).filter((h) => state?.watchlist.includes(h.mint)).map((h) => ({ h, value: 0, watch: true }))
    const coins: Item[] = [...held, ...watched]
      .filter(({ h }) => !needle || h.symbol.toLowerCase().includes(needle) || h.name.toLowerCase().includes(needle) || h.mint.toLowerCase().startsWith(needle))
      .sort((a, b) => {
        // Exact ticker matches first, then by position size.
        const exact = (x: typeof a): number => (needle && x.h.symbol.toLowerCase() === needle ? 1 : 0)
        return exact(b) - exact(a) || b.value - a.value
      })
      .slice(0, 40)
      .map(({ h, value, watch }) => ({
        key: `${watch ? 'w' : 'h'}:${h.mint}`,
        label: `${h.symbol} · ${h.name}`,
        hint: watch ? 'Watchlist' : h.excluded ? 'Not counted' : fmtUsd(value),
        detail: shortAddr(h.mint, 5),
        icon: { src: h.icon, mint: h.mint, symbol: h.symbol },
        run: () => openToken(h.mint)
      }))
    const text = (i: Item): boolean => !needle || i.label.toLowerCase().includes(needle)
    const out = needle ? [...coins, ...pages.filter(text), ...actions.filter(text)] : [...pages, ...actions, ...coins]
    // A pasted mint that is not in any wallet can still be opened directly.
    const raw = q.trim()
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(raw) && !coins.some((c) => c.key.endsWith(raw))) {
      out.unshift({ key: `open:${raw}`, label: `Open token ${shortAddr(raw, 6)}`, hint: 'Mint address', run: () => openToken(raw) })
    }
    return out
  }, [q, portfolio, state, go, openToken, setModal])
  useEffect(() => setSel(0), [q])
  useEffect(() => {
    // Braces matter: scrollIntoView returns a Promise here, which must not be returned as a cleanup.
    void listRef.current?.querySelector('.sel')?.scrollIntoView({ block: 'nearest' })
  }, [sel])
  const run = (i: number): void => {
    setModal(null)
    items[i]?.run()
  }
  return (
    <>
      <input
        autoFocus
        placeholder="Search coins, mint addresses, pages, actions…"
        value={q}
        spellCheck={false}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setSel((s) => Math.min(items.length - 1, s + 1)), e.preventDefault()
          if (e.key === 'ArrowUp') setSel((s) => Math.max(0, s - 1)), e.preventDefault()
          if (e.key === 'Home') setSel(0), e.preventDefault()
          if (e.key === 'End') setSel(items.length - 1), e.preventDefault()
          if (e.key === 'Enter') run(sel)
        }}
      />
      <div className="palette-list" ref={listRef} role="listbox">
        {items.map((it, i) => (
          <div key={it.key} role="option" aria-selected={i === sel} className={`palette-item ${i === sel ? 'sel' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => run(i)}>
            {it.icon && <TokenIcon src={it.icon.src} mint={it.icon.mint} symbol={it.icon.symbol} size={22} />}
            <span className="grow truncate">{it.label}</span>
            {it.detail && <span className="mono faint">{it.detail}</span>}
            <span className="faint num" style={{ fontSize: 11.5, minWidth: 70, textAlign: 'right' }}>{it.hint}</span>
          </div>
        ))}
        {!items.length && <div className="palette-item">Nothing in your wallets or watchlist matches “{q}”.</div>}
      </div>
    </>
  )
}

/** Wallet filter chips. Drag (or Alt + arrow keys) to reorder; the order is saved. */
function WalletChips() {
  const { state, wallet, setWallet } = useStore()
  const wallets = state!.wallets
  const saved = wallets.map((w) => w.address)
  const [order, setOrder] = useState(saved)
  const latest = useRef(order)
  const draggedAt = useRef(0)
  useEffect(() => {
    setOrder(saved)
    latest.current = saved
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved.join(',')])
  const commit = (next: string[]): void => {
    latest.current = next
    setOrder(next)
  }
  const move = (address: string, by: number): void => {
    const i = order.indexOf(address)
    const j = i + by
    if (j < 0 || j >= order.length) return
    const next = [...order]
    next.splice(j, 0, next.splice(i, 1)[0])
    commit(next)
    void call('wallets.reorder', next)
  }
  return (
    <Reorder.Group as="ul" axis="x" className="wallet-chips" values={order} onReorder={commit}>
      {order.map((address) => {
        const w = wallets.find((x) => x.address === address)
        if (!w) return null
        return (
          <Reorder.Item
            as="li"
            key={address}
            value={address}
            whileDrag={{ scale: 1.06 }}
            transition={{ duration: 0.22, ease: EASE }}
            onDragStart={() => (draggedAt.current = Date.now())}
            onDragEnd={() => {
              draggedAt.current = Date.now()
              void call('wallets.reorder', latest.current)
            }}
          >
            <button
              className={`chip sm ${wallet === address ? 'active' : ''}`}
              title={`${address}\nDrag or Alt + ← → to reorder`}
              onClick={() => Date.now() - draggedAt.current > 250 && setWallet(address)}
              onKeyDown={(e) => {
                if (e.altKey && e.key === 'ArrowLeft') move(address, -1), e.preventDefault()
                if (e.altKey && e.key === 'ArrowRight') move(address, 1), e.preventDefault()
              }}
            >
              <span className="dot" style={{ background: w.color }} />
              {w.label}
            </button>
          </Reorder.Item>
        )
      })}
    </Reorder.Group>
  )
}

export function App() {
  const { state, portfolio, view, wallet, modal, toasts, token, go, setWallet, setModal, openToken } = useStore()
  const now = useNow(5000)

  useEffect(() => void boot(), [])

  const theme = state?.settings.theme ?? 'dark'
  const accent = state?.settings.accent ?? '#3DFFA2'
  const density = state?.settings.density ?? 'comfortable'
  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = theme
    root.dataset.density = density
    root.style.setProperty('--accent', accent)
    root.style.setProperty('--accent-ink', inkFor(accent))
    void call('app.theme', theme)
  }, [theme, accent, density])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const s = useStore.getState()
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        return s.setModal(s.modal?.kind === 'palette' ? null : { kind: 'palette' })
      }
      if (e.key === 'Escape') {
        if (s.modal) return s.setModal(null)
        if (s.token) return s.openToken(null)
        return (document.activeElement as HTMLElement | null)?.blur?.()
      }
      const el = e.target as HTMLElement
      if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || s.modal) return
      const k = e.key.toLowerCase()
      if (/^[1-9]$/.test(k) && NAV[Number(k) - 1]) s.go(NAV[Number(k) - 1].view)
      else if (k === 'r') void act(call('app.refresh'))
      else if (k === 'd') toggleDegen()
      else if (k === 'c') toggleDensity()
      else if (k === 'l') toggleLock()
      else if (k === 'm') toggleMini()
      else if (k === 'h') setting({ hideSmall: !s.state?.settings.hideSmall })
      else if (k === 't') setting({ theme: s.state?.settings.theme === 'dark' ? 'light' : 'dark' })
      else if (k === 'w') s.setModal({ kind: 'wallets' })
      else if (k === '?') s.setModal({ kind: 'shortcuts' })
      else if (k === '/') {
        e.preventDefault()
        if (s.view !== 'dashboard') s.go('dashboard')
        setTimeout(() => document.getElementById('token-search')?.focus(), 60)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!state || !portfolio) return <div className="app" />
  const unread = state.notifications.filter((n) => !n.read).length
  const { degenMode, readOnly } = state.settings
  const reading = Object.values(useStore.getState().txsync).filter((x) => !x.finished)
  const Current = VIEWS[view]

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">B</div>
          <div className="brand-name">Bagscope</div>
        </div>
        <nav className="nav">
          {NAV.map((n, i) => (
            <button key={n.view} className={`nav-item ${view === n.view ? 'active' : ''}`} onClick={() => go(n.view)}>
              {view === n.view && <motion.div layoutId="nav-pill" className="nav-pill" transition={{ type: 'spring', stiffness: 480, damping: 38 }} />}
              <n.icon size={16} />
              <span>{n.label}</span>
              {n.view === 'alerts' && unread > 0 ? <span className="badge">{unread}</span> : <span className="kbd">{i + 1}</span>}
            </button>
          ))}
        </nav>
        <button className="nav-item" style={{ marginTop: 'auto' }} onClick={() => setModal({ kind: 'donate' })}>
          <Heart size={16} />
          <span>Support the dev</span>
        </button>
        <div className="statusbar" style={{ marginTop: 8 }}>
          <div className="row-flex">
            <span className={`dot ${portfolio.refreshing ? 'pulse' : ''}`} style={{ background: portfolio.offline ? 'var(--warn)' : portfolio.error ? 'var(--down)' : 'var(--up)' }} />
            <span>{!state.wallets.length ? 'No wallets yet' : portfolio.refreshing ? 'Syncing…' : portfolio.offline ? 'Offline · cached data' : 'Live'}</span>
          </div>
          {state.wallets.length > 0 && <div>Last updated {timeAgo(portfolio.updatedAt, now)}</div>}
          {reading.length > 0 && <div className="pulse" title="Reading your transaction history from chain to fill in entries">Reading history · {reading.reduce((n, x) => n + x.done, 0)} tx</div>}
          <div>
            <a onClick={() => setModal({ kind: 'shortcuts' })}>Shortcuts</a> · Ctrl K
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="titlebar">
          <button className={`chip sm ${wallet === null ? 'active' : ''}`} onClick={() => setWallet(null)}>
            All wallets
          </button>
          <WalletChips />
          <button className="icon-btn" title="Manage wallets (W)" onClick={() => setModal({ kind: 'wallets' })}>
            <WalletCards size={16} />
          </button>
          <div className="spacer" />
          {portfolio.offline && (
            <span className="pill warn">
              <WifiOff size={12} /> Offline
            </span>
          )}
          <button className={`hbtn ${degenMode ? 'on' : ''}`} aria-pressed={degenMode} title="Degen mode: hide dust, rank by 24h volatility (D)" onClick={toggleDegen}>
            <Zap size={14} fill={degenMode ? 'currentColor' : 'none'} /> Degen
          </button>
          <button className={`hbtn ${readOnly ? 'locked' : ''}`} aria-pressed={readOnly} title={readOnly ? 'Read-only mode is on. Click to unlock (L)' : 'Lock: read-only mode (L)'} onClick={toggleLock}>
            {readOnly ? <Lock size={14} /> : <LockOpen size={14} />}
            {readOnly && 'Read-only'}
          </button>
          <button className="icon-btn" title="Mini view, always on top (M)" onClick={toggleMini}>
            <PictureInPicture2 size={15} />
          </button>
          {state.wallets.length > 0 && (
            <span className="faint num" style={{ fontSize: 12 }}>
              Updated {timeAgo(portfolio.updatedAt, now)}
            </span>
          )}
          <button className="icon-btn" title="Refresh (R)" onClick={() => void act(call('app.refresh'))}>
            <RefreshCw size={15} className={portfolio.refreshing ? 'spin' : ''} />
          </button>
        </header>

        <main className="content">
          <AnimatePresence mode="wait">
            <motion.div key={view} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2, ease: EASE }}>
              <Current />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <AnimatePresence>
        {token && (
          <>
            <motion.div key="scrim" className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} onClick={() => openToken(null)} />
            <motion.aside key="drawer" className="drawer" initial={{ x: 60, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 60, opacity: 0 }} transition={{ duration: 0.28, ease: EASE }}>
              <TokenPanel mint={token} key={token} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <Modal open={modal?.kind === 'wallets'} onClose={() => setModal(null)} wide>
        <WalletsModal />
      </Modal>
      <Modal open={modal?.kind === 'qr'} onClose={() => setModal(null)}>
        {modal?.kind === 'qr' && <QrModal address={modal.address} label={modal.label} />}
      </Modal>
      <Modal open={modal?.kind === 'pnl'} onClose={() => setModal(null)} wide>
        {modal?.kind === 'pnl' && <PnlCard mint={modal.mint} />}
      </Modal>
      <Modal open={modal?.kind === 'collision'} onClose={() => setModal(null)} wide>
        {modal?.kind === 'collision' && <CollisionModal symbol={modal.symbol} />}
      </Modal>
      <Modal open={modal?.kind === 'donate'} onClose={() => setModal(null)} wide>
        {modal?.kind === 'donate' && <DonateModal />}
      </Modal>
      <Modal open={modal?.kind === 'palette'} onClose={() => setModal(null)} className="palette" wide>
        <Palette />
      </Modal>
      <Modal open={modal?.kind === 'shortcuts'} onClose={() => setModal(null)}>
        <ModalHead title="Keyboard shortcuts" onClose={() => setModal(null)} />
        <div>
          {SHORTCUTS.map(([k, d]) => (
            <div key={k} className="list-row" style={{ padding: '7px 0' }}>
              <span className="kbd" style={{ margin: 0, minWidth: 64, textAlign: 'center' }}>{k}</span>
              <span>{d}</span>
            </div>
          ))}
        </div>
      </Modal>

      <div className="toasts">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div key={t.id} layout className={`toast ${t.error ? 'error' : ''}`} initial={{ opacity: 0, y: 14, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: 30 }} transition={{ duration: 0.22, ease: EASE }}>
              <span className="dot" style={{ background: t.error ? 'var(--down)' : 'var(--accent)' }} />
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}
