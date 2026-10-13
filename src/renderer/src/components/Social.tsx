import { BadgeCheck, Eye, Heart, MessageCircle, Repeat2, RefreshCw, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { GrokAnalysis, XPost } from '@shared/types'
import { fmtCompact, timeAgo } from '@/lib/format'
import { call, useStore } from '@/lib/store'
import { useAsync } from './ui'

export const openUrl = (url: string): void => void call('app.openExternal', url).catch(() => undefined)

export function PostCard({ post }: { post: XPost }) {
  return (
    <div className="post" onClick={() => openUrl(post.url)}>
      <div className="row-flex">
        {post.author.avatar ? <img src={post.author.avatar} width={30} height={30} style={{ borderRadius: '50%' }} alt="" referrerPolicy="no-referrer" /> : <div className="token-icon" style={{ width: 30, height: 30 }} />}
        <div className="col grow">
          <span className="row-flex" style={{ gap: 4 }}>
            <b className="truncate">{post.author.name}</b>
            {post.author.verified && <BadgeCheck size={13} className="accent" />}
          </span>
          <span className="muted" style={{ fontSize: 12 }}>
            @{post.author.username}
            {post.author.followers != null && ` · ${fmtCompact(post.author.followers)} followers`}
          </span>
        </div>
        <span className="faint" style={{ fontSize: 12 }}>{timeAgo(post.createdAt)}</span>
      </div>
      <div className="post-text selectable">{post.text}</div>
      <div className="post-metrics num">
        <span><Heart size={13} /> {fmtCompact(post.metrics.likes)}</span>
        <span><Repeat2 size={13} /> {fmtCompact(post.metrics.reposts)}</span>
        <span><MessageCircle size={13} /> {fmtCompact(post.metrics.replies)}</span>
        {post.metrics.views != null && <span><Eye size={13} /> {fmtCompact(post.metrics.views)}</span>}
      </div>
    </div>
  )
}

/** Shown wherever X data would be; explains exactly what is missing instead of showing filler. */
export function XGate({ what }: { what: string }) {
  const { state, go } = useStore()
  const sec = state!.secrets
  if (sec.xUser) return null
  return (
    <div className="card pad" style={{ background: 'var(--raised)' }}>
      <b>X is not connected</b>
      <p className="muted" style={{ margin: '4px 0 10px', fontSize: 12.5 }}>
        {what} relies on the official X API, which needs your own X developer app {sec.xClientId ? 'sign-in' : 'Client ID and sign-in'}. Nothing is shown until real posts can be loaded.
      </p>
      <button className="btn sm" onClick={() => go('settings')}>Open Settings</button>
    </div>
  )
}

export function SentimentPill({ g }: { g: GrokAnalysis | null }) {
  if (!g?.sentiment) return null
  const c = g.sentiment === 'bullish' ? 'up' : g.sentiment === 'bearish' ? 'down' : ''
  return (
    <span className={`pill ${c}`}>
      {g.sentiment}
      {g.sentimentScore != null && ` ${g.sentimentScore > 0 ? '+' : ''}${g.sentimentScore}`}
    </span>
  )
}

export function GrokPanel({ mint, symbol }: { mint: string; symbol: string }) {
  const { state, go } = useStore()
  const hasKey = state!.secrets.xaiKey
  const cached = useAsync(() => call<GrokAnalysis | null>('grok.cached', mint), [mint])
  // A request only goes out when the user presses the button.
  const [g, setG, busy, setBusy, err, setErr] = useManual<GrokAnalysis>(cached.data)
  const run = (): void => {
    setBusy(true)
    setErr(null)
    call<GrokAnalysis>('grok.ask', mint, true).then(
      (r) => (setG(r), setBusy(false)),
      (e) => (setErr(e.message), setBusy(false))
    )
  }
  return (
    <div className="card pad" style={{ background: 'var(--raised)' }}>
      <div className="section-title" style={{ marginBottom: g || err ? 10 : 0 }}>
        <div className="row-flex">
          <Sparkles size={16} className="accent" />
          <b>Grok on ${symbol}</b>
          <SentimentPill g={g} />
        </div>
        {hasKey ? (
          <button className="btn sm primary" disabled={busy} onClick={run}>
            <RefreshCw size={13} className={busy ? 'spin' : ''} /> {busy ? 'Thinking…' : g ? 'Refresh' : 'Ask Grok'}
          </button>
        ) : (
          <button className="btn sm" onClick={() => go('settings')}>Add xAI key</button>
        )}
      </div>
      {!hasKey && <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>Add your xAI API key in Settings to get a live read on narrative, sentiment and risks.</p>}
      {err && <div className="banner error">{err}</div>}
      {busy && !g && <div className="skeleton" style={{ height: 120 }} />}
      {g && (
        <>
          <div className="selectable" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, opacity: busy ? 0.5 : 1, transition: 'opacity var(--base)' }}>{g.text}</div>
          {g.citations.length > 0 && (
            <div className="row-flex" style={{ flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
              {g.citations.map((u, i) => (
                <a key={u} className="pill" onClick={() => openUrl(u)} title={u}>
                  {i + 1} · {new URL(u).hostname.replace('www.', '')}
                </a>
              ))}
            </div>
          )}
          <div className="faint" style={{ fontSize: 11.5, marginTop: 10 }}>
            {g.model} · {timeAgo(g.fetchedAt)}
            {!g.liveSearch && ' · answered without live X search'} · AI opinion, not financial advice
          </div>
        </>
      )}
    </div>
  )
}

function useManual<T>(initial: T | null): [T | null, (v: T) => void, boolean, (b: boolean) => void, string | null, (e: string | null) => void] {
  const [v, setV] = useState<T | null>(initial)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (initial) setV(initial)
  }, [initial])
  return [v, setV, busy, setBusy, err, setErr]
}
