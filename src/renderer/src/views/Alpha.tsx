import { Flame, RefreshCw, Sparkles, UserPlus, X } from 'lucide-react'
import { useState } from 'react'
import { countedValue } from '@shared/calc'
import type { TrendingItem, XPost } from '@shared/types'
import { PostCard, XGate } from '@/components/Social'
import { Delta, Empty, Page, TokenIcon, useAsync } from '@/components/ui'
import { fmtCompact, timeAgo } from '@/lib/format'
import { act, call, useStore } from '@/lib/store'
import { NoWallets } from './Extras'

export function Alpha() {
  const { state, portfolio, openToken } = useStore()
  const s = state!
  const connected = !!s.secrets.xUser
  const [handle, setHandle] = useState('')
  const [checking, setChecking] = useState(false)
  const trending = useAsync(() => (connected ? call<{ items: TrendingItem[]; fetchedAt: number }>('x.trending', false) : Promise.resolve(null)), [connected])
  const kol = useAsync(() => call<XPost[]>('x.kolFeed'), [connected])
  const top = portfolio!.holdings.filter((h) => !h.excluded).sort((a, b) => countedValue(b, null) - countedValue(a, null)).slice(0, 8)
  const max = Math.max(1, ...(trending.data?.items.map((i) => i.posts24h) ?? [1]))
  const addKol = (): void => void act(call('kols.set', [...s.kols, handle]), 'Now tracking').then(() => setHandle(''))
  const check = (): void => {
    setChecking(true)
    void act(call('x.pollKols')).then(() => (setChecking(false), kol.reload()))
  }

  if (!s.wallets.length) {
    return (
      <Page title="Alpha" sub="What X is saying about the coins you hold.">
        <NoWallets what="Alpha works per coin, so it needs to know which coins you hold." />
      </Page>
    )
  }

  return (
    <Page title="Alpha" sub="What X is saying about the coins you hold.">
      <XGate what="Trending counts and the KOL tracker" />

      <section className="card pad">
        <div className="section-title">
          <div className="row-flex"><Flame size={16} className="accent" /><div className="h2">Trending in your bags</div></div>
          {trending.data && (
            <span className="faint row-flex" style={{ fontSize: 12 }}>
              {timeAgo(trending.data.fetchedAt)}
              <button className="icon-btn" title="Refresh counts" onClick={() => void call('x.trending', true).then(trending.reload, trending.reload)}><RefreshCw size={13} /></button>
            </span>
          )}
        </div>
        {trending.error && <div className="banner error"><div className="grow">{trending.error}</div><button className="btn sm" onClick={trending.reload}>Retry</button></div>}
        {trending.loading && connected && <div className="skeleton" style={{ height: 120 }} />}
        {trending.data?.items.map((t) => (
          <div key={t.mint} className="list-row" style={{ cursor: 'pointer' }} onClick={() => openToken(t.mint, 'alpha')}>
            <b style={{ width: 90 }} className="truncate">${t.symbol}</b>
            <div className="mini-bar grow" style={{ height: 8, margin: 0 }}><div style={{ width: `${(t.posts24h / max) * 100}%` }} /></div>
            <span className="num muted" style={{ width: 130, textAlign: 'right' }}>{fmtCompact(t.posts24h)} posts · 24h</span>
          </div>
        ))}
        {!connected && <p className="muted" style={{ fontSize: 12.5 }}>Post counts for your top holdings appear here once X is connected.</p>}
      </section>

      <section className="card pad">
        <div className="section-title">
          <div className="row-flex"><Sparkles size={16} className="accent" /><div className="h2">Ask Grok about a bag</div></div>
          {!s.secrets.xaiKey && <span className="faint" style={{ fontSize: 12 }}>Needs an xAI key in Settings</span>}
        </div>
        <div className="grid-tokens" style={{ padding: 0, gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
          {top.map((h) => (
            <button key={h.mint} className="tile" style={{ textAlign: 'left', color: 'inherit', font: 'inherit' }} onClick={() => openToken(h.mint, 'alpha')}>
              <div className="row-flex"><TokenIcon src={h.icon} mint={h.mint} symbol={h.symbol} size={26} /><b className="grow truncate">{h.symbol}</b><Delta pct={h.change24h} /></div>
            </button>
          ))}
        </div>
        {!top.length && <p className="muted">Your biggest bags appear here once balances have loaded.</p>}
      </section>

      <section className="card pad">
        <div className="section-title">
          <div>
            <div className="h2">KOL tracker</div>
            <p className="muted" style={{ fontSize: 12.5 }}>Get a notification when these accounts post a ticker you hold or watch. Checked every {s.settings.kolPollMin} minutes.</p>
          </div>
          <button className="btn sm" disabled={!connected || !s.kols.length || checking} onClick={check}><RefreshCw size={13} className={checking ? 'spin' : ''} /> Check now</button>
        </div>
        <div className="row-flex" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
          {s.kols.map((k) => (
            <span key={k} className="chip sm active">
              @{k}
              <button className="icon-btn" style={{ width: 18, height: 18 }} aria-label={`Stop tracking ${k}`} onClick={() => void call('kols.set', s.kols.filter((x) => x !== k))}><X size={12} /></button>
            </span>
          ))}
          <div className="row-flex" style={{ gap: 6 }}>
            <input className="input" style={{ width: 170, height: 28 }} placeholder="@handle" aria-label="X handle to track" value={handle} maxLength={16} onChange={(e) => setHandle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handle.trim() && addKol()} />
            <button className="btn sm" disabled={!handle.trim()} onClick={addKol}><UserPlus size={13} /> Track</button>
          </div>
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          {kol.data?.map((p) => <PostCard key={p.id} post={p} />)}
        </div>
        {kol.data && !kol.data.length && (
          <Empty icon={<UserPlus size={22} />} title={s.kols.length ? 'No mentions yet' : 'Track your first account'}>
            <p>{s.kols.length ? 'New posts from tracked accounts that mention your coins will land here.' : 'Add the handles whose calls you care about.'}</p>
          </Empty>
        )}
      </section>
    </Page>
  )
}
