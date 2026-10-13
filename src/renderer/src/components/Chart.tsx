import { motion } from 'motion/react'
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { EASE } from './ui'

interface Props {
  /** [timestamp ms, value] ascending */
  points: [number, number][]
  height?: number
  format: (v: number) => string
  /** message shown instead of a chart when there is nothing real to draw */
  empty?: ReactNode
  loading?: boolean
  /** mouse wheel zooms, drag pans, double-click resets */
  zoomable?: boolean
  onHover?: (p: [number, number] | null) => void
}

const MIN_SPAN = 8

const fmtTime = (ts: number, span: number): string =>
  new Date(ts).toLocaleString(undefined, span < 2 * 86400_000 ? { hour: '2-digit', minute: '2-digit' } : { month: 'short', day: 'numeric', ...(span < 10 * 86400_000 ? { hour: '2-digit' } : {}) })

/** Area chart with a draw-in animation, hover crosshair and optional zoom/pan. Colour follows direction over the visible range. */
export function AreaChart({ points, height = 220, format, empty, loading, zoomable, onHover }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  const [hover, setHover] = useState<number | null>(null)
  /** visible index window into `points`; null shows everything */
  const [win, setWin] = useState<[number, number] | null>(null)
  const drag = useRef<{ x: number; win: [number, number] } | null>(null)
  const id = useId()
  const n = points.length
  // Identity of the dataset: a new range or token resets zoom and replays the draw-in.
  const dataKey = `${n}:${points[0]?.[0] ?? 0}`

  useEffect(() => {
    setWin(null)
    setHover(null)
  }, [dataKey])

  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(120, e.contentRect.width)))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])

  // Wheel must be a non-passive native listener so the page does not scroll while zooming.
  useEffect(() => {
    const el = ref.current
    if (!el || !zoomable || n < MIN_SPAN + 2) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const f = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
      setWin((cur) => {
        const [a, b] = cur ?? [0, n - 1]
        const span = b - a
        const next = Math.min(n - 1, Math.max(MIN_SPAN, span * (e.deltaY > 0 ? 1.25 : 0.8)))
        if (next >= n - 1) return null
        let na = a + f * span - f * next
        na = Math.min(Math.max(0, na), n - 1 - next)
        return [na, na + next]
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomable, n])

  const view = useMemo(() => (win ? points.slice(Math.floor(win[0]), Math.ceil(win[1]) + 1) : points), [points, win])

  const geo = useMemo(() => {
    if (view.length < 2) return null
    const pad = 10
    const [x0, x1] = [view[0][0], view[view.length - 1][0]]
    let y0 = Infinity
    let y1 = -Infinity
    for (const p of view) {
      if (p[1] < y0) y0 = p[1]
      if (p[1] > y1) y1 = p[1]
    }
    if (y1 - y0 < y1 * 1e-6) {
      y0 -= Math.abs(y0) * 0.01 || 1
      y1 += Math.abs(y1) * 0.01 || 1
    }
    const sx = (x: number): number => ((x - x0) / (x1 - x0 || 1)) * width
    const sy = (y: number): number => pad + (1 - (y - y0) / (y1 - y0)) * (height - pad * 2)
    const xy = view.map((p) => [sx(p[0]), sy(p[1])] as const)
    const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('')
    return { xy, line, area: `${line}L${width},${height}L0,${height}Z`, up: view[view.length - 1][1] >= view[0][1], span: x1 - x0, lo: y0, hi: y1 }
  }, [view, width, height])

  if (!geo) {
    return (
      <div ref={ref} className="chart chart-empty" style={{ height }}>
        {loading ? <div className="skeleton" style={{ width: '100%', height: height - 24 }} /> : empty}
      </div>
    )
  }

  const color = geo.up ? 'var(--up)' : 'var(--down)'
  const hp = hover == null || hover >= geo.xy.length ? null : geo.xy[hover]
  const clear = (): void => {
    drag.current = null
    setHover(null)
    onHover?.(null)
  }
  const move = (e: React.MouseEvent): void => {
    const rect = ref.current!.getBoundingClientRect()
    if (drag.current && e.buttons === 1) {
      const [a, b] = drag.current.win
      const span = b - a
      const na = Math.min(Math.max(0, a - ((e.clientX - drag.current.x) / rect.width) * span), n - 1 - span)
      setWin([na, na + span])
      if (hover != null) setHover(null)
      return
    }
    const x = e.clientX - rect.left
    // Points are evenly spread enough that a proportional guess plus a short walk finds the nearest one.
    let best = Math.min(geo.xy.length - 1, Math.max(0, Math.round((x / rect.width) * (geo.xy.length - 1))))
    while (best > 0 && Math.abs(geo.xy[best - 1][0] - x) < Math.abs(geo.xy[best][0] - x)) best--
    while (best < geo.xy.length - 1 && Math.abs(geo.xy[best + 1][0] - x) < Math.abs(geo.xy[best][0] - x)) best++
    if (best !== hover) {
      setHover(best)
      onHover?.(view[best])
    }
  }

  return (
    <div
      ref={ref}
      className="chart"
      style={{ height, cursor: zoomable ? (win ? 'grab' : 'crosshair') : undefined }}
      onMouseMove={move}
      onMouseLeave={clear}
      onMouseDown={(e) => {
        if (zoomable && win) drag.current = { x: e.clientX, win }
      }}
      onMouseUp={() => (drag.current = null)}
      onDoubleClick={() => zoomable && setWin(null)}
    >
      <svg height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={`${id}g`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.26" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <motion.path key={`a${dataKey}`} d={geo.area} fill={`url(#${id}g)`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35, delay: 0.15 }} />
        <motion.path
          key={`l${dataKey}`}
          d={geo.line}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.45, ease: EASE }}
        />
        {hp && (
          <>
            <line x1={hp[0]} x2={hp[0]} y1={0} y2={height} stroke="var(--border-strong)" strokeDasharray="3 4" />
            <circle cx={hp[0]} cy={hp[1]} r={4.5} fill={color} stroke="var(--surface)" strokeWidth={2} />
          </>
        )}
      </svg>
      {zoomable && (
        <>
          <span className="chart-axis num" style={{ top: 2 }}>{format(geo.hi)}</span>
          <span className="chart-axis num" style={{ bottom: 2 }}>{format(geo.lo)}</span>
        </>
      )}
      {win && (
        <button className="btn sm chart-reset" onClick={() => setWin(null)}>
          Reset zoom
        </button>
      )}
      {hp && hover != null && (
        <div className="chart-tip num" style={{ left: Math.min(Math.max(hp[0], 70), width - 70) }}>
          <b>{format(view[hover][1])}</b> <span className="muted">· {fmtTime(view[hover][0], geo.span)}</span>
        </div>
      )}
    </div>
  )
}

export interface CompareLine {
  id: string
  label: string
  color: string
  /** [timestamp ms, percent change since the start of the range] ascending */
  points: [number, number][]
  strong?: boolean
}

const pctText = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(Math.abs(v) >= 100 ? 0 : 2)}%`

/** Several performance lines on one percentage axis, all starting at 0%. Hover reads every line at that moment. */
export function CompareChart({ lines, height = 280 }: { lines: CompareLine[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(700)
  const [hoverX, setHoverX] = useState<number | null>(null)

  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(160, e.contentRect.width)))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])

  const geo = useMemo(() => {
    const drawn = lines.filter((l) => l.points.length >= 2)
    if (!drawn.length) return null
    let [x0, x1, y0, y1] = [Infinity, -Infinity, 0, 0]
    for (const l of drawn) {
      for (const [t, v] of l.points) {
        if (t < x0) x0 = t
        if (t > x1) x1 = t
        if (v < y0) y0 = v
        if (v > y1) y1 = v
      }
    }
    const padY = Math.max(0.5, (y1 - y0) * 0.08)
    y0 -= padY
    y1 += padY
    const sx = (t: number): number => ((t - x0) / (x1 - x0 || 1)) * width
    const sy = (v: number): number => 8 + (1 - (v - y0) / (y1 - y0)) * (height - 16)
    return {
      x0,
      x1,
      sx,
      sy,
      zero: sy(0),
      paths: drawn.map((l) => ({ line: l, d: l.points.map(([t, v], i) => `${i ? 'L' : 'M'}${sx(t).toFixed(1)},${sy(v).toFixed(1)}`).join('') })),
      top: y1,
      bottom: y0
    }
  }, [lines, width, height])

  if (!geo) return <div ref={ref} className="chart chart-empty" style={{ height }}><div className="skeleton" style={{ width: '100%', height: height - 24 }} /></div>

  const hoverT = hoverX == null ? null : geo.x0 + (hoverX / width) * (geo.x1 - geo.x0)
  const at = (l: CompareLine, t: number): number | null => {
    let v: number | null = null
    for (const p of l.points) {
      if (p[0] > t) break
      v = p[1]
    }
    return v
  }
  const reads = hoverT == null ? [] : geo.paths.map((p) => ({ line: p.line, v: at(p.line, hoverT) })).filter((r): r is { line: CompareLine; v: number } => r.v != null).sort((a, b) => b.v - a.v)
  const span = geo.x1 - geo.x0

  return (
    <div
      ref={ref}
      className="chart"
      style={{ height, cursor: 'crosshair' }}
      onMouseMove={(e) => setHoverX(Math.min(width, Math.max(0, e.clientX - ref.current!.getBoundingClientRect().left)))}
      onMouseLeave={() => setHoverX(null)}
    >
      <svg height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <line x1={0} x2={width} y1={geo.zero} y2={geo.zero} stroke="var(--border-strong)" strokeDasharray="4 5" />
        {geo.paths.map((p) => (
          <motion.path
            key={`${p.line.id}:${p.line.points.length}:${Math.round(geo.x0 / 60000)}`}
            d={p.d}
            fill="none"
            stroke={p.line.color}
            strokeWidth={p.line.strong ? 2.6 : 1.6}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            initial={{ opacity: 0 }}
            animate={{ opacity: p.line.strong ? 1 : 0.85 }}
            transition={{ duration: 0.42, ease: EASE }}
          />
        ))}
        {hoverX != null && <line x1={hoverX} x2={hoverX} y1={0} y2={height} stroke="var(--border-strong)" strokeDasharray="3 4" />}
        {hoverX != null && reads.map((r) => <circle key={r.line.id} cx={hoverX} cy={geo.sy(r.v)} r={r.line.strong ? 4.5 : 3.5} fill={r.line.color} stroke="var(--surface)" strokeWidth={2} />)}
      </svg>
      <span className="chart-axis num" style={{ top: 2 }}>{pctText(geo.top)}</span>
      <span className="chart-axis num" style={{ bottom: 2 }}>{pctText(geo.bottom)}</span>
      <span className="chart-axis num" style={{ top: Math.min(height - 18, Math.max(20, geo.zero - 8)), right: 'auto', left: 0 }}>0%</span>
      {hoverX != null && hoverT != null && reads.length > 0 && (
        <div className="chart-tip" style={{ left: Math.min(Math.max(hoverX, 96), width - 96), transform: 'translateX(-50%)', top: 6, whiteSpace: 'normal', minWidth: 168 }}>
          <div className="faint" style={{ fontSize: 11, marginBottom: 3 }}>{fmtTime(hoverT, span)}</div>
          {reads.map((r) => (
            <div key={r.line.id} className="row-flex num" style={{ gap: 6, fontSize: 12, fontWeight: r.line.strong ? 700 : 500 }}>
              <span className="dot" style={{ background: r.line.color, width: 7, height: 7 }} />
              <span className="grow">{r.line.label}</span>
              <span className={r.v >= 0 ? 'up' : 'down'}>{pctText(r.v)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}