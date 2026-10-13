import { BrowserWindow, ClipboardItem, app, clipboard, dialog, ipcMain, session, shell } from 'electron'
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AlertRule, ChartRange, Lot, Settings, TokenMeta, Wallet } from '@shared/types'
import { benchSeries } from './bench'
import { checkAlerts } from './alerts'
import { helloAvailable, helloVerify, initDesktop, miniWindow, toggleMini, updateTray } from './desktop'
import { bridgePort, openConnect, startBridge, startPhoneConnect, stopPhoneConnect } from './bridge'
import { getChart, getInsight, getWhaleTrades, searchTokens } from './market'
import { autoSync, getHistories, getPortfolio, getTransactions, historyStatus, holdingsAt, initPortfolio, onRefreshed, rebuildLots, refresh, saveSnapshot, syncBack, syncTransactions } from './portfolio'
import { alphaFeed, askGrok, cachedGrok, grokModels, kolFeed, pollKols, startXLogin, trending, xLogout } from './social'
import { isValidAddress, testRpc } from './solana'
import { flushStore, getDb, getSecrets, getState, initStore, onEvent, setSecrets, uid, update } from './store'

const dev = !app.isPackaged

/**
 * The app used to be called Moonbag. On first start under the new name, carry the
 * user's wallets, settings, history and encrypted keys over from the old profile.
 * "Local State" holds the key Windows uses to decrypt the secrets file, so it moves too.
 */
function migrateOldProfile(): void {
  try {
    const next = app.getPath('userData')
    const old = join(app.getPath('appData'), 'Moonbag')
    if (existsSync(join(next, 'bagscope.json')) || !existsSync(join(old, 'moonbag.json'))) return
    mkdirSync(next, { recursive: true })
    for (const [from, to] of [['moonbag.json', 'bagscope.json'], ['cache.json', 'cache.json'], ['secrets.bin', 'secrets.bin'], ['Local State', 'Local State']]) {
      if (existsSync(join(old, from)) && !existsSync(join(next, to))) copyFileSync(join(old, from), join(next, to))
    }
  } catch {
    // A failed copy leaves a fresh, empty profile; the old one is untouched and can be retried.
  }
}
// Development only: isolated profile and scripted screenshots for visual checks.
if (dev && process.env.MB_USERDATA) app.setPath('userData', process.env.MB_USERDATA)
else migrateOldProfile()

let win: BrowserWindow | null = null
let quitting = false

function showMain(): void {
  if (!win || win.isDestroyed()) return createWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}
const WALLET_COLORS = ['#3DFFA2', '#FF4D9D', '#3DE0FF', '#FF8A3D', '#9B7BFF', '#FFD23D']
const chrome = (theme: Settings['theme']): { color: string; symbolColor: string } =>
  theme === 'dark' ? { color: '#00000000', symbolColor: '#8B93A1' } : { color: '#00000000', symbolColor: '#5A616E' }

const httpsOnly = (url: string): string => {
  if (!/^https:\/\//i.test(url)) throw new Error('Only https links can be opened.')
  return url
}

type Handler = (...args: never[]) => unknown

const handlers: Record<string, Handler> = {
  'app.state': () => getState(),
  'app.portfolio': () => getPortfolio(),
  'app.history': () => getHistories(),
  'app.refresh': () => refresh(),
  'app.openExternal': (url: string) => shell.openExternal(httpsOnly(url)),
  'app.copy': (text: string) => clipboard.writeText(String(text)),
  'app.about': () => ({ version: app.getVersion() }),
  // Opens a notice file that ships with the app. Only these two fixed files can be opened.
  'app.openNotice': (which: 'third-party' | 'licence') => {
    const name = which === 'licence' ? 'LICENSE.bagscope.txt' : 'THIRD-PARTY-NOTICES.txt'
    const file = app.isPackaged ? join(process.resourcesPath, name) : join(__dirname, '../..', which === 'licence' ? 'LICENSE' : 'build/THIRD-PARTY-NOTICES.txt')
    return shell.openPath(file).then((err) => {
      if (err) throw new Error('The notice file could not be opened.')
    })
  },
  'app.copyImage': (dataUrl: string) => clipboard.write([new ClipboardItem({ 'image/png': new Blob([Buffer.from(dataUrl.split(',')[1] ?? '', 'base64')], { type: 'image/png' }) })]),
  'app.saveFile': async (a: { name: string; content: string; base64?: boolean }) => {
    const res = await dialog.showSaveDialog(win!, { defaultPath: join(app.getPath('documents'), a.name) })
    if (res.canceled || !res.filePath) return null
    writeFileSync(res.filePath, a.base64 ? Buffer.from(a.content, 'base64') : `﻿${a.content}`)
    return res.filePath
  },
  'app.theme': (theme: Settings['theme']) => {
    win?.setTitleBarOverlay(chrome(theme))
    win?.setBackgroundColor(theme === 'dark' ? '#08090B' : '#F6F7F9')
  },

  'wallets.connect': () => openConnect(),
  'wallets.phoneStart': (ip?: string) => startPhoneConnect(ip),
  'wallets.phoneStop': () => stopPhoneConnect(),
  'wallets.addWatch': (address: string, label: string) => {
    address = address.trim()
    if (!isValidAddress(address)) throw new Error('That is not a valid Solana address.')
    if (getDb().wallets.some((w) => w.address === address)) throw new Error('This wallet is already added.')
    update((d) => void d.wallets.push({ address, label: label.trim() || `Wallet ${d.wallets.length + 1}`, color: WALLET_COLORS[d.wallets.length % WALLET_COLORS.length], verified: false, addedAt: Date.now() }))
    void refresh()
  },
  'wallets.update': (address: string, patch: Partial<Pick<Wallet, 'label' | 'color'>>) =>
    update((d) => {
      const w = d.wallets.find((x) => x.address === address)
      if (w) Object.assign(w, { label: patch.label?.trim().slice(0, 24) || w.label, color: patch.color ?? w.color })
    }),
  'wallets.remove': (address: string) => {
    update((d) => {
      d.wallets = d.wallets.filter((w) => w.address !== address)
      d.lots = d.lots.filter((l) => l.wallet !== address)
    })
    void refresh()
  },

  'settings.set': async (patch: Partial<Settings>) => {
    const s = getDb().settings
    // Leaving read-only mode (or removing its lock) needs Windows Hello when the lock is on.
    const unlocking = s.readOnly && s.lockWithHello && (patch.readOnly === false || patch.lockWithHello === false)
    if (unlocking && !(await helloVerify('Unlock Bagscope to allow transactions'))) throw new Error('Windows verification was cancelled. Read-only mode stays on.')
    if (patch.lockWithHello === true && !(await helloAvailable())) throw new Error('Windows Hello or a PIN is not set up on this PC.')
    update((d) => void Object.assign(d.settings, patch))
    if ('minLiquidity' in patch || 'excludeOverLiquidity' in patch) void refresh()
    if ('receivesAsBuys' in patch) void rebuildLots()
    if (patch.autoHistory === true) void autoSync()
  },
  'rpc.test': () => testRpc(getSecrets().rpcUrl, getDb().wallets[0]?.address),
  'secrets.set': async (patch: { rpcUrl?: string; xaiKey?: string; xClientId?: string }) => {
    if (patch.rpcUrl) {
      // Never store an endpoint that returns incomplete data; balances depend on it.
      const report = await testRpc(httpsOnly(patch.rpcUrl.trim()), getDb().wallets[0]?.address)
      if (!report.ok) throw new Error(report.detail)
    }
    const clean = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v?.trim() || undefined]))
    setSecrets(clean)
    if ('rpcUrl' in patch) void refresh()
  },

  'meta.set': (mint: string, patch: TokenMeta) =>
    update((d) => {
      d.tokenMeta[mint] = { ...d.tokenMeta[mint], ...patch }
      if (patch.pinned === true && !d.pinOrder.includes(mint)) d.pinOrder.push(mint)
      if (patch.pinned === false) d.pinOrder = d.pinOrder.filter((m) => m !== mint)
    }),
  'pins.reorder': (order: string[]) => update((d) => void (d.pinOrder = [...new Set(order)].filter((m) => d.tokenMeta[m]?.pinned))),
  'wallets.reorder': (order: string[]) =>
    update((d) => {
      const by = new Map(d.wallets.map((w) => [w.address, w]))
      const next = [...new Set(order)].map((a) => by.get(a)).filter((w): w is Wallet => !!w)
      if (next.length === d.wallets.length) d.wallets = next
    }),
  'hello.available': () => helloAvailable(),
  'mini.toggle': () => toggleMini(),
  'window.showMain': () => showMain(),
  'window.reload': () => win?.webContents.reload(),
  'tags.set': (tags: string[]) => update((d) => void (d.tags = [...new Set(tags.map((t) => t.trim()).filter(Boolean))].slice(0, 30))),
  'lots.add': (lot: Omit<Lot, 'id' | 'source'>) => {
    if (!(lot.amount > 0) || !(lot.priceUsd >= 0) || !Number.isFinite(lot.ts)) throw new Error('Enter a valid amount, price and date.')
    update((d) => void d.lots.push({ ...lot, id: uid(), source: 'manual' }))
  },
  'lots.remove': (id: string) =>
    update((d) => {
      d.lots = d.lots.filter((l) => l.id !== id)
      if (id.startsWith('auto:')) d.deletedAutoLots.push(id)
    }),
  'watch.toggle': (mint: string) => {
    update((d) => void (d.watchlist = d.watchlist.includes(mint) ? d.watchlist.filter((m) => m !== mint) : [...d.watchlist, mint]))
    void refresh()
  },

  'alerts.add': (rule: Pick<AlertRule, 'kind' | 'mint' | 'symbol' | 'value' | 'repeat'>) => {
    if (!(rule.value > 0)) throw new Error('Enter a value above zero.')
    update((d) => void d.alerts.push({ ...rule, id: uid(), enabled: true, createdAt: Date.now(), lastFiredAt: null }))
    void refresh()
  },
  'alerts.update': (id: string, patch: Partial<Pick<AlertRule, 'enabled' | 'value' | 'repeat'>>) =>
    update((d) => void Object.assign(d.alerts.find((a) => a.id === id) ?? {}, patch)),
  'alerts.remove': (id: string) => update((d) => void (d.alerts = d.alerts.filter((a) => a.id !== id))),
  'notifs.read': () => update((d) => d.notifications.forEach((n) => (n.read = true))),
  'notifs.clear': () => update((d) => void (d.notifications = [])),

  'snapshots.save': (label: string) => saveSnapshot(label),
  'snapshots.remove': (id: string) => update((d) => void (d.snapshots = d.snapshots.filter((s) => s.id !== id))),

  'tx.list': () => getTransactions(),
  'tx.sync': (wallet: string, older: boolean) => syncTransactions(wallet, older),
  'history.status': () => historyStatus(),
  'lots.rebuild': () => rebuildLots(),
  'history.prepare': (wallet: string, untilTs: number) => syncBack(wallet, untilTs),
  'history.at': (ts: number, wallet: string | null) => holdingsAt(ts, wallet),

  'token.insight': (mint: string, force: boolean) => getInsight(mint, force),
  'token.chart': (mint: string, range: ChartRange) => getChart(mint, range),
  'token.search': (q: string) => searchTokens(q),
  'token.whales': (mint: string, minUsd: number) => getWhaleTrades(mint, minUsd),

  'x.login': () => startXLogin(bridgePort()),
  'x.logout': () => xLogout(),
  'x.callbackUrl': () => `http://127.0.0.1:${bridgePort()}/x/callback`,
  'x.feed': (mint: string, symbol: string, force: boolean) => alphaFeed(mint, symbol, force),
  'x.trending': (force: boolean) => trending(force),
  'x.kolFeed': () => kolFeed(),
  'x.pollKols': () => pollKols(),
  'kols.set': (list: string[]) =>
    update((d) => void (d.kols = [...new Set(list.map((k) => k.trim().replace(/^@/, '')).filter((k) => /^\w{1,15}$/.test(k)))].slice(0, 40))),
  'bench.series': (ids: string[], range: string) => benchSeries(ids, range),
  'grok.ask': async (mint: string, force: boolean) => askGrok(await getInsight(mint), force),
  'grok.cached': (mint: string) => cachedGrok(mint),
  'grok.models': () => grokModels()
}

function createWindow(): void {
  const theme = getDb().settings.theme
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 660,
    show: false,
    backgroundColor: theme === 'dark' ? '#08090B' : '#F6F7F9',
    icon: app.isPackaged ? join(process.resourcesPath, 'icon.ico') : join(__dirname, '../../build/icon.ico'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...chrome(theme), height: 44 },
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: !(dev && process.env.MB_SHOT) }
  })
  const startHidden = getDb().settings.startMinimized && getDb().settings.closeToTray && !process.env.MB_SHOT
  win.once('ready-to-show', () => !startHidden && win?.show())
  win.on('close', (e) => {
    // With "close to tray" the window only hides; alerts keep running in the background.
    if (!quitting && getDb().settings.closeToTray) {
      e.preventDefault()
      win?.hide()
    }
  })
  win.on('closed', () => {
    win = null
    if (!quitting) app.quit()
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  if (dev && process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))

  const shot = dev ? process.env.MB_SHOT : undefined
  if (shot) {
    win.webContents.once('did-finish-load', async () => {
      const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
      await wait(Number(process.env.MB_SHOT_DELAY ?? 6000))
      const steps = (process.env.MB_SHOT_JS ?? '').split('|||').filter(Boolean)
      for (let i = 0; i <= steps.length; i++) {
        if (i > 0) {
          await win!.webContents.executeJavaScript(steps[i - 1]).catch((e) => console.error('shot step failed', e))
          await wait(Number(process.env.MB_SHOT_STEP ?? 2500))
        }
        writeFileSync(shot.replace('.png', `${i || ''}.png`), (await win!.webContents.capturePage()).toPNG())
      }
      app.quit()
    })
  }
}

function schedule(): void {
  const loop = (): void => {
    const sec = Math.max(30, getDb().settings.refreshSec)
    setTimeout(() => void refresh().finally(loop), sec * 1000)
  }
  loop()
  const kols = (): void => {
    setTimeout(() => void pollKols().catch(() => undefined).finally(kols), Math.max(5, getDb().settings.kolPollMin) * 60_000)
  }
  kols()
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.setAppUserModelId('com.bagscope.app')
  app.on('second-instance', showMain)
  void app.whenReady().then(async () => {
    initStore()
    initPortfolio()
    // The removed local X scanner kept a signed-in browser profile; clear it once.
    void session.fromPartition('persist:xscan').clearStorageData().catch(() => undefined)
    onEvent((e) => {
      for (const w of [win, miniWindow()]) if (w && !w.isDestroyed()) w.webContents.send('event', e)
    })
    onRefreshed((p) => void checkAlerts(p))
    onRefreshed((p) => updateTray(p))
    onRefreshed(() => void autoSync())
    ipcMain.handle('call', async (event, method: string, args: unknown[]) => {
      if (event.sender !== win?.webContents && event.sender !== miniWindow()?.webContents) throw new Error('Unauthorised sender')
      const fn = Object.hasOwn(handlers, method) ? handlers[method] : null
      if (!fn) throw new Error(`Unknown method ${method}`)
      return (fn as (...a: unknown[]) => unknown)(...(Array.isArray(args) ? args : []))
    })
    await startBridge().catch(() => 0)
    createWindow()
    initDesktop({ showMain, quit: () => app.quit() })
    void refresh()
    schedule()
  })
  app.on('before-quit', () => {
    quitting = true
    flushStore()
  })
  app.on('window-all-closed', () => app.quit())
}
