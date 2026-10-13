// Connect a wallet that lives on a phone, over the local network.
//
// Uses Phantom's mobile deep-link protocol: the QR opens Phantom's own approval screen,
// and Phantom then redirects the phone's browser back to this PC with the public key,
// encrypted to a one-time key. Only public keys and signatures ever reach this app.

import { createPublicKey, randomBytes, verify } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import nacl from 'tweetnacl'
import { errMsg } from './http'
import { refresh } from './portfolio'
import { base58Decode, base58Encode, isValidAddress } from './solana'
import { emit, getDb, update } from './store'

const WALLET_COLORS = ['#3DFFA2', '#FF4D9D', '#3DE0FF', '#FF8A3D', '#9B7BFF', '#FFD23D']

export interface PhoneSession {
  token: string
  /** host:port of the temporary local-network listener */
  self: string
  keys: nacl.BoxKeyPair
  /** per wallet: Phantom session, shared secret, and the message awaiting a signature */
  wallets: Map<string, { session: string; shared: Uint8Array; message?: string }>
}

export const newPhoneKeys = (): nacl.BoxKeyPair => nacl.box.keyPair()

/** This PC's private IPv4 addresses, most likely home/office network first. */
export function lanAddresses(): string[] {
  const found: { address: string; rank: number }[] = []
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family !== 'IPv4' || i.internal) continue
      const privateRank = i.address.startsWith('192.168.') ? 0 : i.address.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(i.address) ? 2 : -1
      if (privateRank < 0) continue
      const virtual = /vEthernet|WSL|VirtualBox|VMware|Hyper-V|Loopback|Bluetooth|Tailscale|ZeroTier/i.test(name)
      found.push({ address: i.address, rank: privateRank + (virtual ? 10 : 0) })
    }
  }
  return found.sort((a, b) => a.rank - b.rank).map((f) => f.address)
}

const phantomLink = (method: string, params: Record<string, string>): string => `https://phantom.app/ul/v1/${method}?${new URLSearchParams(params)}`

export function connectLink(p: PhoneSession): string {
  return phantomLink('connect', {
    app_url: `http://${p.self}`,
    dapp_encryption_public_key: base58Encode(p.keys.publicKey),
    // Session token lives in the path so it survives however Phantom appends its reply.
    redirect_link: `http://${p.self}/p/connected/${p.token}`,
    cluster: 'mainnet-beta'
  })
}

function signLink(p: PhoneSession, publicKey: string): string {
  const w = p.wallets.get(publicKey)!
  w.message = `Bagscope: prove you own this wallet.\n\nThis is not a transaction and costs nothing.\n\nNonce: ${randomBytes(12).toString('hex')}`
  const nonce = nacl.randomBytes(24)
  const body = JSON.stringify({ message: base58Encode(Buffer.from(w.message)), session: w.session, display: 'utf8' })
  return phantomLink('signMessage', {
    dapp_encryption_public_key: base58Encode(p.keys.publicKey),
    nonce: base58Encode(nonce),
    redirect_link: `http://${p.self}/p/signed/${p.token}/${publicKey}`,
    payload: base58Encode(nacl.box.after(Buffer.from(body), nonce, w.shared))
  })
}

function readReply(shared: Uint8Array, q: URLSearchParams): Record<string, string> {
  const opened = nacl.box.open.after(base58Decode(q.get('data') ?? ''), base58Decode(q.get('nonce') ?? ''), shared)
  if (!opened) throw new Error("Could not read Phantom's reply.")
  return JSON.parse(Buffer.from(opened).toString('utf8'))
}

function page(res: ServerResponse, title: string, text: string, links: { label: string; href: string; primary?: boolean }[]): void {
  const esc = (s: string): string => s.replace(/[<>&"]/g, (ch) => `&#${ch.charCodeAt(0)};`)
  const buttons = links
    .map(
      (l) =>
        `<a href="${esc(l.href)}" style="display:block;margin-top:12px;padding:14px;border-radius:12px;text-decoration:none;font-weight:650;${l.primary ? 'background:#3dffa2;color:#04130b' : 'background:#15181c;color:#f2f4f7;border:1px solid rgba(255,255,255,.1)'}">${esc(l.label)}</a>`
    )
    .join('')
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  res.end(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bagscope</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#08090b;color:#f2f4f7;font:16px/1.5 system-ui,sans-serif"><main style="width:min(420px,calc(100vw - 40px));text-align:center"><div style="width:48px;height:48px;border-radius:15px;background:#3dffa2;color:#04130b;font-weight:800;font-size:22px;display:grid;place-items:center;margin:0 auto 18px">B</div><h1 style="font-size:22px;margin:0 0 8px">${esc(title)}</h1><p style="color:#8b93a1;margin:0 0 10px">${esc(text)}</p>${buttons}</main>`
  )
}

/** Handles Phantom's redirects: /p/connected/<token> and /p/signed/<token>/<address>. */
export function phoneCallback(p: PhoneSession | null, url: URL, res: ServerResponse): void {
  const [, , step, token, key] = url.pathname.split('/')
  if (!p || token !== p.token) return page(res, 'Code expired', 'Open "From phone" in Bagscope again and scan the new code.', [])
  const retry = { label: 'Try again', href: connectLink(p), primary: true }
  const another = { label: 'Add another wallet', href: connectLink(p) }
  const q = url.searchParams
  if (q.get('errorCode')) return page(res, 'Phantom declined', q.get('errorMessage') ?? 'The request was rejected in Phantom.', [retry])
  const short = (a: string): string => `${a.slice(0, 4)}…${a.slice(-4)}`
  try {
    if (step === 'connected') {
      const shared = nacl.box.before(base58Decode(q.get('phantom_encryption_public_key') ?? ''), p.keys.secretKey)
      const { public_key: address, session } = readReply(shared, q)
      if (!isValidAddress(address)) throw new Error('Phantom returned an invalid address.')
      p.wallets.set(address, { session, shared })
      const existed = getDb().wallets.some((w) => w.address === address)
      if (!existed) {
        update((d) => void d.wallets.push({ address, label: `Wallet ${d.wallets.length + 1}`, color: WALLET_COLORS[d.wallets.length % WALLET_COLORS.length], verified: false, addedAt: Date.now() }))
      }
      emit({ type: 'bridge', status: 'connected', detail: address })
      void refresh()
      return page(res, existed ? 'Already in Bagscope' : 'Wallet added', `${short(address)} is now tracked on your PC. To add another wallet, switch account in Phantom first, then tap "Add another wallet".`, [
        { label: 'Verify ownership (optional)', href: signLink(p, address), primary: true },
        another
      ])
    }
    if (step === 'signed') {
      const w = p.wallets.get(key ?? '')
      if (!w?.message) throw new Error('Verification session not found. Add the wallet again.')
      const { signature } = readReply(w.shared, q)
      const pub = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(base58Decode(key)).toString('base64url') }, format: 'jwk' })
      if (!verify(null, Buffer.from(w.message), pub, Buffer.from(base58Decode(signature)))) throw new Error('Signature did not verify.')
      update((d) => {
        const x = d.wallets.find((y) => y.address === key)
        if (x) x.verified = true
      })
      return page(res, 'Ownership verified', `${short(key)} is marked as Phantom verified in Bagscope.`, [another])
    }
  } catch (e) {
    return page(res, 'Something went wrong', errMsg(e), [retry])
  }
  res.writeHead(404)
  res.end('Not found')
}
