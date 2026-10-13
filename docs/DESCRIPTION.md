# Bagscope

A Windows desktop app that puts every Phantom wallet you own in one place, values it with real on-chain balances and vetted prices, and adds the context a meme coin holder actually needs: rug risk, cost basis, X chatter and Grok analysis.

> **Changed since this was written:** the Jupiter swap feature and the official X API integration (sign-in, trending counts, KOL tracker) have been removed. Bagscope is now view-only, and posts from X come only from the optional local scanner. Sections below that describe swapping or the X API are historical; see section 11.

> **Build status.** Every feature below is implemented. What has and has not been confirmed by running it is listed in the Verification section at the bottom.

---

## 1. What it is for

You hold meme coins across several Phantom accounts. Phantom shows one account at a time, values illiquid airdrops at fantasy prices, and tells you nothing about what you paid. Bagscope answers four questions quickly:

1. **What am I actually worth right now?** One number across all wallets, counted only from positions that could really be sold.
2. **How am I doing?** 24h / 7d / 30d / all-time performance, realized and unrealized PnL, average entry per coin.
3. **Is this coin about to rug?** Liquidity, holder concentration, age, mint/freeze authority and LP lock, rolled into Low / Medium / High with the reasons shown.
4. **What is everyone saying?** Recent X posts about the selected coin, tracked influencers, and a Grok read on sentiment.

Tone: dark, fast, minimal, with a little degen personality in the copy and the accent glow. Never cluttered.

---

## 2. The accuracy contract

These rules are enforced in code, not left to the UI.

| Rule | How it is enforced |
|---|---|
| Balances are real | Read from Solana RPC per wallet (`getBalance` + `getTokenAccountsByOwner` for both token programs). Raw integer amounts are summed with BigInt before conversion. No sample or placeholder data exists anywhere in the app. |
| Prices come from the main pool | Jupiter Price API first (it already rejects unreliable pools). For tokens Jupiter does not price, DexScreener, choosing the pair with the **deepest USD liquidity where the token is the base asset**. DexScreener's own ordering is not trusted. |
| No millions from dust | A position is **not counted** in totals when it has no price, when its pool liquidity is under a threshold (default $1,000), or when its "value" is more than twice the liquidity available to exit it. Each such row says why. All three are adjustable in Settings. |
| Failures are visible | If a wallet cannot be read, its last on-chain reading is kept and labelled with its own timestamp. If prices fail, the last complete portfolio is shown as offline. Nothing is estimated to fill a gap. |
| Always a timestamp | "Last updated" is shown in the sidebar and header; offline mode shows the age of the data. |
| An RPC that lies is not used | Public endpoints that return empty results instead of errors were tested and excluded as fallbacks. |

---

## 3. Wallet security model

- **No seed phrases, no private keys.** There is no field anywhere to enter one. The app stores public addresses only.
- **Official Solana Wallet Adapter** (`@solana/wallet-adapter-phantom`).
- **Why a browser tab opens.** Phantom is a browser extension and cannot be loaded inside a desktop app. Bagscope runs a server bound to `127.0.0.1` only, opens a small page in your normal browser where Phantom lives, and that page uses the Wallet Adapter.
  - *Connect:* Phantom asks you to connect and sign a short text message. The app verifies the Ed25519 signature against the public key, which proves ownership. It is not a transaction and costs nothing. Switch account in Phantom and press the button again to add the next wallet.
  - *Swap:* the app builds the transaction with Jupiter, the page hands it to Phantom, **you approve or reject in Phantom**, and only the signed transaction comes back to be broadcast.
- **Watch-only wallets:** paste any public address to track it without proving ownership. Marked as unverified.
- **Bridge hardening:** loopback only, random single-use session tokens that expire, Host and Origin checks (blocks DNS rebinding and cross-site posts), strict Content-Security-Policy.
- **Secrets** (custom RPC URL, xAI key, X tokens) are encrypted with Windows DPAPI through Electron `safeStorage`. This is the same OS facility Credential Manager is built on; the encrypted file is only readable by your Windows user.
- **The UI process has no network or Node access.** It can call a fixed list of named backend methods and nothing else.

---

## 4. Features

### Multi-wallet dashboard
- All Wallets view plus one-click filter per wallet; labels (Main, Degen, Cold) and colours.
- Large animated total; 24h change in dollars and percent.
- Performance tiles: 24H, 7D, 30D, All-time.
- Portfolio chart with two modes: **Recorded** (what the app actually observed over time) and **Estimated** (today's holdings at past prices, clearly labelled, with the share of the portfolio it covers).
- Allocation bar and token list or grid: price, 24h, amount, value, allocation %, PnL.
- Search, tag filters, pin favourites, hide balances below a dollar threshold.
- "Not counted" section for unpriced or illiquid tokens, with the reason per row.

### Portfolio tracking
- **Cost basis:** manual buy/sell entries, plus automatic lots decoded from your swap history. Average-cost method.
- **DCA:** every buy of a coin is listed; average entry updates as you add.
- **PnL:** unrealized on what you hold, realized on what you sold, per coin and in total.
- **Transaction history:** decoded from chain (swap / send / receive), valued in USD at the time of the trade, with search and filters.
- **Snapshots:** automatic daily and weekly, plus manual with your own label.
- **CSV export** for holdings, transactions, trades and snapshots.
- Tags (Meme, High Conviction, Degen, custom) and free-form notes per coin.

### Meme coin intelligence
- **Risk level** Low / Medium / High from six factors, each shown with its value and how many points it contributed: liquidity, top-10 holder share, token age, mint authority, freeze authority, LP locked or burned.
- If fewer than three factors are known, the level is **Unknown** rather than guessed.
- RugCheck's own flags are listed underneath; a token RugCheck marks as rugged is always High.
- Price, volume, market cap, FDV, liquidity, holder count, main pool, and links (Solscan, DexScreener, RugCheck, Birdeye, project socials).

### X and Grok
- **X sign-in** with OAuth 2.0 PKCE in your browser. No password touches the app.
- **Alpha Feed** per coin: recent relevant posts with real like / repost / reply / view counts.
- **KOL tracker:** follow handles; get notified when they mention a coin you hold or watch.
- **Trending:** which of your top holdings have the most posts in the last 24 hours (real counts from X).
- **Ask Grok:** an analysis panel per coin. Grok is given the app's on-chain figures as ground truth and searches X live. Shows sentiment (bullish / bearish / neutral), sources, the model used and when it ran. Refresh on demand.
- These need your own credentials: an **xAI API key** for Grok, and an **X developer app Client ID** for the feed. X charges for search access on its API; without it the feed shows a clear "not connected" state, never invented posts.

### Alerts
- Price above / below.
- Whale trades over a dollar size on the coin's main pool.
- Liquidity removal: main-pool liquidity falling by a chosen percentage.
- New posts from tracked accounts about your coins.
- Native Windows notifications plus an in-app notification log.
- Alerts run while the app is open.

### Quality of life
- Copy address, QR code.
- Watchlist separate from holdings, priced with the same sources.
- Jupiter swap with quote, price impact, minimum received and route.
- PnL card generator: a shareable image, saved or copied.
- Accent colour presets and custom colour; dark and light themes.
- Keyboard shortcuts and a command palette (Ctrl+K).
- Offline mode with last known data and its timestamp.

---

## 5. Data sources

| Need | Source | Key required |
|---|---|---|
| Balances, transactions, broadcasting | Solana RPC (public mainnet endpoint, or your own Helius/QuickNode/Triton URL) | No (your own RPC is faster) |
| Prices, 24h change | Jupiter Price API v3 | No |
| Long-tail prices, main pool, liquidity | DexScreener | No |
| Names, icons, supply, holder count, audit flags | Jupiter Tokens API v2 | No |
| Candles for charts, 7d/30d history, large trades | GeckoTerminal | No |
| Holder concentration, LP lock, risk flags | RugCheck | No |
| Swap quotes and transactions | Jupiter Swap API | No |
| Posts, counts, tracked accounts | X API v2 | Your X developer app |
| Analysis and sentiment | xAI API (Grok) | Your xAI key |

Birdeye and CoinGecko need paid or keyed access for what they would add here; they are not wired in.

---

## 6. Architecture

**Stack:** Electron 44, React 19, TypeScript, Vite. WinUI 3 was the first choice, but this machine has no .NET SDK, and the Wallet Adapter is a JavaScript library, so Electron gives one language end to end.

```
┌──────────────────────── Main process (Node) ────────────────────────┐
│ store      JSON state (atomic writes), cache, DPAPI-encrypted secrets│
│ solana     RPC client, balances, transaction decoding               │
│ market     Jupiter, DexScreener, GeckoTerminal, RugCheck, risk score │
│ portfolio  refresh cycle, snapshots, history, auto cost basis        │
│ alerts     rule engine, Windows notifications                        │
│ social     X OAuth + search, Grok                                    │
│ bridge     loopback server for Phantom connect and swap signing      │
└───────────────▲──────────────────────────────────────▲───────────────┘
                │ typed IPC (call / events)            │ http://127.0.0.1
┌───────────────┴───────────────┐        ┌─────────────┴──────────────┐
│ Renderer (sandboxed React UI) │        │ Bridge page in your browser │
│ no Node, no network           │        │ Solana Wallet Adapter       │
└───────────────────────────────┘        └────────────────────────────┘
```

Design choices worth knowing:
- **All network calls live in the main process**, each provider behind its own rate limiter with retry and backoff.
- **Valuation maths is shared code** used by both processes, so totals, snapshots and PnL can never disagree.
- **Refresh cycle** (default every 60s): read wallets, price every mint, attach metadata, apply exclusion rules, push to the UI, record a history point, evaluate alerts, then backfill price history for the largest holdings in the background.
- **Three files** in your Windows user profile: settings and portfolio records, a cache of last known data, and the encrypted secrets file.

---

## 7. Design system

**Colour.** Near-black base (`#08090B`), two raised surface steps, hairline borders. One accent carries the personality: electric green `#3DFFA2` by default, with hot pink, cyan, orange, violet, yellow or any custom colour. Up/down stay semantic green and red regardless of accent. Light theme darkens the accent for text so it stays readable on white.

**Type.** Space Grotesk for big numbers and headings (the slightly quirky character is the meme-coin nod). Inter for everything else, with tabular figures so numbers do not jitter as they update. Both bundled; no web requests.

**Spacing and shape.** 4px grid. Radii 8 / 12 / 16 / 22. Dense rows (58px) with generous card padding.

**Motion.** Three durations: 120ms for feedback, 220ms for transitions, 420ms for emphasis; one easing curve. Only transform and opacity are animated, so everything stays at 60fps. Numbers tween to their new value, charts draw in, the active nav and tab indicators slide between items, rows rise in on load. Reduced-motion system setting is respected.

**Voice.** Short and dry. A little "gm" and "down bad", never emoji soup.

---

## 8. Known limits

- **7d / 30d / chart history** before the app was installed is an estimate from current holdings at past prices. It becomes real as the app records its own history.
- **Automatic cost basis** covers simple two-sided swaps against SOL, USDC or USDT. Multi-leg trades, transfers between your own wallets, airdrops and LP positions need a manual entry.
- **Public RPC is slow** for transaction history. A free dedicated RPC URL in Settings fixes this.
- **Alerts need the app open**; there is no background service yet.
- **X and Grok** cost money on their side and need your own credentials.
- **Staked SOL, LP positions and NFTs** are not valued.

---

## 9. Verification

Checked by running the real app against live mainnet data, using two public addresses in a throwaway profile (no test data ships with the app).

| Part | State |
|---|---|
| Data sources respond with the shapes the code expects | Checked live against every provider listed above |
| App builds, typechecks, launches; packaged `Bagscope.exe` starts | Checked |
| Balances, prices, totals, allocation, exclusion of unpriced tokens | Checked on a wallet with 1,047 token accounts |
| 24h / 7d / 30d tiles and the estimated chart, with coverage shown | Checked |
| Token panel: chart, stats, per-wallet split, risk score, large trades | Checked. LP-lock figure matches RugCheck's own summary |
| Activity: decoding transactions from chain with USD values | Checked on 40 transactions |
| Swap: live Jupiter quote, route, minimum received | Checked up to the quote. Signing not tested |
| Bridge server: serves the page, rejects bad sessions, blocks other files and cross-origin posts | Checked |
| Light theme, PnL card, settings, empty states | Checked |
| Phantom connect and swap signing | Not tested: needs your Phantom extension |
| X feed, trending, KOL alerts, Grok | Not tested: needs your credentials. Written against the documented APIs |
| Automatic cost basis from swaps | Logic written; the test wallets had no recent swaps to confirm it on |
| Alerts firing and Windows toasts | Not triggered during testing |
| CSV export, snapshots, manual trades | Screens render; the save/record actions were not clicked through |

Known cosmetic gaps: no custom app icon yet (default Electron icon), and some token logos hosted on IPFS do not load and fall back to initials.

## 10. Usability and safety update

Added on top of the original build. Same accuracy contract: nothing below introduces sample data.

| Feature | What it does | State |
|---|---|---|
| Degen mode | Header button, `D`, Settings. Always hides dust, ranks by absolute 24h move with SOL and stablecoins last, trims the list to five columns. Saved. | Checked |
| Global search | Ctrl+K searches every holding and watched coin by name, ticker or mint, plus pages and actions; a pasted mint that is not held can be opened directly. Arrow keys, Home/End, Enter. | Checked |
| Same-name warning | Badge on the row and in the detail view when two mints you hold or watch share a ticker. The dialog lists them plus exact-ticker matches from Jupiter, with liquidity and risk level. | Checked on a wallet holding two different TRUMP tokens |
| Developer wallet status | Holding (1% of supply or more), Reduced (under 1%), Sold (none), Unknown. Derived from the deployer's current share only; past sales are not tracked, and the tooltip says so. | Checked |
| Density | Comfortable / Compact, toolbar button, `C`, Settings. Saved. | Checked |
| Reordering | Wallet chips (drag, or Alt + left/right) and pinned tokens (drag, or Alt + up/down). Saved. | Saving and keyboard path checked; mouse dragging not exercised by a real pointer |
| Read-only mode | Lock in the header, `L`, Settings. Swap is disabled in the UI and refused by the backend. Optional Windows Hello / PIN to unlock. | Lock and backend refusal checked. Windows reports Hello as available; the prompt itself was not triggered |
| System tray | Tray icon with total and 24h in the tooltip; menu: Show, Refresh, Mini view, Quit. Options: keep running in tray on close, start minimised. | Starts without errors; not visually confirmed |
| Mini view | Always-on-top window with total and 24h; click to restore. Tray menu, header button, `M`. | Opens without errors; not visually confirmed |
| Feedback | Toasts for pin, density, degen, lock, copy, alerts; crash guard that shows a reload message instead of a blank window. | Checked |
| Local X scanner | Experimental, off by default. Reads X search in a hidden window signed in by the user; one search per coin opened, at most every 25 s, cached 5 min. No techniques to hide the automation. | Gating and error states checked. **Reading real posts is untested**: it needs a signed-in X account |

Deviations from the request, on purpose:
- The scanner uses the browser engine already inside the app instead of Playwright. Playwright would add roughly 300 MB and more unsigned program files, which Smart App Control has already blocked on this PC.
- Trending counts and KOL alerts still need the official X API. The scanner only fills the Alpha Feed, to keep its request volume low.
- Density and degen transitions fade (opacity) rather than animating row height, to stay within the transform-and-opacity rule.

## 11. Benchmarks, first-run screens, and removals

| Change | Detail | State |
|---|---|---|
| Performance vs benchmarks | Portfolio page. Your holdings against SOL, Bitcoin, Ethereum, a meme index, the S&P 500, the Nasdaq 100 and gold over 1D / 7D / 30D / 90D, all rebased to 0% at the start. Chosen benchmarks are saved. | Checked with live data for all seven |
| Meme index | Equal-weight basket of BONK, WIF, TRUMP, PENGU, Fartcoin, POPCAT, PNUT and MEW. A fixed list chosen by hand, not an official index. | Checked |
| Benchmark sources | Crypto from Jupiter (BTC and ETH via their wrapped Solana tokens). Stock indices and gold from Yahoo Finance's chart data, falling back to the tokenised versions on Solana. A benchmark with no data is left out and named, never estimated. | Checked; the fallback path was not triggered |
| First-run screen | Three ways to add a wallet (Phantom on this PC, Phantom on phone, watch an address), what the app does, and what it never asks for. | Checked |
| No-wallet states | Portfolio, Activity and Alpha explain what they need and offer the connect buttons instead of showing empty tables. | Checked |
| Swap removed | No swap page, no quote or transaction code, and the Phantom connect page can no longer sign transactions. The app cannot move funds. | Checked: no swap code remains |
| X API removed | No X sign-in, Client ID, trending counts or KOL tracker. Stored X API credentials are deleted on next start. | Checked: no X API code remains |

Caveats worth knowing:
- "Your bags" in the comparison is today's holdings valued at past prices, so it ignores buys, sells and deposits during the period.
- Benchmarks are price only: no fees, no dividends.
- Stock indices and gold stand still at night and on weekends; crypto does not.
- Yahoo Finance's chart data is not an official public API and could change.
- Read-only mode still exists, but with Swap gone there is currently nothing for it to block.

## 12. Automatic entries

Entries (buys and sells used for average entry and PnL) are now created without any manual input.

| Change | Detail | State |
|---|---|---|
| Background history reading | After each refresh the app reads every wallet's transactions back to the first one (600 per round, up to 5,000 per wallet), then keeps up with new ones. | Checked: 125 transactions read on a real trading wallet |
| Swaps become entries | Each swap becomes a buy or sell at the price actually paid, as it is read. Token-to-token swaps are valued by whichever side had a market price then. | Checked: 99 swaps priced, 97 entries created |
| Received tokens | Optional (on by default): tokens arriving from outside the tracked wallets are entered at the market price at that moment, labelled as an estimate. Moves between tracked wallets are ignored. | Written; no qualifying transfer occurred in the test wallet |
| New transaction format | Solana's "version 1" transactions were being rejected, which silently stalled every history sync. The app now requests them and adapts if the network raises the version again. | Checked: this was the cause of entries not appearing |
| Resilience | One unreadable transaction is skipped and retried next round instead of stopping the whole sync. | Checked |

Limits: on the public RPC this reads roughly one transaction per second, so a busy wallet takes a while the first time. Coins received from an exchange or airdrop have no purchase price on chain; the estimate above is the best available and can be turned off in Settings.

## 13. Rename to Bagscope and release clean-up

| Change | Detail | State |
|---|---|---|
| New name | The app is now Bagscope (was Moonbag). On first start it copies wallets, settings, entries and keys from the old profile. | Checked: 4 wallets and 2,082 entries carried over on this PC |
| Licence | MIT licence added; third-party notices for all 106 bundled packages ship with the app (Settings, About and legal). | Checked |
| Local X scanner | Removed. Its saved browser data is cleared on first start. | Checked: not in the build |
| X API | Restored: sign-in with your own X developer app, Alpha Feed, trending counts, KOL tracker. | Code restored; untested without X credentials |
| Stock and gold benchmarks | Now follow tokenised funds on Solana (SPYx, QQQx, GLDx) through Jupiter instead of Yahoo Finance. | Checked with live data |
| Watchlist refresh | A coin added while a refresh was running now appears straight away instead of a minute later. | Checked |