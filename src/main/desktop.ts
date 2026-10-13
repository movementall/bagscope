// Windows desktop integration: system tray, the always-on-top mini view, and
// Windows Hello verification for leaving read-only mode.

import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { BrowserWindow, Menu, Tray, app, screen } from 'electron'
import { totalValue } from '@shared/calc'
import type { Portfolio } from '@shared/types'
import { getPortfolio, refresh } from './portfolio'
import { getDb } from './store'

const iconPath = (): string => (app.isPackaged ? join(process.resourcesPath, 'icon.ico') : join(__dirname, '../../build/icon.ico'))

let tray: Tray | null = null
let mini: BrowserWindow | null = null
let hooks: { showMain: () => void; quit: () => void } | null = null

export const miniWindow = (): BrowserWindow | null => (mini && !mini.isDestroyed() ? mini : null)

function buildMenu(): Menu {
  return Menu.buildFromTemplate([
    { label: 'Show Bagscope', click: () => hooks?.showMain() },
    { label: 'Refresh now', click: () => void refresh() },
    { label: 'Mini view (always on top)', type: 'checkbox', checked: !!miniWindow(), click: () => toggleMini() },
    { type: 'separator' },
    { label: 'Quit Bagscope', click: () => hooks?.quit() }
  ])
}

/** Real total and 24h move for the tray tooltip; says so when the data is stale or missing. */
export function updateTray(p: Portfolio = getPortfolio()): void {
  if (!tray) return
  tray.setContextMenu(buildMenu())
  if (!p.updatedAt) return tray.setToolTip('Bagscope · no balances loaded yet')
  const total = totalValue(p.holdings, null)
  let then = 0
  let now = 0
  for (const h of p.holdings) {
    if (h.excluded || h.price == null || h.change24h == null) continue
    const v = Object.values(h.byWallet).reduce((s, n) => s + n, 0) * h.price
    now += v
    then += v / (1 + h.change24h / 100)
  }
  const pct = then > 0 ? ` (${now >= then ? '+' : ''}${((now / then - 1) * 100).toFixed(2)}% 24h)` : ''
  const usd = total.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
  tray.setToolTip(`Bagscope · ${usd}${pct}${p.offline ? ' · offline, last known' : ''}`)
}

export function initDesktop(h: { showMain: () => void; quit: () => void }): void {
  hooks = h
  tray = new Tray(iconPath())
  tray.on('click', () => h.showMain())
  updateTray()
}

export function toggleMini(): boolean {
  const open = miniWindow()
  if (open) {
    open.close()
    return false
  }
  const { workArea } = screen.getPrimaryDisplay()
  const [w, hgt] = [264, 96]
  mini = new BrowserWindow({
    width: w,
    height: hgt,
    x: workArea.x + workArea.width - w - 20,
    y: workArea.y + workArea.height - hgt - 20,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    icon: iconPath(),
    backgroundColor: getDb().settings.theme === 'dark' ? '#0F1114' : '#FFFFFF',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true, nodeIntegration: false }
  })
  mini.setAlwaysOnTop(true, 'floating')
  mini.once('ready-to-show', () => mini?.showInactive())
  mini.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mini.webContents.on('will-navigate', (e) => e.preventDefault())
  mini.on('closed', () => {
    mini = null
    updateTray()
  })
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void mini.loadURL(`${process.env.ELECTRON_RENDERER_URL}#mini`)
  else void mini.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'mini' })
  updateTray()
  return true
}

// ---------- Windows Hello ----------

const WINRT = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
[Windows.Security.Credentials.UI.UserConsentVerifier,Windows.Security.Credentials.UI,ContentType=WindowsRuntime] | Out-Null
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; "$($t.Result)" }
`

function winrt(command: string, timeout: number): Promise<string> {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINRT + command], { windowsHide: true, timeout }, (err, stdout) => resolve(err ? '' : stdout.trim()))
  })
}

export async function helloAvailable(): Promise<boolean> {
  if (process.platform !== 'win32') return false
  return (await winrt('Await ([Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync()) ([Windows.Security.Credentials.UI.UserConsentVerifierAvailability])', 15_000)) === 'Available'
}

/** Shows the Windows Hello / PIN prompt. Resolves true only when Windows reports the user as verified. */
export async function helloVerify(message: string): Promise<boolean> {
  const safe = message.replace(/[^\w .,]/g, '')
  return (await winrt(`Await ([Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync('${safe}')) ([Windows.Security.Credentials.UI.UserConsentVerificationResult])`, 120_000)) === 'Verified'
}
