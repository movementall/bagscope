// Runs in the user's browser (where the Phantom extension lives), served from the
// app's loopback server. Uses the official Solana Wallet Adapter for Phantom.
// It only ever connects and asks for a message signature; it cannot send transactions.
import { WalletReadyState } from '@solana/wallet-adapter-base'
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom'

interface Session {
  type: 'connect'
  message: string
}

// Desktop links carry the session in the hash; phone links use a query so it survives the Phantom deep link.
const token = location.hash.slice(1) || new URLSearchParams(location.search).get('s') || ''
const $ = (id: string): HTMLElement => document.getElementById(id)!
const title = $('title')
const text = $('text')
const extra = $('extra')
const action = $('action') as HTMLButtonElement
const adapter = new PhantomWalletAdapter()
const added: string[] = []

const toB64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes))
const short = (a: string): string => `${a.slice(0, 4)}…${a.slice(-4)}`

async function api<T>(path: string, body?: Record<string, string>): Promise<T> {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ s: token, ...body }) } : undefined)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`)
  return data as T
}

function show(t: string, body: string, button: string | null, onClick?: () => void): void {
  title.textContent = t
  text.textContent = body
  action.style.display = button ? '' : 'none'
  if (button) {
    action.textContent = button
    action.disabled = false
    action.onclick = onClick ?? null
  }
}

function fail(e: unknown): void {
  const message = e instanceof Error ? e.message : String(e)
  extra.innerHTML = ''
  const box = document.createElement('div')
  box.className = 'box err'
  box.textContent = message
  extra.append(box)
  void api('/api/error', { message }).catch(() => undefined)
}

function renderAdded(): void {
  extra.innerHTML = ''
  if (!added.length) return
  const ul = document.createElement('ul')
  for (const a of added) {
    const li = document.createElement('li')
    li.innerHTML = `<span>${short(a)}</span><span class="ok">added</span>`
    ul.append(li)
  }
  extra.append(ul)
}

async function addCurrent(session: Session): Promise<void> {
  action.disabled = true
  try {
    if (!adapter.connected) await adapter.connect()
    const publicKey = adapter.publicKey!.toBase58()
    if (added.includes(publicKey)) {
      return show('Already added', 'Switch to another account in Phantom to add it, or close this tab.', 'Add current account', () => void addCurrent(session))
    }
    const signature = await adapter.signMessage(new TextEncoder().encode(session.message))
    await api('/api/connect', { publicKey, signature: toB64(signature) })
    added.push(publicKey)
    renderAdded()
    show('Wallet added', 'To add another wallet, switch account in Phantom and press the button again. Otherwise you can close this tab.', 'Add current account', () => void addCurrent(session))
  } catch (e) {
    fail(e)
    action.disabled = false
  }
}

async function main(): Promise<void> {
  let session: Session
  try {
    session = await api<Session>(`/api/session?s=${encodeURIComponent(token)}`)
  } catch (e) {
    show('Link expired', e instanceof Error ? e.message : String(e), null)
    return
  }
  const ready = (): void => {
    if (adapter.readyState === WalletReadyState.Loadable) {
      // A phone browser without the wallet: the adapter hands this page over to the Phantom app.
      show('Open in Phantom', 'This page needs to open inside the Phantom app to reach your wallet.', 'Open in Phantom', () => void adapter.connect().catch(fail))
      return
    }
    if (adapter.readyState !== WalletReadyState.Installed) {
      show('Phantom not found', 'Open this page in the browser where the Phantom extension is installed, then reload.', 'Get Phantom', () => window.open('https://phantom.app/download', '_blank', 'noreferrer'))
      return
    }
    show('Add a Phantom wallet', 'Phantom will ask you to connect and sign a short message proving you own the address. No transaction, no fees.', 'Connect Phantom', () => void addCurrent(session))
  }
  adapter.on('readyStateChange', ready)
  // The extension injects asynchronously; give it a moment before reporting it missing.
  setTimeout(ready, adapter.readyState === WalletReadyState.Installed ? 0 : 1200)
}

void main()
