import { create } from 'zustand'
import type { AppEvent, AppState, Portfolio, PriceHistory } from '@shared/types'

declare global {
  interface Window {
    bagscope: { call: (method: string, ...args: unknown[]) => Promise<unknown>; on: (l: (e: AppEvent) => void) => () => void }
  }
}

export type View = 'dashboard' | 'portfolio' | 'activity' | 'watchlist' | 'alpha' | 'alerts' | 'settings'
export type Modal = null | { kind: 'wallets' } | { kind: 'palette' } | { kind: 'shortcuts' } | { kind: 'pnl'; mint: string | null } | { kind: 'qr'; address: string; label: string } | { kind: 'collision'; symbol: string } | { kind: 'donate' }
export interface Toast {
  id: number
  text: string
  error?: boolean
}

interface Store {
  state: AppState | null
  portfolio: Portfolio | null
  history: Record<string, PriceHistory>
  view: View
  wallet: string | null
  token: string | null
  tokenTab: string
  modal: Modal
  toasts: Toast[]
  bridge: { status: string; detail?: string } | null
  txsync: Record<string, { done: number; total: number; finished: boolean; error?: string }>
  go: (view: View) => void
  setWallet: (w: string | null) => void
  openToken: (mint: string | null, tab?: string) => void
  setModal: (m: Modal) => void
  toast: (text: string, error?: boolean) => void
}

let toastId = 0

export const useStore = create<Store>((set, get) => ({
  state: null,
  portfolio: null,
  history: {},
  view: 'dashboard',
  wallet: null,
  token: null,
  tokenTab: 'overview',
  modal: null,
  toasts: [],
  bridge: null,
  txsync: {},
  go: (view) => set({ view, token: null }),
  setWallet: (wallet) => set({ wallet }),
  openToken: (token, tab = 'overview') => set({ token, tokenTab: tab }),
  setModal: (modal) => set({ modal }),
  toast: (text, error) => {
    const id = ++toastId
    set({ toasts: [...get().toasts.slice(-3), { id, text, error }] })
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), error ? 6500 : 2800)
  }
}))

/** Calls a backend method. Errors come back as readable messages from the main process. */
export async function call<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
  try {
    return (await window.bagscope.call(method, ...args)) as T
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    throw new Error(raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
  }
}

/** Fire-and-toast wrapper for user actions. */
export async function act<T>(p: Promise<T>, success?: string): Promise<T | undefined> {
  try {
    const out = await p
    if (success) useStore.getState().toast(success)
    return out
  } catch (e) {
    useStore.getState().toast(e instanceof Error ? e.message : String(e), true)
    return undefined
  }
}

export async function boot(): Promise<void> {
  window.bagscope.on((e) => {
    const s = useStore.getState()
    if (e.type === 'state') {
      // A removed wallet must not stay selected as the active filter.
      const wallet = s.wallet && e.state.wallets.some((w) => w.address === s.wallet) ? s.wallet : null
      useStore.setState({ state: e.state, wallet })
    } else if (e.type === 'portfolio') useStore.setState({ portfolio: e.portfolio })
    else if (e.type === 'history') useStore.setState({ history: e.history })
    else if (e.type === 'txsync') useStore.setState({ txsync: { ...s.txsync, [e.wallet]: e } })
    else if (e.type === 'notif') s.toast(`${e.notif.title} · ${e.notif.body}`)
    else if (e.type === 'bridge') {
      useStore.setState({ bridge: e })
      if (e.status === 'connected') s.toast('Wallet added')
      if (e.status === 'error') s.toast(e.detail ?? 'Wallet request failed', true)
    }
  })
  const [state, portfolio, history] = await Promise.all([
    call<AppState>('app.state'),
    call<Portfolio>('app.portfolio'),
    call<Record<string, PriceHistory>>('app.history')
  ])
  useStore.setState({ state, portfolio, history })
}
