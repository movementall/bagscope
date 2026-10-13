import { Notification, shell } from 'electron'
import type { AlertRule, Notif, Portfolio } from '@shared/types'
import { bestPairs, getWhaleTrades } from './market'
import { cacheGet, cacheSet, emit, getDb, uid, update } from './store'

const COOLDOWN = 60 * 60_000
/** Alerts that watch a level (price or market cap) and fire once when it is crossed. */
const LEVEL_KINDS = new Set<AlertRule['kind']>(['price-above', 'price-below', 'mcap-above', 'mcap-below'])
const big = (n: number): string => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(0)}`)
let lastSlowCheck = 0

export function notify(n: Omit<Notif, 'id' | 'ts' | 'read'>): void {
  const notif: Notif = { ...n, id: uid(), ts: Date.now(), read: false }
  update((d) => {
    d.notifications.unshift(notif)
    d.notifications.length = Math.min(d.notifications.length, 200)
  })
  emit({ type: 'notif', notif })
  if (getDb().settings.notifications && Notification.isSupported()) {
    const toast = new Notification({ title: n.title, body: n.body })
    if (n.url) toast.on('click', () => void shell.openExternal(n.url!))
    toast.show()
  }
}

const fmt = (p: number): string => (p >= 1 ? p.toFixed(2) : p.toPrecision(4))

function fire(rule: AlertRule, title: string, body: string, url?: string): void {
  notify({ title, body, mint: rule.mint, kind: rule.kind, url })
  update((d) => {
    const r = d.alerts.find((a) => a.id === rule.id)
    if (!r) return
    r.lastFiredAt = Date.now()
    if (!r.repeat && LEVEL_KINDS.has(r.kind)) r.enabled = false
  })
}

export async function checkAlerts(p: Portfolio): Promise<void> {
  const rules = getDb().alerts.filter((a) => a.enabled)
  if (!rules.length) return
  const prices = new Map([...p.holdings, ...p.watch].map((h) => [h.mint, h.price]))
  // Market cap = circulating supply x the same vetted price used everywhere else.
  const mcaps = new Map([...p.holdings, ...p.watch].map((h) => [h.mint, h.mcap]))
  const now = Date.now()

  for (const r of rules) {
    if (r.kind !== 'price-above' && r.kind !== 'price-below') continue
    const price = prices.get(r.mint)
    if (price == null || (r.lastFiredAt && now - r.lastFiredAt < COOLDOWN)) continue
    if (r.kind === 'price-above' ? price >= r.value : price <= r.value) {
      fire(r, `${r.symbol} ${r.kind === 'price-above' ? 'above' : 'below'} $${fmt(r.value)}`, `Now trading at $${fmt(price)}.`)
    }
  }

  for (const r of rules) {
    if (r.kind !== 'mcap-above' && r.kind !== 'mcap-below') continue
    const mcap = mcaps.get(r.mint)
    // No circulating supply known means no market cap; the alert waits rather than guessing.
    if (mcap == null || (r.lastFiredAt && now - r.lastFiredAt < COOLDOWN)) continue
    if (r.kind === 'mcap-above' ? mcap >= r.value : mcap <= r.value) {
      fire(r, `${r.symbol} market cap ${r.kind === 'mcap-above' ? 'above' : 'below'} ${big(r.value)}`, `Now at ${big(mcap)}.`)
    }
  }

  // Pool-level checks hit rate-limited endpoints, so they run at most every two minutes.
  if (now - lastSlowCheck < 120_000) return
  lastSlowCheck = now
  for (const r of rules) {
    try {
      if (r.kind === 'whale') {
        const seenKey = `whale:${r.id}`
        const since = Math.max(r.createdAt, cacheGet<number>(seenKey) ?? 0)
        const fresh = (await getWhaleTrades(r.mint, r.value)).filter((t) => t.ts > since).sort((a, b) => b.usd - a.usd)
        if (!fresh.length) continue
        cacheSet(seenKey, Math.max(...fresh.map((t) => t.ts)))
        const top = fresh[0]
        const more = fresh.length > 1 ? ` (+${fresh.length - 1} more over $${Math.round(r.value).toLocaleString()})` : ''
        fire(r, `Whale ${top.kind} on ${r.symbol}`, `$${Math.round(top.usd).toLocaleString()} ${top.kind}${more}.`, `https://solscan.io/tx/${top.tx}`)
      } else if (r.kind === 'liquidity-drop') {
        const pair = (await bestPairs([r.mint], 30_000)).get(r.mint)
        const liq = pair?.liquidity?.usd
        if (liq == null) continue
        const key = `liq:${r.id}`
        const base = cacheGet<number>(key)
        if (base == null || liq > base) cacheSet(key, liq)
        else if (liq <= base * (1 - r.value / 100)) {
          cacheSet(key, liq)
          fire(r, `Liquidity pulled on ${r.symbol}`, `Main pool liquidity fell ${(100 * (1 - liq / base)).toFixed(0)}% to $${Math.round(liq).toLocaleString()}.`, pair?.url)
        }
      }
    } catch {
      // A failed check is retried on the next cycle; alerts never fire on missing data.
    }
  }
}
