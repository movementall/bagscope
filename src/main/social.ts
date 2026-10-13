// X (official API, signed in by the user with their own developer app) and Grok
// analysis through the xAI API. Nothing here is shown unless it came from those APIs.

import { createHash, randomBytes } from 'node:crypto'
import { shell } from 'electron'
import { countedValue } from '@shared/calc'
import type { FeedResult, GrokAnalysis, TokenInsight, TrendingItem, XPost } from '@shared/types'
import { notify } from './alerts'
import { HttpError, errMsg, fetchJson } from './http'
import { getPortfolio } from './portfolio'
import { cacheGet, cacheSet, getDb, getSecrets, setSecrets } from './store'

const X_API = 'https://api.x.com/2'
export const X_CALLBACK_PATH = '/x/callback'
let pending: { state: string; verifier: string; redirect: string } | null = null

const b64url = (b: Buffer): string => b.toString('base64url')

// ---------- X login: OAuth 2.0 authorization code + PKCE, in the user's own browser ----------

export function startXLogin(port: number): void {
  const clientId = getSecrets().xClientId
  if (!clientId) throw new Error('Add your X app Client ID in Settings first.')
  const verifier = b64url(randomBytes(48))
  const state = b64url(randomBytes(16))
  const redirect = `http://127.0.0.1:${port}${X_CALLBACK_PATH}`
  pending = { state, verifier, redirect }
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirect,
    scope: 'tweet.read users.read offline.access',
    state,
    code_challenge: b64url(createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256'
  })
  void shell.openExternal(`https://x.com/i/oauth2/authorize?${q}`)
}

interface TokenRes {
  access_token: string
  refresh_token?: string
  expires_in: number
}

export async function finishXLogin(code: string, state: string): Promise<string> {
  if (!pending || state !== pending.state) throw new Error('Login session expired. Start again from Bagscope.')
  const { verifier, redirect } = pending
  pending = null
  const clientId = getSecrets().xClientId!
  const tok = await fetchJson<TokenRes>(`${X_API}/oauth2/token`, {
    method: 'POST',
    form: { grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: redirect, code_verifier: verifier },
    retries: 0
  })
  const me = await fetchJson<{ data: { id: string; username: string } }>(`${X_API}/users/me`, {
    headers: { authorization: `Bearer ${tok.access_token}` }
  })
  setSecrets({
    xTokens: { access: tok.access_token, refresh: tok.refresh_token, expiresAt: Date.now() + tok.expires_in * 1000, username: me.data.username, userId: me.data.id }
  })
  return me.data.username
}

export function xLogout(): void {
  setSecrets({ xTokens: undefined })
}

async function xToken(): Promise<string> {
  const { xTokens, xClientId } = getSecrets()
  if (!xTokens) throw new Error('Connect your X account in Settings to load posts.')
  if (Date.now() < xTokens.expiresAt - 60_000) return xTokens.access
  if (!xTokens.refresh || !xClientId) throw new Error('Your X session expired. Sign in again in Settings.')
  try {
    const tok = await fetchJson<TokenRes>(`${X_API}/oauth2/token`, {
      method: 'POST',
      form: { grant_type: 'refresh_token', refresh_token: xTokens.refresh, client_id: xClientId },
      retries: 0
    })
    setSecrets({ xTokens: { ...xTokens, access: tok.access_token, refresh: tok.refresh_token ?? xTokens.refresh, expiresAt: Date.now() + tok.expires_in * 1000 } })
    return tok.access_token
  } catch {
    throw new Error('Your X session expired. Sign in again in Settings.')
  }
}

async function xGet<T>(path: string): Promise<T> {
  try {
    return await fetchJson<T>(`${X_API}${path}`, { headers: { authorization: `Bearer ${await xToken()}` }, retries: 0 })
  } catch (e) {
    if (e instanceof HttpError) {
      let detail = ''
      try {
        const j = JSON.parse(e.body)
        detail = j.detail ?? j.title ?? j.errors?.[0]?.message ?? ''
      } catch {
        /* non-JSON error body */
      }
      if (e.status === 429) throw new Error('X rate limit reached. Try again in a few minutes.')
      throw new Error(`X API error ${e.status}${detail ? `: ${detail}` : ''}`)
    }
    throw e
  }
}

const term = (symbol: string, mint: string): string =>
  /^[A-Za-z]{2,12}$/.test(symbol) ? `("$${symbol}" OR "${mint}")` : `("${symbol.replace(/"/g, '')}" OR "${mint}")`

interface XSearchRes {
  data?: { id: string; text: string; created_at: string; author_id: string; public_metrics: { like_count: number; retweet_count: number; reply_count: number; impression_count?: number } }[]
  includes?: { users?: { id: string; name: string; username: string; profile_image_url?: string; verified?: boolean; public_metrics?: { followers_count: number } }[] }
  meta?: { newest_id?: string }
}

function toPosts(res: XSearchRes): XPost[] {
  const users = new Map((res.includes?.users ?? []).map((u) => [u.id, u]))
  return (res.data ?? []).map((t) => {
    const u = users.get(t.author_id)
    return {
      id: t.id,
      text: t.text,
      createdAt: Date.parse(t.created_at),
      author: {
        name: u?.name ?? 'Unknown',
        username: u?.username ?? 'unknown',
        avatar: u?.profile_image_url ?? null,
        verified: !!u?.verified,
        followers: u?.public_metrics?.followers_count ?? null
      },
      metrics: { likes: t.public_metrics.like_count, reposts: t.public_metrics.retweet_count, replies: t.public_metrics.reply_count, views: t.public_metrics.impression_count ?? null },
      url: `https://x.com/${u?.username ?? 'i'}/status/${t.id}`
    }
  })
}

const FIELDS = 'tweet.fields=created_at,public_metrics,author_id&expansions=author_id&user.fields=name,username,profile_image_url,verified,public_metrics'

export async function alphaFeed(mint: string, symbol: string, force = false): Promise<FeedResult> {
  const key = `x:feed:${mint}`
  const hit = cacheGet<FeedResult>(key, 180_000)
  if (hit && !force) return hit
  const q = encodeURIComponent(`${term(symbol, mint)} -is:retweet -is:reply lang:en`)
  const res = await xGet<XSearchRes>(`/tweets/search/recent?query=${q}&max_results=30&sort_order=relevancy&${FIELDS}`)
  const out: FeedResult = { posts: toPosts(res), fetchedAt: Date.now(), source: 'api' }
  cacheSet(key, out)
  return out
}

/** Post volume over the last 24h for the largest holdings: real counts from X, not estimates. */
export async function trending(force = false): Promise<{ items: TrendingItem[]; fetchedAt: number }> {
  const hit = cacheGet<{ items: TrendingItem[]; fetchedAt: number }>('x:trending', 15 * 60_000)
  if (hit && !force) return hit
  const top = getPortfolio()
    .holdings.filter((h) => !h.excluded)
    .sort((a, b) => countedValue(b, null) - countedValue(a, null))
    .slice(0, 8)
  const items: TrendingItem[] = []
  for (const h of top) {
    const res = await xGet<{ data?: { tweet_count: number }[] }>(`/tweets/counts/recent?query=${encodeURIComponent(term(h.symbol, h.mint))}&granularity=hour`)
    const buckets = res.data ?? []
    items.push({ mint: h.mint, symbol: h.symbol, posts24h: buckets.slice(-24).reduce((s, b) => s + b.tweet_count, 0) })
  }
  const out = { items: items.sort((a, b) => b.posts24h - a.posts24h), fetchedAt: Date.now() }
  cacheSet('x:trending', out)
  return out
}

/** Checks tracked accounts for new posts that mention held or watched coins. */
export async function pollKols(): Promise<XPost[]> {
  const { kols } = getDb()
  if (!kols.length || !getSecrets().xTokens) return []
  const p = getPortfolio()
  const coins = [...p.holdings.filter((h) => !h.excluded), ...p.watch].filter((h) => /^[A-Za-z]{2,12}$/.test(h.symbol)).slice(0, 20)
  if (!coins.length) return []
  const tickers = coins.map((c) => `"$${c.symbol}"`).join(' OR ')
  const found: XPost[] = []
  for (let i = 0; i < kols.length; i += 8) {
    const from = kols.slice(i, i + 8).map((k) => `from:${k}`).join(' OR ')
    const key = `x:kol:since:${i}`
    const since = cacheGet<string>(key)
    const q = encodeURIComponent(`(${from}) (${tickers}) -is:retweet`)
    const res = await xGet<XSearchRes>(`/tweets/search/recent?query=${q}&max_results=20&${FIELDS}${since ? `&since_id=${since}` : ''}`)
    if (res.meta?.newest_id) cacheSet(key, res.meta.newest_id)
    // The first poll only sets the baseline, so old posts are not announced as new.
    if (since) found.push(...toPosts(res))
  }
  for (const post of found.slice(0, 5)) {
    notify({ title: `@${post.author.username} posted about your coins`, body: post.text.slice(0, 180), kind: 'kol', url: post.url })
  }
  const feed = [...found, ...(cacheGet<XPost[]>('x:kol:feed') ?? [])].slice(0, 60)
  if (found.length) cacheSet('x:kol:feed', feed)
  return feed
}

export const kolFeed = (): XPost[] => cacheGet<XPost[]>('x:kol:feed') ?? []

// ---------- Grok (xAI API) ----------
const XAI = 'https://api.x.ai/v1'

function xaiKey(): string {
  const key = getSecrets().xaiKey
  if (!key) throw new Error('Add your xAI API key in Settings to use Grok.')
  return key
}

export async function grokModels(): Promise<string[]> {
  const res = await fetchJson<{ data: { id: string }[] }>(`${XAI}/models`, { headers: { authorization: `Bearer ${xaiKey()}` }, retries: 0 })
  return res.data.map((m) => m.id).filter((id) => !/image|imagine|video|embed/.test(id)).sort()
}

interface ResponsesRes {
  output?: { type: string; content?: { type: string; text?: string; annotations?: { type: string; url?: string }[] }[] }[]
  citations?: string[]
}

export async function askGrok(i: TokenInsight, force = false): Promise<GrokAnalysis> {
  const key = `grok:${i.mint}`
  const hit = cacheGet<GrokAnalysis>(key, 6 * 3600_000)
  if (hit && !force) return hit
  const model = getDb().settings.grokModel
  const n = (v: number | null, pre = '', suf = ''): string => (v == null ? 'unknown' : `${pre}${v.toLocaleString('en-US', { maximumSignificantDigits: 4 })}${suf}`)
  const facts = [
    `Token: ${i.name} ($${i.symbol}) on Solana, mint ${i.mint}`,
    `Price ${n(i.price, '$')}, 24h change ${n(i.change.h24, '', '%')}, 24h volume ${n(i.volume24h, '$')}`,
    `Market cap ${n(i.mcap, '$')}, liquidity ${n(i.liquidity, '$')}, holders ${n(i.holders)}`,
    `Top 10 holders ${n(i.top10Pct, '', '%')}, LP locked ${n(i.lpLockedPct, '', '%')}, mint authority ${i.mintAuthority == null ? 'unknown' : i.mintAuthority ? 'enabled' : 'revoked'}`
  ].join('\n')
  const input = [
    {
      role: 'system',
      content:
        'You are a sharp, sceptical crypto analyst inside a portfolio app. Use the on-chain figures given to you as ground truth and never invent prices, volumes or engagement numbers. Search X for what people are saying right now. Answer in plain text with short sections: Narrative, What X is saying, Risks, Bottom line. Under 220 words. End with exactly one line: "SENTIMENT: <bullish|bearish|neutral> SCORE: <integer -100..100>". This is not financial advice.'
    },
    { role: 'user', content: `${facts}\n\nAnalyse this token and the current sentiment around it on X.` }
  ]
  const call = (tools: unknown[] | null): Promise<ResponsesRes> =>
    fetchJson<ResponsesRes>(`${XAI}/responses`, {
      method: 'POST',
      headers: { authorization: `Bearer ${xaiKey()}` },
      body: { model, input, ...(tools ? { tools } : {}) },
      timeoutMs: 120_000,
      retries: 0
    })
  let res: ResponsesRes
  let liveSearch = true
  try {
    res = await call([{ type: 'x_search' }, { type: 'web_search' }])
  } catch (e) {
    if (!(e instanceof HttpError) || e.status === 401 || e.status === 403 || e.status === 429) throw grokError(e)
    // Model without tool support: still answer, but say it could not search X.
    liveSearch = false
    res = await call(null).catch((e2) => {
      throw grokError(e2)
    })
  }
  const parts = (res.output ?? []).filter((o) => o.type === 'message').flatMap((o) => o.content ?? []).filter((c) => c.type === 'output_text')
  let text = parts.map((c) => c.text ?? '').join('\n').trim()
  if (!text) throw new Error('Grok returned an empty answer.')
  const citations = [...new Set([...(res.citations ?? []), ...parts.flatMap((c) => (c.annotations ?? []).map((a) => a.url ?? ''))])].filter((u) => /^https:\/\//.test(u))
  const m = text.match(/SENTIMENT:\s*(bullish|bearish|neutral)\s*SCORE:\s*(-?\d+)/i)
  text = text.replace(/\n?SENTIMENT:.*$/is, '').trim()
  const out: GrokAnalysis = {
    mint: i.mint,
    text,
    sentiment: m ? (m[1].toLowerCase() as GrokAnalysis['sentiment']) : null,
    sentimentScore: m ? Math.max(-100, Math.min(100, Number(m[2]))) : null,
    citations: citations.slice(0, 12),
    liveSearch,
    model,
    fetchedAt: Date.now()
  }
  cacheSet(key, out)
  return out
}

export const cachedGrok = (mint: string): GrokAnalysis | null => cacheGet<GrokAnalysis>(`grok:${mint}`)

function grokError(e: unknown): Error {
  if (e instanceof HttpError) {
    let detail = ''
    try {
      const j = JSON.parse(e.body)
      detail = j.error?.message ?? j.error ?? j.message ?? ''
    } catch {
      /* non-JSON error body */
    }
    if (e.status === 401 || e.status === 403) return new Error('xAI rejected the API key. Check it in Settings.')
    return new Error(`Grok error ${e.status}${detail ? `: ${String(detail).slice(0, 200)}` : ''}`)
  }
  return new Error(`Grok request failed: ${errMsg(e)}`)
}
