import { BadgeCheck, Copy, Eye, QrCode, Smartphone, Trash2 } from 'lucide-react'
import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { totalValue } from '@shared/calc'
import { ModalHead } from '@/components/ui'
import { PALETTE, fmtUsd, shortAddr, timeAgo } from '@/lib/format'
import { act, call, useStore } from '@/lib/store'

export const copy = (text: string, what = 'Address'): void => void act(call('app.copy', text), `${what} copied`)

export function QrModal({ address, label }: { address: string; label: string }) {
  const setModal = useStore((s) => s.setModal)
  const [src, setSrc] = useState('')
  useEffect(() => {
    void QRCode.toDataURL(address, { margin: 1, width: 440, color: { dark: '#08090b', light: '#ffffff' } }).then(setSrc)
  }, [address])
  return (
    <>
      <ModalHead title={label} sub="Scan to receive at this address" onClose={() => setModal(null)} />
      <div style={{ display: 'grid', placeItems: 'center', gap: 14 }}>
        <div style={{ padding: 12, background: '#fff', borderRadius: 18 }}>
          {src ? <img src={src} width={220} height={220} alt="Address QR code" style={{ display: 'block' }} /> : <div style={{ width: 220, height: 220 }} />}
        </div>
        <div className="mono selectable" style={{ wordBreak: 'break-all', textAlign: 'center' }}>{address}</div>
        <button className="btn" onClick={() => copy(address)}>
          <Copy size={14} /> Copy address
        </button>
      </div>
    </>
  )
}

interface PhoneSession {
  deeplink: string
  browseLink: string
  host: string
  addresses: string[]
  expiresAt: number
}

/** QR code that opens Bagscope's connect page inside the Phantom mobile app, over the local network. */
function PhoneConnect({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<PhoneSession | null>(null)
  const [qr, setQr] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [left, setLeft] = useState(0)
  const [alt, setAlt] = useState(false)
  const start = (ip?: string): void => {
    setErr(null)
    call<PhoneSession>('wallets.phoneStart', ip).then(setS, (e) => setErr(e.message))
  }
  // The network listener only exists while this panel is open.
  useEffect(() => {
    start()
    return () => void call('wallets.phoneStop').catch(() => undefined)
  }, [])
  useEffect(() => {
    if (!s) return
    void QRCode.toDataURL(alt ? s.browseLink : s.deeplink, { margin: 1, width: 640, errorCorrectionLevel: 'L', color: { dark: '#08090b', light: '#ffffff' } }).then(setQr)
    const tick = (): void => setLeft(Math.max(0, Math.round((s.expiresAt - Date.now()) / 1000)))
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [s, alt])

  return (
    <div className="card pad" style={{ background: 'var(--raised)' }}>
      <div className="row-flex" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <div className="h2">Connect a wallet on your phone</div>
        <button className="btn sm ghost" onClick={onClose}>Done</button>
      </div>
      {err && (
        <div className="banner error">
          <div className="grow">{err}</div>
          <button className="btn sm" onClick={() => start()}>Retry</button>
        </div>
      )}
      {s && left === 0 && (
        <div className="banner">
          <div className="grow">This code expired.</div>
          <button className="btn sm" onClick={() => start(s.host)}>New code</button>
        </div>
      )}
      {s && left > 0 && (
        <div className="row-flex" style={{ gap: 20, alignItems: 'flex-start' }}>
          <div style={{ padding: 10, background: '#fff', borderRadius: 16, flex: 'none' }}>
            {qr ? <img src={qr} width={210} height={210} alt="QR code to connect Phantom mobile" style={{ display: 'block' }} /> : <div style={{ width: 190, height: 190 }} />}
          </div>
          <div className="col" style={{ gap: 8, fontSize: 13 }}>
            <span><b>1.</b> Put your phone on the same Wi-Fi as this PC.</span>
            <span><b>2.</b> Scan the code with your phone camera. Phantom opens and asks you to connect.</span>
            <span><b>3.</b> Approve. Your phone then shows “Wallet added” and it appears here.</span>
            <span><b>4.</b> For more wallets, switch account in Phantom, then tap “Add another wallet” on your phone.</span>
            <a style={{ fontSize: 12 }} onClick={() => setAlt(!alt)}>{alt ? 'Back to the standard code' : 'Phantom shows no approval screen? Try the alternative code'}</a>
            <span className="faint" style={{ fontSize: 12 }}>
              If Windows asks, allow Bagscope on <b>private networks</b>. The code works for {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} and only for adding wallets.
            </span>
            {s.addresses.length > 1 && (
              <label className="row-flex faint" style={{ fontSize: 12 }}>
                Page not loading? Try another network address
                <select className="select" style={{ width: 150, height: 28 }} value={s.host} onChange={(e) => start(e.target.value)}>
                  {s.addresses.map((a) => <option key={a}>{a}</option>)}
                </select>
              </label>
            )}
          </div>
        </div>
      )}
      {!s && !err && <div className="skeleton" style={{ height: 210 }} />}
    </div>
  )
}

export function WalletsModal() {
  const { state, portfolio, bridge, setModal } = useStore()
  const [addr, setAddr] = useState('')
  const [label, setLabel] = useState('')
  const [confirm, setConfirm] = useState<string | null>(null)
  const [phone, setPhone] = useState(false)
  const wallets = state!.wallets

  return (
    <>
      <ModalHead title="Wallets" sub="Public addresses only. Bagscope never asks for a seed phrase or private key." onClose={() => setModal(null)} />

      <div>
        {wallets.map((w) => {
          const st = portfolio!.wallets.find((x) => x.address === w.address)
          return (
            <div key={w.address} className="list-row">
              <div className="row-flex" style={{ gap: 4 }}>
                {PALETTE.slice(0, 6).map((c) => (
                  <button key={c} className={`swatch ${w.color === c ? 'on' : ''}`} style={{ background: c, width: 14, height: 14, borderWidth: 1.5, display: w.color === c ? 'block' : undefined }} onClick={() => void call('wallets.update', w.address, { color: c })} aria-label={`Colour ${c}`} />
                ))}
              </div>
              <div className="col grow">
                <input className="input" style={{ height: 28, fontWeight: 600, background: 'none', borderColor: 'transparent', padding: '0 6px', marginLeft: -6 }} defaultValue={w.label} maxLength={24} onBlur={(e) => e.target.value.trim() !== w.label && void call('wallets.update', w.address, { label: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
                <span className="mono muted">
                  {shortAddr(w.address, 6)} ·{' '}
                  {w.verified ? <span className="accent"><BadgeCheck size={11} style={{ verticalAlign: -1.5 }} /> Phantom verified</span> : <span><Eye size={11} style={{ verticalAlign: -1.5 }} /> watch-only</span>}
                  {st && !st.ok && <span className="down"> · read failed</span>}
                </span>
              </div>
              <div className="col" style={{ alignItems: 'flex-end' }}>
                <b className="num">{st?.updatedAt ? fmtUsd(totalValue(portfolio!.holdings, w.address)) : '—'}</b>
                <span className="faint" style={{ fontSize: 11.5 }}>{st?.updatedAt ? timeAgo(st.updatedAt) : 'not read yet'}</span>
              </div>
              <button className="icon-btn" title="Copy address" onClick={() => copy(w.address)}><Copy size={15} /></button>
              <button className="icon-btn" title="QR code" onClick={() => setModal({ kind: 'qr', address: w.address, label: w.label })}><QrCode size={15} /></button>
              {confirm === w.address ? (
                <button className="btn sm danger" onClick={() => void act(call('wallets.remove', w.address), 'Wallet removed')}>Remove?</button>
              ) : (
                <button className="icon-btn" title="Remove wallet" onClick={() => setConfirm(w.address)}><Trash2 size={15} /></button>
              )}
            </div>
          )
        })}
        {!wallets.length && <p className="muted" style={{ padding: '8px 0' }}>No wallets yet.</p>}
      </div>

      <div className="card pad" style={{ background: 'var(--raised)' }}>
        <div className="row-flex" style={{ justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div className="h2">Connect with Phantom</div>
            <p className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
              Opens your browser. Approve, then switch account in Phantom to add each wallet.
              {bridge?.status === 'opened' && <span className="accent"> Waiting for Phantom…</span>}
            </p>
          </div>
          <div className="row-flex" style={{ flex: 'none' }}>
            <button className="btn" onClick={() => setPhone(true)} disabled={phone}><Smartphone size={14} /> From phone</button>
            <button className="btn primary" onClick={() => void act(call('wallets.connect'))}>Connect Phantom</button>
          </div>
        </div>
      </div>
      {phone && <PhoneConnect onClose={() => setPhone(false)} />}

      <div>
        <div className="label" style={{ marginBottom: 8 }}>Or watch an address</div>
        <div className="row-flex">
          <input className="input mono grow" placeholder="Solana address" value={addr} onChange={(e) => setAddr(e.target.value)} spellCheck={false} />
          <input className="input" style={{ width: 130 }} placeholder="Label" value={label} maxLength={24} onChange={(e) => setLabel(e.target.value)} />
          <button className="btn" disabled={!addr.trim()} onClick={() => void act(call('wallets.addWatch', addr, label), 'Wallet added').then((ok) => ok !== undefined && (setAddr(''), setLabel('')))}>Add</button>
        </div>
      </div>
    </>
  )
}
