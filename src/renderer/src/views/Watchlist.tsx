import { BadgeCheck, Plus, Star, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Delta, Empty, Page, SearchInput, TokenIcon } from '@/components/ui'
import { fmtCompact, fmtPrice } from '@/lib/format'
import { act, call, useStore } from '@/lib/store'

export interface SearchHit {
  mint: string
  symbol: string
  name: string
  icon: string | null
  verified: boolean
  price: number | null
  liquidity: number | null
  decimals: number
}

/** Debounced Jupiter token search by name, ticker or mint address. */
export function useTokenSearch(q: string): { hits: SearchHit[]; loading: boolean; error: string | null } {
  const [s, set] = useState<{ hits: SearchHit[]; loading: boolean; error: string | null }>({ hits: [], loading: false, error: null })
  useEffect(() => {
    const query = q.trim()
    if (query.length < 2) return set({ hits: [], loading: false, error: null })
    let live = true
    set((p) => ({ ...p, loading: true }))
    const t = setTimeout(() => {
      call<SearchHit[]>('token.search', query).then(
        (hits) => live && set({ hits, loading: false, error: null }),
        (e) => live && set({ hits: [], loading: false, error: e.message })
      )
    }, 350)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [q])
  return s
}

export function Watchlist() {
  const { state, portfolio, openToken } = useStore()
  const [q, setQ] = useState('')
  const search = useTokenSearch(q)
  const list = state!.watchlist
  const byMint = new Map([...portfolio!.holdings, ...portfolio!.watch].map((h) => [h.mint, h]))

  return (
    <Page title="Watchlist" sub="Coins you are stalking but not holding. Priced with the same sources as your bags.">
      <section className="card pad">
        <SearchInput value={q} onChange={setQ} placeholder="Search by name, ticker or paste a mint address" />
        {search.error && <div className="banner error" style={{ marginTop: 10 }}>{search.error}</div>}
        {search.loading && !search.hits.length && <div className="skeleton" style={{ height: 44, marginTop: 10 }} />}
        {search.hits.map((t) => {
          const on = list.includes(t.mint)
          return (
            <div key={t.mint} className="list-row">
              <TokenIcon src={t.icon} mint={t.mint} symbol={t.symbol} size={30} />
              <div className="col grow" style={{ cursor: 'pointer' }} onClick={() => openToken(t.mint)}>
                <span className="row-flex" style={{ gap: 5 }}><b>{t.symbol}</b>{t.verified && <BadgeCheck size={13} className="accent" />}<span className="muted truncate">{t.name}</span></span>
                <span className="faint mono">{t.mint.slice(0, 10)}… · liquidity {fmtCompact(t.liquidity, '$')}</span>
              </div>
              <span className="num">{fmtPrice(t.price)}</span>
              <button className={`btn sm ${on ? '' : 'primary'}`} onClick={() => void act(call('watch.toggle', t.mint), on ? 'Removed' : `Watching ${t.symbol}`)}>
                {on ? 'Watching' : <><Plus size={13} /> Watch</>}
              </button>
            </div>
          )
        })}
      </section>

      <section className="card">
        {list.length ? (
          <div className="table">
            <div className="thead" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 32px' }}>
              <span>Token</span><span className="r">Price</span><span className="r">24h</span><span className="r">Liquidity</span><span className="r">Market cap</span><span />
            </div>
            {list.map((mint) => {
              const h = byMint.get(mint)
              return (
                <div key={mint} className="trow" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 32px' }} onClick={() => openToken(mint)}>
                  <div className="row-flex" style={{ minWidth: 0 }}>
                    <TokenIcon src={h?.icon ?? null} mint={mint} symbol={h?.symbol ?? '?'} size={30} />
                    <div className="col" style={{ minWidth: 0 }}><b className="truncate">{h?.symbol ?? `${mint.slice(0, 6)}…`}</b><span className="muted truncate" style={{ fontSize: 12 }}>{h?.name ?? 'Loading on next refresh…'}</span></div>
                    {h?.excluded && <span className="pill warn">{h.excluded === 'no-price' ? 'no price' : 'thin pool'}</span>}
                  </div>
                  <span className="r num">{fmtPrice(h?.price)}</span>
                  <span className="r"><Delta pct={h?.change24h} /></span>
                  <span className="r num muted">{fmtCompact(h?.liquidity, '$')}</span>
                  <span className="r num muted">{fmtCompact(h?.mcap, '$')}</span>
                  <button className="icon-btn row-actions" title="Remove" onClick={(e) => { e.stopPropagation(); void act(call('watch.toggle', mint)) }}><Trash2 size={14} /></button>
                </div>
              )
            })}
          </div>
        ) : (
          <Empty icon={<Star size={22} />} title="Nothing on the radar"><p>Search above to add a coin. You can also star any token from its detail panel.</p></Empty>
        )}
      </section>
    </Page>
  )
}
