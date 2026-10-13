// Phantom is a browser extension, so wallet approval happens in the user's own
// browser. This loopback-only server hosts a small Wallet Adapter page there and
// receives the public key and an ownership signature. Private keys
// and seed phrases never leave Phantom and are never seen by this app.

import { createPublicKey, randomBytes, verify } from 'node:crypto'
import { createReadStream, existsSync, statSync } from 'node:fs'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { shell } from 'electron'
import { connectLink, lanAddresses, newPhoneKeys, phoneCallback, type PhoneSession } from './phone'
import { X_CALLBACK_PATH, finishXLogin } from './social'
import { errMsg } from './http'
import { refresh } from './portfolio'
import { base58Decode, isValidAddress } from './solana'
import { emit, getDb, update } from './store'

const PREFERRED_PORT = 47821 // fixed so it can be registered as the X OAuth callback
const TTL = 15 * 60_000
const WALLET_COLORS = ['#3DFFA2', '#FF4D9D', '#3DE0FF', '#FF8A3D', '#9B7BFF', '#FFD23D']

interface Session {
  type: 'connect'
  nonce: string
  message: string
  at: number
  phone?: boolean
}

const sessions = new Map<string, Session>()
let port = 0
const root = join(__dirname, '../renderer')
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' }

export const bridgePort = (): number => port

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function page(res: ServerResponse, title: string, text: string): void {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  const esc = (s: string): string => s.replace(/[<>&]/g, (c) => `&#${c.charCodeAt(0)};`)
  res.end(`<!doctype html><meta charset="utf-8"><title>Bagscope</title><body style="background:#08090B;color:#F2F4F7;font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h2>${esc(title)}</h2><p style="color:#8B93A1">${esc(text)}</p></div>`)
}

async function readBody(req: IncomingMessage): Promise<Record<string, string>> {
  let data = ''
  for await (const part of req) {
    data += part
    if (data.length > 200_000) throw new Error('Request too large')
  }
  return JSON.parse(data)
}

function session(token: string | null | undefined): Session | null {
  const s = token ? sessions.get(token) : null
  if (!s || Date.now() - s.at > TTL) return null
  return s
}

/**
 * `self` is the exact host:port this listener serves. `lanOnly` marks the temporary
 * phone listener, which may only serve the connect page for its own phone session.
 */
async function handle(req: IncomingMessage, res: ServerResponse, self: string, lanOnly: boolean): Promise<void> {
  // Reject anything not addressed to this exact origin (blocks DNS-rebinding and cross-site posts).
  if (req.headers.host !== self) return json(res, 403, { error: 'forbidden' })
  const allowed = (s: Session): boolean => !lanOnly || !!s.phone
  const url = new URL(req.url ?? '/', `http://${self}`)

  if (req.method === 'POST') {
    if (req.headers.origin !== `http://${self}`) return json(res, 403, { error: 'forbidden' })
    const body = await readBody(req)
    const s = session(body.s)
    if (!s || !allowed(s)) return json(res, 410, { error: 'This link expired. Start again from Bagscope.' })

    if (url.pathname === '/api/connect') {
      const { publicKey, signature } = body
      if (!isValidAddress(publicKey)) return json(res, 400, { error: 'Invalid public key.' })
      const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(base58Decode(publicKey)).toString('base64url') }, format: 'jwk' })
      if (!verify(null, Buffer.from(s.message), key, Buffer.from(signature, 'base64'))) return json(res, 400, { error: 'Signature did not verify.' })
      const existing = getDb().wallets.find((w) => w.address === publicKey)
      update((d) => {
        const w = d.wallets.find((x) => x.address === publicKey)
        if (w) w.verified = true
        else d.wallets.push({ address: publicKey, label: `Wallet ${d.wallets.length + 1}`, color: WALLET_COLORS[d.wallets.length % WALLET_COLORS.length], verified: true, addedAt: Date.now() })
      })
      emit({ type: 'bridge', status: 'connected', detail: publicKey })
      void refresh()
      return json(res, 200, { ok: true, already: !!existing })
    }

    if (url.pathname === '/api/error') {
      emit({ type: 'bridge', status: 'error', detail: String(body.message ?? 'Cancelled').slice(0, 300) })
      return json(res, 200, { ok: true })
    }
    return json(res, 404, { error: 'not found' })
  }

  if (url.pathname === '/api/session') {
    const s = session(url.searchParams.get('s'))
    if (!s || !allowed(s)) return json(res, 410, { error: 'This link expired. Start again from Bagscope.' })
    return json(res, 200, { type: 'connect', message: s.message })
  }

  // X sign-in returns here. Loopback listener only; the phone listener never serves it.
  if (!lanOnly && url.pathname === X_CALLBACK_PATH) {
    const err = url.searchParams.get('error')
    if (err) return page(res, 'X login cancelled', err)
    try {
      const user = await finishXLogin(url.searchParams.get('code') ?? '', url.searchParams.get('state') ?? '')
      return page(res, `Signed in as @${user}`, 'You can close this tab and return to Bagscope.')
    } catch (e) {
      return page(res, 'X login failed', errMsg(e))
    }
  }

  if (lanOnly && url.pathname.startsWith('/p/')) return phoneCallback(phone, url, res)

  // Static files for the bridge page only.
  const rel = normalize(url.pathname).replace(/^([/\\])+/, '')
  const file = join(root, rel)
  const servable = rel === 'bridge.html' || rel.startsWith(`assets${process.platform === 'win32' ? '\\' : '/'}`)
  if (!servable || !file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404)
    return void res.end('Not found')
  }
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff'
  })
  createReadStream(file).pipe(res)
}

export function startBridge(): Promise<number> {
  const listen = (p: number): Promise<number> =>
    new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        handle(req, res, `127.0.0.1:${port}`, false).catch((e) => json(res, 500, { error: errMsg(e) }))
      })
      server.once('error', reject)
      server.listen(p, '127.0.0.1', () => resolve((server.address() as { port: number }).port))
    })
  return listen(PREFERRED_PORT)
    .catch(() => listen(0))
    .then((p) => (port = p))
}

function open(token: string): void {
  for (const [k, s] of sessions) if (Date.now() - s.at > TTL) sessions.delete(k)
  if (!existsSync(join(root, 'bridge.html'))) throw new Error('Bridge page is missing from this build. Run "npm run build" first.')
  void shell.openExternal(`http://127.0.0.1:${port}/bridge.html#${token}`)
  emit({ type: 'bridge', status: 'opened' })
}

function connectSession(phone: boolean): string {
  const token = randomBytes(24).toString('hex')
  const nonce = randomBytes(12).toString('hex')
  sessions.set(token, {
    type: 'connect',
    nonce,
    phone,
    at: Date.now(),
    message: `Bagscope wants to add this wallet (read-only).\n\nSigning proves you own the address. This is not a transaction and costs nothing.\n\nNonce: ${nonce}`
  })
  return token
}

export function openConnect(): void {
  open(connectSession(false))
}

// ---------- connect from a phone on the same network ----------
// A second listener is bound to this PC's local-network address only while the QR code
// is on screen, and it serves nothing except that one connect session (see phone.ts).

let phone: (PhoneSession & { server: http.Server; timer: NodeJS.Timeout }) | null = null

export function stopPhoneConnect(): void {
  if (!phone) return
  clearTimeout(phone.timer)
  sessions.delete(phone.token)
  phone.server.close()
  phone.server.closeAllConnections()
  phone = null
}

export async function startPhoneConnect(preferred?: string): Promise<{ deeplink: string; browseLink: string; host: string; addresses: string[]; expiresAt: number }> {
  stopPhoneConnect()
  if (!existsSync(join(root, 'bridge.html'))) throw new Error('Bridge page is missing from this build. Run "npm run build" first.')
  const addresses = lanAddresses()
  if (!addresses.length) throw new Error('No local network found. Connect this PC to the same Wi-Fi as your phone and try again.')
  const host = preferred && addresses.includes(preferred) ? preferred : addresses[0]
  const token = connectSession(true)
  let self = ''
  const server = http.createServer((req, res) => {
    handle(req, res, self, true).catch((e) => json(res, 500, { error: errMsg(e) }))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, host, resolve)
  })
  self = `${host}:${(server.address() as { port: number }).port}`
  phone = { server, token, self, timer: setTimeout(stopPhoneConnect, TTL), keys: newPhoneKeys(), wallets: new Map() }
  // Alternative route: the connect page inside Phantom's in-app browser.
  const pageUrl = `http://${self}/bridge.html?s=${token}`
  const browseLink = `https://phantom.app/ul/browse/${encodeURIComponent(pageUrl)}?ref=${encodeURIComponent(`http://${self}`)}`
  return { deeplink: connectLink(phone), browseLink, host, addresses, expiresAt: Date.now() + TTL }
}
