import { AnimatePresence, motion } from 'motion/react'
import { Search, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { cls, fmtPct } from '@/lib/format'

export const EASE = [0.2, 0.8, 0.2, 1] as const

/** Tweens to each new value so balance changes read as movement, not a jump. */
export function AnimatedNumber({ value, format, duration = 700 }: { value: number; format: (n: number) => ReactNode; duration?: number }) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    const start = performance.now()
    const a = from.current
    if (a === value) return
    let raf = 0
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - (1 - t) ** 4
      const v = a + (value - a) * eased
      from.current = v
      setShown(v)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration])
  return <>{format(shown)}</>
}

export function Delta({ pct, pill, digits }: { pct: number | null | undefined; pill?: boolean; digits?: number }) {
  return <span className={`num ${pill ? 'pill ' : ''}${cls(pct)}`}>{fmtPct(pct, digits)}</span>
}

/** Image URLs that already failed this session, so they are not requested again on every render. */
const deadIcons = new Set<string>()
const IPFS_HOST = /ipfs|nftstorage|pinata|w3s\.link|dweb\.link/i

/**
 * Where to look for a token's picture, best bet first. Many meme coins point their
 * metadata at IPFS gateways that are rate limited or gone, so DexScreener's image CDN
 * (keyed by mint) and a second IPFS gateway are tried as well.
 */
function iconCandidates(src: string | null, mint?: string): string[] {
  const out: string[] = []
  let url = src?.trim() ?? ''
  if (url.startsWith('ipfs://')) url = `https://ipfs.io/ipfs/${url.slice(7).replace(/^ipfs\//, '')}`
  else if (url.startsWith('http://')) url = `https://${url.slice(7)}`
  const dex = mint ? `https://dd.dexscreener.com/ds-data/tokens/solana/${mint}.png` : null
  const viaIpfs = IPFS_HOST.test(url)
  if (url.startsWith('https://') && !viaIpfs) out.push(url)
  if (dex) out.push(dex)
  if (url.startsWith('https://') && viaIpfs) {
    out.push(url)
    const cid = /\/ipfs\/([A-Za-z0-9]{40,})/.exec(url)?.[1] ?? /^https:\/\/([a-z0-9]{40,})\.ipfs\./i.exec(url)?.[1]
    if (cid) out.push(`https://dweb.link/ipfs/${cid}`)
  }
  return out.filter((u) => !deadIcons.has(u))
}

export function TokenIcon({ src, mint, symbol, size = 34 }: { src: string | null; mint?: string; symbol: string; size?: number }) {
  const [, bump] = useState(0)
  const style = { width: size, height: size, fontSize: size * 0.38 }
  const url = iconCandidates(src, mint)[0]
  if (!url) {
    return (
      <div className="token-icon" style={style}>
        {symbol.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?'}
      </div>
    )
  }
  return (
    <img
      key={url}
      className="token-icon"
      style={style}
      src={url}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => {
        deadIcons.add(url)
        bump((n) => n + 1)
      }}
    />
  )
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: readonly T[] | { value: T; label: string }[]; onChange: (v: T) => void }) {
  const id = useId()
  const opts = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o))
  return (
    <div className="seg">
      {opts.map((o) => (
        <button key={o.value} className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.value === value && <motion.div layoutId={id} className="seg-pill" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  )
}

export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const id = useId()
  return (
    <div className="tabs">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
          {o.value === value && <motion.div layoutId={id} className="tab-line" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />}
        </button>
      ))}
    </div>
  )
}

export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return <button className={`toggle ${on ? 'on' : ''}`} role="switch" aria-checked={on} onClick={() => onChange(!on)} />
}

export function SearchInput({ value, onChange, placeholder, autoFocus, id }: { value: string; onChange: (v: string) => void; placeholder: string; autoFocus?: boolean; id?: string }) {
  return (
    <div className="search">
      <Search size={15} />
      <input id={id} className="input" value={value} placeholder={placeholder} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
    </div>
  )
}

export function Modal({ open, onClose, children, wide, className = '' }: { open: boolean; onClose: () => void; children: ReactNode; wide?: boolean; className?: string }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} onClick={onClose} />
          <div className="modal-wrap">
            <motion.div
              className={`modal ${wide ? 'wide' : ''} ${className}`}
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 6 }}
              transition={{ duration: 0.22, ease: EASE }}
            >
              {children}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )
}

export function ModalHead({ title, sub, onClose }: { title: string; sub?: string; onClose: () => void }) {
  return (
    <div className="row-flex" style={{ alignItems: 'flex-start' }}>
      <div className="grow">
        <div className="h1" style={{ fontSize: 19 }}>{title}</div>
        {sub && <p className="muted" style={{ marginTop: 3 }}>{sub}</p>}
      </div>
      <button className="icon-btn" onClick={onClose} aria-label="Close">
        <X size={17} />
      </button>
    </div>
  )
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <motion.div className="empty" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}>
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {children}
    </motion.div>
  )
}

export function Page({ title, sub, actions, children }: { title: string; sub?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="h1">{title}</h1>
          {sub && <p className="muted" style={{ marginTop: 3 }}>{sub}</p>}
        </div>
        <div className="row-flex">{actions}</div>
      </div>
      {children}
    </div>
  )
}

/** Loads async data for a view, exposing loading and a readable error rather than stale or made-up values. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [s, set] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true })
  const [n, setN] = useState(0)
  useEffect(() => {
    let live = true
    set((p) => ({ ...p, loading: true, error: null }))
    fn().then(
      (data) => live && set({ data, error: null, loading: false }),
      (e) => live && set({ data: null, error: e instanceof Error ? e.message : String(e), loading: false })
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n])
  return { ...s, reload: () => setN((x) => x + 1) }
}

export function useNow(ms = 10_000): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}
