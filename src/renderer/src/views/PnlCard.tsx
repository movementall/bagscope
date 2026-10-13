import { Copy, Download } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ModalHead, Toggle } from '@/components/ui'
import { allTimePnl, buildRows, perfOver } from '@/lib/derive'
import { fmtPct, fmtPrice, fmtSigned, fmtUsd } from '@/lib/format'
import { act, call, useStore } from '@/lib/store'

const W = 1200
const H = 675

interface CardData {
  title: string
  subtitle: string
  headline: string
  positive: boolean
  caption: string
  stats: [string, string][]
}

function draw(canvas: HTMLCanvasElement, d: CardData, accent: string, ink: string): void {
  const c = canvas.getContext('2d')!
  const tone = d.positive ? '#2EE6A0' : '#FF5C7A'
  c.fillStyle = '#08090B'
  c.fillRect(0, 0, W, H)
  const glow = c.createRadialGradient(W * 0.86, H * 0.1, 0, W * 0.86, H * 0.1, 620)
  glow.addColorStop(0, `${tone}40`)
  glow.addColorStop(1, '#08090B00')
  c.fillStyle = glow
  c.fillRect(0, 0, W, H)
  c.strokeStyle = 'rgba(255,255,255,0.08)'
  c.lineWidth = 2
  c.beginPath()
  c.roundRect(20, 20, W - 40, H - 40, 36)
  c.stroke()

  c.fillStyle = accent
  c.beginPath()
  c.roundRect(72, 68, 56, 56, 17)
  c.fill()
  c.fillStyle = ink
  c.font = '700 32px "Space Grotesk Variable", sans-serif'
  c.textAlign = 'center'
  c.fillText('B', 100, 108)
  c.textAlign = 'left'
  c.fillStyle = '#F2F4F7'
  c.font = '650 30px "Space Grotesk Variable", sans-serif'
  c.fillText('Bagscope', 146, 107)

  c.fillStyle = '#8B93A1'
  c.font = '500 30px "Inter Variable", sans-serif'
  c.fillText(d.subtitle, 72, 228)
  c.fillStyle = '#F2F4F7'
  c.font = '600 58px "Space Grotesk Variable", sans-serif'
  c.fillText(d.title, 72, 292)

  c.fillStyle = tone
  c.font = '600 150px "Space Grotesk Variable", sans-serif'
  c.fillText(d.headline, 66, 452)
  c.fillStyle = '#8B93A1'
  c.font = '500 28px "Inter Variable", sans-serif'
  c.fillText(d.caption, 72, 500)

  d.stats.forEach(([k, v], i) => {
    const x = 72 + i * 290
    c.fillStyle = '#5A616E'
    c.font = '600 20px "Inter Variable", sans-serif'
    c.fillText(k.toUpperCase(), x, 572)
    c.fillStyle = '#F2F4F7'
    c.font = '600 34px "Space Grotesk Variable", sans-serif'
    c.fillText(v, x, 614)
  })
  c.fillStyle = '#5A616E'
  c.font = '500 20px "Inter Variable", sans-serif'
  c.textAlign = 'right'
  c.fillText(new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }), W - 72, 107)
}

export function PnlCard({ mint }: { mint: string | null }) {
  const { state, portfolio, history, wallet, setModal } = useStore()
  const s = state!
  const ref = useRef<HTMLCanvasElement>(null)
  const [hideUsd, setHideUsd] = useState(false)

  const data = useMemo<CardData | null>(() => {
    const { rows, total } = buildRows(portfolio!.holdings, wallet, s.tokenMeta, s.lots)
    const usd = (v: string): string => (hideUsd ? '•••' : v)
    if (mint) {
      const r = rows.find((x) => x.h.mint === mint)
      if (!r || r.h.price == null) return null
      const hasBasis = r.upnl != null && r.pos.avgCost != null && r.pos.avgCost > 0
      const pct = hasBasis ? (r.h.price / r.pos.avgCost! - 1) * 100 : r.h.change24h
      if (pct == null) return null
      return {
        title: `$${r.h.symbol}`,
        subtitle: hasBasis ? 'Unrealized PnL' : '24h move',
        headline: fmtPct(pct, Math.abs(pct) >= 100 ? 0 : 1),
        positive: pct >= 0,
        caption: hasBasis ? `${usd(fmtSigned(r.upnl))} on this bag` : 'Add your buys to show PnL vs entry',
        stats: [
          ...(hasBasis ? ([['Avg entry', fmtPrice(r.pos.avgCost)]] as [string, string][]) : []),
          ['Price', fmtPrice(r.h.price)],
          ['Bag', usd(fmtUsd(r.value, 0))],
          ['Size', `${(r.alloc * 100).toFixed(1)}%`]
        ]
      }
    }
    const all = allTimePnl(rows, s.lots, wallet)
    const d1 = perfOver(portfolio!.holdings, wallet, history, 1)
    const useAll = !!all && all.invested > 0
    const pct = useAll ? (all!.pnl / all!.invested) * 100 : d1?.pct
    if (pct == null) return null
    return {
      title: wallet ? (s.wallets.find((w) => w.address === wallet)?.label ?? 'Wallet') : 'My bags',
      subtitle: useAll ? 'PnL on tracked trades' : '24h performance',
      headline: fmtPct(pct, Math.abs(pct) >= 100 ? 0 : 1),
      positive: pct >= 0,
      caption: usd(fmtSigned(useAll ? all!.pnl : (d1?.abs ?? 0))),
      stats: [
        ['Portfolio', usd(fmtUsd(total, 0))],
        ['24h', fmtPct(d1?.pct)],
        ['Top bag', [...rows].sort((a, b) => b.counted - a.counted)[0]?.h.symbol ?? '—'],
        ['Coins', String(rows.filter((r) => !r.h.excluded).length)]
      ]
    }
  }, [mint, portfolio, history, wallet, s, hideUsd])

  useEffect(() => {
    if (!data || !ref.current) return
    const canvas = ref.current
    const ink = getComputedStyle(document.documentElement).getPropertyValue('--accent-ink').trim() || '#04130b'
    void document.fonts.ready.then(() => draw(canvas, data, s.settings.accent, ink))
  }, [data, s.settings.accent])

  const png = (): string => ref.current!.toDataURL('image/png')

  return (
    <>
      <ModalHead title="PnL card" sub="Built from your live numbers. Share it or keep it for the group chat." onClose={() => setModal(null)} />
      {data ? (
        <>
          <canvas ref={ref} width={W} height={H} style={{ width: '100%', borderRadius: 16, border: '1px solid var(--border)' }} />
          <div className="row-flex">
            <Toggle on={hideUsd} onChange={setHideUsd} />
            <span className="muted grow">Hide dollar amounts</span>
            <button className="btn" onClick={() => void act(call('app.copyImage', png()), 'Image copied')}><Copy size={14} /> Copy image</button>
            <button className="btn primary" onClick={() => void act(call<string | null>('app.saveFile', { name: `bagscope-${mint ? data.title.replace('$', '') : 'portfolio'}-pnl.png`, content: png().split(',')[1], base64: true })).then((p) => p && useStore.getState().toast(`Saved ${p}`))}>
              <Download size={14} /> Save PNG
            </button>
          </div>
        </>
      ) : (
        <p className="muted">There is no performance figure to show yet. Wait for prices to load, or add your buys so PnL can be calculated.</p>
      )}
    </>
  )
}
