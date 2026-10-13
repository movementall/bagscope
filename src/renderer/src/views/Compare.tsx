import { Scale } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { BenchSeries } from '@shared/types'
import { CompareChart, type CompareLine } from '@/components/Chart'
import { Segmented, useAsync } from '@/components/ui'
import { RANGE_OPTIONS, estimatedSeries, type Range } from '@/lib/derive'
import { fmtPct } from '@/lib/format'
import { act, call, useStore } from '@/lib/store'

const OPTIONS: { id: string; label: string; color: string; hint: string }[] = [
  { id: 'sol', label: 'SOL', color: '#9B7BFF', hint: 'Just holding SOL' },
  { id: 'btc', label: 'Bitcoin', color: '#FF8A3D', hint: 'Bitcoin, via wrapped BTC on Solana' },
  { id: 'eth', label: 'Ethereum', color: '#5B8CFF', hint: 'Ether, via wrapped ETH on Solana' },
  { id: 'meme', label: 'Meme index', color: '#FF4D9D', hint: 'Equal-weight basket: BONK, WIF, TRUMP, PENGU, Fartcoin, POPCAT, PNUT, MEW' },
  { id: 'spx', label: 'S&P 500', color: '#3DE0FF', hint: 'Followed through SPYx, a tokenised S&P 500 fund on Solana' },
  { id: 'ndx', label: 'Nasdaq 100', color: '#FFD23D', hint: 'Followed through QQQx, a tokenised Nasdaq 100 fund on Solana' },
  { id: 'gold', label: 'Gold', color: '#C9A227', hint: 'Followed through GLDx, a tokenised gold fund on Solana' }
]
const SECONDS: Record<Range, number> = { '1D': 86400, '7D': 7 * 86400, '30D': 30 * 86400, '90D': 90 * 86400, '180D': 180 * 86400, '1Y': 365 * 86400 }
const NAME: Record<Range, string> = { '1D': '1 day', '7D': '7 days', '30D': '30 days', '90D': '90 days', '180D': '6 months', '1Y': '1 year' }

/** Rebases a price series to percent change since the window start, anchored on the last price before it. */
function rebase(points: [number, number][], startMs: number): [number, number][] {
  let base: number | null = null
  for (const p of points) {
    if (p[0] > startMs) break
    base = p[1]
  }
  const inside = points.filter((p) => p[0] >= startMs)
  if (base == null) base = inside[0]?.[1] ?? null
  if (base == null || base <= 0 || !inside.length) return []
  const out: [number, number][] = [[startMs, 0], ...inside.map((p) => [p[0], (p[1] / base! - 1) * 100] as [number, number])]
  // Markets that are closed right now still run to the present at their last price.
  const last = out[out.length - 1]
  if (Date.now() - last[0] > 60_000) out.push([Date.now(), last[1]])
  return out
}

/** Your holdings against simple alternatives over the same period, all starting from 0%. */
export function Compare() {
  const { state, portfolio, history, wallet } = useStore()
  const [range, setRange] = useState<Range>('30D')
  const picked = state!.settings.benchmarks.filter((id) => OPTIONS.some((o) => o.id === id))
  const key = picked.join(',')
  const bench = useAsync(() => (picked.length ? call<BenchSeries[]>('bench.series', picked, range) : Promise.resolve([] as BenchSeries[])), [key, range])
  const mine = useMemo(() => estimatedSeries(portfolio!.holdings, wallet, history, range), [portfolio, wallet, history, range])

  const startMs = Date.now() - SECONDS[range] * 1000
  const accent = state!.settings.accent
  const lines = useMemo<CompareLine[]>(() => {
    const out: CompareLine[] = []
    const me = rebase(mine.points, mine.points[0]?.[0] ?? startMs)
    if (me.length > 1) out.push({ id: 'me', label: 'Your bags', color: accent, points: me, strong: true })
    for (const s of bench.data ?? []) {
      const o = OPTIONS.find((x) => x.id === s.id)
      const pts = rebase(s.points, startMs)
      if (o && pts.length > 1) out.push({ id: s.id, label: o.label, color: o.color, points: pts })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine, bench.data, accent, range])

  const final = (l: CompareLine | undefined): number | null => (l ? l.points[l.points.length - 1][1] : null)
  const me = lines.find((l) => l.id === 'me')
  const myPct = final(me)
  const others = lines.filter((l) => l.id !== 'me')
  const beaten = myPct == null ? 0 : others.filter((l) => myPct > final(l)!).length
  const failed = (bench.data ?? []).filter((s) => s.error)
  const toggle = (id: string): void => void act(call('settings.set', { benchmarks: picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id] }))

  return (
    <section className="card pad">
      <div className="section-title" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="row-flex"><Scale size={16} className="accent" /><div className="h2">Performance vs benchmarks</div></div>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>
            {myPct == null
              ? 'Would you have done better just holding something else?'
              : others.length
                ? `Your bags ${fmtPct(myPct)} over ${NAME[range]}: ahead of ${beaten} of ${others.length} benchmark${others.length > 1 ? 's' : ''}.`
                : `Your bags ${fmtPct(myPct)} over ${NAME[range]}. Pick something to compare against.`}
          </p>
        </div>
        <Segmented value={range} options={RANGE_OPTIONS} onChange={setRange} />
      </div>

      <div className="row-flex" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
        {OPTIONS.map((o) => {
          const on = picked.includes(o.id)
          const line = lines.find((l) => l.id === o.id)
          return (
            <button key={o.id} className={`chip sm ${on ? 'active' : ''}`} aria-pressed={on} title={o.hint} onClick={() => toggle(o.id)}>
              <span className="dot" style={{ background: on ? o.color : 'var(--border-strong)' }} />
              {o.label}
              {on && line && <span className={`num ${final(line)! >= 0 ? 'up' : 'down'}`}>{fmtPct(final(line))}</span>}
            </button>
          )
        })}
      </div>

      {lines.length ? (
        <CompareChart lines={lines} />
      ) : bench.loading || (!mine.points.length && Object.keys(history).length === 0) ? (
        <div className="skeleton" style={{ height: 280 }} />
      ) : (
        <div className="chart-empty" style={{ height: 160 }}>Nothing to draw for this range yet. Price history for your holdings is still loading, or none of them existed that long ago. Try a shorter range.</div>
      )}

      {bench.error && <div className="banner error" style={{ marginTop: 10 }}><div className="grow">Benchmarks could not be loaded: {bench.error}</div><button className="btn sm" onClick={bench.reload}>Retry</button></div>}
      {failed.length > 0 && (
        <div className="banner" style={{ marginTop: 10 }}>
          <div className="grow">No data for {failed.map((f) => OPTIONS.find((o) => o.id === f.id)?.label).join(', ')} in this range ({failed[0].error}). They are left out rather than estimated.</div>
        </div>
      )}
      <p className="faint" style={{ fontSize: 11.5, marginTop: 10, lineHeight: 1.5 }}>
        {me
          ? `“Your bags” is today’s holdings valued at past prices (price history covers ${(mine.coverage * 100).toFixed(0)}% of value), so it ignores buys, sells and deposits during the period. `
          : 'Your own line appears once price history for your holdings has loaded. '}
        Benchmarks are price only, with no fees or dividends, all priced by Jupiter. The S&amp;P 500, Nasdaq 100 and gold lines follow tokenised funds on Solana, which trade around the clock and can drift slightly from the real index.
      </p>
    </section>
  )
}
