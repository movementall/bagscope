import { useState, type ReactNode } from 'react'
import type { Settings as S } from '@shared/types'
import { Page, Segmented, Toggle, useAsync } from '@/components/ui'
import { PALETTE } from '@/lib/format'
import { act, call, useStore } from '@/lib/store'

function Row({ title, desc, children }: { title: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <div className="setting">
      <div>
        <b>{title}</b>
        {desc && <p>{desc}</p>}
      </div>
      <div className="row-flex" style={{ flex: 'none' }}>{children}</div>
    </div>
  )
}

function Num({ value, onCommit, width = 90, prefix }: { value: number; onCommit: (n: number) => void; width?: number; prefix?: string }) {
  return (
    <div className="row-flex" style={{ gap: 6 }}>
      {prefix && <span className="muted">{prefix}</span>}
      <input className="input num" style={{ width }} type="number" min={0} defaultValue={value} key={value} onBlur={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n >= 0 && n !== value) onCommit(n) }} />
    </div>
  )
}

function Secret({ saved, placeholder, field, hint }: { saved: boolean; placeholder: string; field: string; hint?: string }) {
  const [v, setV] = useState('')
  return (
    <div className="row-flex">
      <input className="input mono" style={{ width: 280 }} type="password" placeholder={saved ? `Saved${hint ? ` · ${hint}` : ''}` : placeholder} value={v} onChange={(e) => setV(e.target.value)} autoComplete="off" />
      <button className="btn" disabled={!v.trim()} onClick={() => void act(call('secrets.set', { [field]: v }), 'Saved to Windows secure storage').then(() => setV(''))}>Save</button>
      {saved && <button className="btn ghost danger" onClick={() => void act(call('secrets.set', { [field]: '' }), 'Removed')}>Clear</button>}
    </div>
  )
}

export function Settings() {
  const { state } = useStore()
  const s = state!.settings
  const sec = state!.secrets
  const set = (patch: Partial<S>): void => void act(call('settings.set', patch))
  const rpc = useAsync(() => call<{ ok: boolean; host: string; ms: number | null; detail: string }>('rpc.test'), [sec.rpcCustom, sec.rpcHost])
  const hello = useAsync(() => call<boolean>('hello.available'), [])
  const callback = useAsync(() => call<string>('x.callbackUrl'), [])
  const about = useAsync(() => call<{ version: string }>('app.about'), [])
  const link = (label: string, url: string) => <a key={url} onClick={() => void call('app.openExternal', url)}>{label}</a>
  const models = useAsync(() => (sec.xaiKey ? call<string[]>('grok.models') : Promise.resolve([] as string[])), [sec.xaiKey])

  return (
    <Page title="Settings" sub="Everything is stored on this PC. Keys are encrypted with Windows secure storage.">
      <section className="card pad">
        <div className="h2">Look</div>
        <Row title="Theme">
          <Segmented value={s.theme} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]} onChange={(theme) => set({ theme })} />
        </Row>
        <Row title="Accent colour" desc="Pick your flavour. Gains stay green and losses stay red either way.">
          {PALETTE.slice(0, 6).map((c) => (
            <button key={c} className={`swatch ${s.accent.toLowerCase() === c.toLowerCase() ? 'on' : ''}`} style={{ background: c }} onClick={() => set({ accent: c })} aria-label={c} />
          ))}
          <input type="color" aria-label="Custom accent colour" value={s.accent} onChange={(e) => set({ accent: e.target.value })} title="Custom colour" style={{ width: 30, height: 30, border: 0, background: 'none', padding: 0, cursor: 'pointer' }} />
        </Row>
      </section>

      <section className="card pad">
        <div className="h2">Layout</div>
        <Row title="Row density" desc="Compact fits more coins on screen: shorter rows, smaller icons, no second line.">
          <Segmented value={s.density} options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} onChange={(density) => set({ density })} />
        </Row>
        <Row title="Degen mode" desc="For fast scanning: always hides balances under your dust threshold, ranks coins by their 24h move with SOL and stablecoins last, and trims the list to the essentials.">
          <Toggle on={s.degenMode} onChange={(degenMode) => set({ degenMode })} />
        </Row>
      </section>

      <section className="card pad">
        <div className="h2">Safety</div>
        <Row title="Read-only mode" desc="Bagscope is view-only: it adds wallets and reads balances, and has no feature that sends a transaction. The lock is a visible guarantee of that, and would block any such feature if one were added later.">
          <Toggle on={s.readOnly} onChange={(readOnly) => set({ readOnly })} />
        </Row>
        <Row
          title="Require Windows Hello to unlock"
          desc={hello.loading ? 'Checking whether Windows Hello or a PIN is set up…' : hello.data ? 'Leaving read-only mode asks for your fingerprint, face or Windows PIN.' : 'Not available: Windows Hello or a PIN is not set up on this PC.'}
        >
          <button className={`toggle ${s.lockWithHello ? 'on' : ''}`} role="switch" aria-checked={s.lockWithHello} disabled={!hello.data && !s.lockWithHello} style={{ opacity: !hello.data && !s.lockWithHello ? 0.4 : 1 }} onClick={() => set({ lockWithHello: !s.lockWithHello })} />
        </Row>
      </section>

      <section className="card pad">
        <div className="h2">Window</div>
        <Row title="Keep running in the system tray" desc="Closing the window hides Bagscope next to the clock instead of quitting, so alerts keep firing. The tray icon shows your total; right-click it for Show, Refresh, Mini view and Quit.">
          <Toggle on={s.closeToTray} onChange={(closeToTray) => set({ closeToTray })} />
        </Row>
        <Row title="Start minimised to tray" desc="Opens straight into the tray. Needs the tray option above.">
          <button className={`toggle ${s.startMinimized ? 'on' : ''}`} role="switch" aria-checked={s.startMinimized} disabled={!s.closeToTray} style={{ opacity: s.closeToTray ? 1 : 0.4 }} onClick={() => set({ startMinimized: !s.startMinimized })} />
        </Row>
        <Row title="Mini view" desc="A small always-on-top window with your total and 24h change. Click it to bring Bagscope back.">
          <button className="btn" onClick={() => void act(call('mini.toggle'))}>Toggle mini view</button>
        </Row>
      </section>

      <section className="card pad">
        <div className="h2">Entries and cost basis</div>
        <Row title="Fill in my entries automatically" desc="Bagscope reads each wallet's full transaction history in the background and turns every swap into a buy or sell at the price you actually paid. You never have to type them in; entries you delete stay deleted.">
          <Toggle on={s.autoHistory} onChange={(autoHistory) => set({ autoHistory })} />
        </Row>
        <Row title="Count received tokens as buys" desc="Tokens sent to you from outside your own wallets (an exchange withdrawal, an airdrop) have no purchase on chain. With this on, they are entered at the market price at the moment they arrived and labelled as an estimate. Moves between your own wallets are never counted.">
          <Toggle on={s.receivesAsBuys} onChange={(receivesAsBuys) => set({ receivesAsBuys })} />
        </Row>
      </section>

      <section className="card pad">
        <div className="h2">Accuracy</div>
        <Row title="Hide small balances" desc="Hidden rows are still counted in your total.">
          <Num prefix="under $" value={s.smallThreshold} onCommit={(n) => set({ smallThreshold: n })} />
          <Toggle on={s.hideSmall} onChange={(hideSmall) => set({ hideSmall })} />
        </Row>
        <Row title="Minimum pool liquidity" desc="Tokens whose main pool is thinner than this are shown but never counted. Stops spam airdrops from inflating your total.">
          <Num prefix="$" value={s.minLiquidity} onCommit={(n) => set({ minLiquidity: n })} width={110} />
        </Row>
        <Row title="Ignore positions larger than their exit liquidity" desc="If a holding is quoted at more than twice the liquidity available to sell it, that value is not real.">
          <Toggle on={s.excludeOverLiquidity} onChange={(excludeOverLiquidity) => set({ excludeOverLiquidity })} />
        </Row>
        <Row title="Refresh every" desc="Balances from chain and prices from Jupiter / DexScreener.">
          <Segmented value={String(s.refreshSec)} options={[{ value: '30', label: '30s' }, { value: '60', label: '1m' }, { value: '300', label: '5m' }]} onChange={(v) => set({ refreshSec: Number(v) })} />
        </Row>
        <Row title="Daily and weekly snapshots" desc="Saves a full record of your holdings on the first refresh of each day.">
          <Toggle on={s.autoSnapshot} onChange={(autoSnapshot) => set({ autoSnapshot })} />
        </Row>
      </section>

      <section className="card pad">
        <div className="h2">Connections</div>
        <Row title="Solana RPC" desc={<>Optional. Works out of the box on the public endpoint. Pasting a free dedicated URL (Helius, QuickNode, Triton) makes refresh and history sync much faster; it is tested before it is saved. {sec.rpcCustom ? `Using ${sec.rpcHost}.` : 'Using the public mainnet endpoint.'}</>}>
          <Secret saved={sec.rpcCustom} field="rpcUrl" placeholder="https://…" hint={sec.rpcHost ?? undefined} />
        </Row>
        <Row
          title="RPC status"
          desc={
            rpc.loading
              ? 'Checking the connection…'
              : rpc.error
                ? `Check failed: ${rpc.error}`
                : rpc.data
                  ? <span className={rpc.data.ok ? 'up' : 'down'}>{rpc.data.host}: {rpc.data.detail}</span>
                  : null
          }
        >
          <button className="btn" onClick={rpc.reload} disabled={rpc.loading}>Test connection</button>
          <button className="btn ghost" onClick={() => void call('app.openExternal', 'https://dashboard.helius.dev')}>Get a free RPC key</button>
        </Row>
        <Row title="Grok (xAI API key)" desc="Used for Ask Grok and sentiment. Create one at console.x.ai. Sent only to api.x.ai.">
          <Secret saved={sec.xaiKey} field="xaiKey" placeholder="xai-…" />
        </Row>
        {sec.xaiKey && (
          <Row title="Grok model" desc={models.error ? `Could not list models: ${models.error}` : 'Models with live search give the best alpha.'}>
            {models.data?.length ? (
              <select className="select" style={{ width: 220 }} value={s.grokModel} onChange={(e) => set({ grokModel: e.target.value })}>
                {!models.data.includes(s.grokModel) && <option>{s.grokModel}</option>}
                {models.data.map((m) => <option key={m}>{m}</option>)}
              </select>
            ) : (
              <input className="input" style={{ width: 220 }} defaultValue={s.grokModel} onBlur={(e) => e.target.value.trim() && set({ grokModel: e.target.value.trim() })} />
            )}
          </Row>
        )}
      </section>

      <section className="card pad">
        <div className="h2">X (official API)</div>
        <Row title="X app Client ID" desc={<>From your own project at developer.x.com (OAuth 2.0, type “Native app”). Register this callback URL there: <span className="mono selectable">{callback.data ?? '…'}</span>. X charges for search access on its API.</>}>
          <Secret saved={sec.xClientId} field="xClientId" placeholder="Client ID" />
        </Row>
        <Row title="X account" desc={sec.xUser ? `Signed in as @${sec.xUser}.` : 'Sign in to load the Alpha Feed, trending counts and KOL alerts. Opens x.com in your browser; Bagscope never sees your password.'}>
          {sec.xUser ? (
            <button className="btn" onClick={() => void act(call('x.logout'), 'Signed out of X')}>Sign out</button>
          ) : (
            <button className="btn primary" disabled={!sec.xClientId} onClick={() => void act(call('x.login'))}>Sign in with X</button>
          )}
        </Row>
        <Row title="Check tracked accounts every">
          <Segmented value={String(s.kolPollMin)} options={[{ value: '5', label: '5m' }, { value: '10', label: '10m' }, { value: '30', label: '30m' }]} onChange={(v) => set({ kolPollMin: Number(v) })} />
        </Row>
      </section>

      <section className="card pad">
        <div className="h2">Notifications</div>
        <Row title="Windows notifications" desc="Price, market cap, whale, liquidity and KOL alerts appear as native toasts while Bagscope is running.">
          <Toggle on={s.notifications} onChange={(notifications) => set({ notifications })} />
        </Row>
      </section>
      <section className="card pad">
        <div className="h2">About and legal</div>
        <Row title={`Bagscope ${about.data?.version ?? ''}`} desc="Free software under the MIT licence. Provided as is, without warranty of any kind.">
          <button className="btn" onClick={() => void act(call('app.openNotice', 'licence'))}>Licence</button>
          <button className="btn" onClick={() => void act(call('app.openNotice', 'third-party'))}>Third-party notices</button>
        </Row>
        <Row
          title="Data sources"
          desc={
            <>
              Balances and transactions: the Solana network. Prices, token details and charts: {link('Jupiter', 'https://jup.ag')}. Fallback prices and pools: {link('DEX Screener', 'https://dexscreener.com')}. Fallback charts and large trades: powered by {link('GeckoTerminal', 'https://www.geckoterminal.com')}. Risk data: {link('RugCheck', 'https://rugcheck.xyz')}. The S&amp;P 500, Nasdaq 100 and gold benchmarks follow tokenised funds on Solana (SPYx, QQQx, GLDx), priced by Jupiter. Posts: the official X API, with your own access. Token names and logos belong to their projects and are shown only to identify them.
            </>
          }
        >
          <span />
        </Row>
        <Row
          title="Not financial advice"
          desc="Bagscope shows information to help your own judgement. Risk scores, benchmarks, estimates and AI analysis can be wrong, and a low risk score is not a guarantee. Nothing here is a recommendation to buy or sell. Crypto assets can lose all their value."
        >
          <span />
        </Row>
        <Row title="Independent project" desc="Bagscope is not affiliated with or endorsed by Phantom, Solana, Jupiter, DEX Screener, GeckoTerminal, RugCheck, X or xAI. Their names appear only to describe what the app works with.">
          <span />
        </Row>
        <Row title="Privacy" desc="No account, no analytics, no tracking. Your wallets, settings and history stay on this PC. The app contacts only the data sources above, sending them the public addresses and token ids it needs to look up.">
          <span />
        </Row>
      </section>

      <section className="card pad">
        <div className="h2">Support</div>
        <Row title="Support the dev" desc="Bagscope is free and has no ads or tracking. If you like it, you can tip in SOL. Entirely optional.">
          <button className="btn primary" onClick={() => useStore.getState().setModal({ kind: 'donate' })}>Donate SOL</button>
        </Row>
      </section>
    </Page>
  )
}
