import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppEvent, AppState, SecretsStatus, Settings } from '@shared/types'

type Db = Omit<AppState, 'secrets'> & { deletedAutoLots: string[] }

export interface Secrets {
  rpcUrl?: string
  xaiKey?: string
  xClientId?: string
  xTokens?: { access: string; refresh?: string; expiresAt: number; username: string; userId: string }
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  accent: '#3DFFA2',
  hideSmall: true,
  smallThreshold: 1,
  minLiquidity: 1000,
  excludeOverLiquidity: true,
  refreshSec: 60,
  autoSnapshot: true,
  benchmarks: ['sol', 'btc', 'meme', 'spx'],
  autoHistory: true,
  receivesAsBuys: true,
  grokModel: 'grok-4',
  kolPollMin: 10,
  notifications: true,
  degenMode: false,
  density: 'comfortable',
  readOnly: false,
  lockWithHello: false,
  closeToTray: false,
  startMinimized: false
}

const emptyDb = (): Db => ({
  wallets: [],
  settings: { ...DEFAULT_SETTINGS },
  tokenMeta: {},
  tags: ['Meme', 'High Conviction', 'Degen', 'Moonbag'],
  lots: [],
  watchlist: [],
  alerts: [],
  notifications: [],
  snapshots: [],
  series: [],
  pinOrder: [],
  kols: [],
  deletedAutoLots: []
})

let dir = ''
let db: Db = emptyDb()
let cache: Record<string, { at: number; v: unknown }> = {}
let secrets: Secrets = {}
const timers: Record<string, NodeJS.Timeout> = {}
const listeners = new Set<(e: AppEvent) => void>()

function readJson<T>(file: string, fallback: T): T {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : fallback
  } catch {
    return fallback
  }
}

/** Write to a temp file then rename, so a crash mid-write never corrupts user data. */
function writeAtomic(file: string, data: string | Buffer): void {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, data)
  renameSync(tmp, file)
}

function debounce(key: string, fn: () => void, ms = 400): void {
  clearTimeout(timers[key])
  timers[key] = setTimeout(fn, ms)
}

export function initStore(): void {
  dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  const loaded = readJson<Partial<Db>>(join(dir, 'bagscope.json'), {})
  db = { ...emptyDb(), ...loaded, settings: { ...DEFAULT_SETTINGS, ...(loaded.settings ?? {}) } }
  cache = readJson(join(dir, 'cache.json'), {})
  try {
    const file = join(dir, 'secrets.bin')
    if (existsSync(file) && safeStorage.isEncryptionAvailable()) {
      secrets = JSON.parse(safeStorage.decryptString(readFileSync(file)))
    }
  } catch {
    secrets = {}
  }
}

export function flushStore(): void {
  for (const k of Object.keys(timers)) clearTimeout(timers[k])
  if (!dir) return
  writeAtomic(join(dir, 'bagscope.json'), JSON.stringify(db))
  writeAtomic(join(dir, 'cache.json'), JSON.stringify(cache))
}

export const getDb = (): Db => db

/** Mutate persisted state, save it, and push the new state to the UI. */
export function update(fn: (d: Db) => void): void {
  fn(db)
  debounce('db', () => writeAtomic(join(dir, 'bagscope.json'), JSON.stringify(db)))
  emit({ type: 'state', state: getState() })
}

export function getState(): AppState {
  const { deletedAutoLots: _d, ...rest } = db
  return { ...rest, secrets: secretsStatus() }
}

// ---- cache (last known data for offline mode + API response caching) ----

export function cacheGet<T>(key: string, maxAgeMs = Infinity): T | null {
  const hit = cache[key]
  return hit && Date.now() - hit.at <= maxAgeMs ? (hit.v as T) : null
}
export function cacheAt(key: string): number | null {
  return cache[key]?.at ?? null
}
export function cacheSet(key: string, v: unknown): void {
  cache[key] = { at: Date.now(), v }
  debounce('cache', () => writeAtomic(join(dir, 'cache.json'), JSON.stringify(cache)), 1500)
}

// ---- secrets: encrypted with Windows DPAPI via Electron safeStorage ----

export const getSecrets = (): Secrets => secrets

export function setSecrets(patch: Partial<Secrets>): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Windows secure storage is unavailable, so the key was not saved.')
  }
  secrets = { ...secrets, ...patch }
  for (const k of Object.keys(secrets) as (keyof Secrets)[]) if (!secrets[k]) delete secrets[k]
  writeAtomic(join(dir, 'secrets.bin'), safeStorage.encryptString(JSON.stringify(secrets)))
  emit({ type: 'state', state: getState() })
}

export function secretsStatus(): SecretsStatus {
  let rpcHost: string | null = null
  try {
    if (secrets.rpcUrl) rpcHost = new URL(secrets.rpcUrl).host
  } catch {
    /* invalid url is reported when it is used */
  }
  return {
    rpcCustom: !!secrets.rpcUrl,
    rpcHost,
    xaiKey: !!secrets.xaiKey,
    xClientId: !!secrets.xClientId,
    xUser: secrets.xTokens?.username ?? null,
    encrypted: safeStorage.isEncryptionAvailable()
  }
}

// ---- event bus to the renderer ----

export function emit(e: AppEvent): void {
  for (const l of listeners) l(e)
}
export function onEvent(l: (e: AppEvent) => void): void {
  listeners.add(l)
}

export const uid = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
