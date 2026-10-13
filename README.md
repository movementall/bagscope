**Website and download:** https://movementall.github.io/bagscope/

# Bagscope

Multi-wallet Phantom portfolio tracker for meme coin holders. Windows desktop app (Electron + React + TypeScript).

Full product and architecture description: [docs/DESCRIPTION.md](docs/DESCRIPTION.md).

## Run

```bash
npm install
```

```bash
node node_modules/electron/install.js
```

```bash
npm start
```

The second command downloads the Electron runtime; newer npm versions skip it during install.

## Other commands

| Command | What it does |
|---|---|
| `npm run dev` | Hot-reloading UI. Run `npm run build` once first so the Phantom bridge page exists. |
| `npm run build` | Compiles main, preload and renderer into `out/`. |
| `npm run typecheck` | TypeScript check for the whole project. |
| `npm run dist` | Builds the Windows installer `release/Bagscope-Setup-0.1.0.exe` (choose folder, optional desktop shortcut). |
| `npm run icon` | Regenerates `build/icon.ico` and the installer sidebar from `scripts/make-icon.mjs`. |

## First use

1. **Connect Phantom.** Your browser opens a local page; approve the connection and the ownership signature. Switch account in Phantom and press the button again for each additional wallet. Or paste any public address to watch it.
2. **Optional, in Settings:** your own Solana RPC URL (much faster history sync), an xAI API key (Ask Grok), and the experimental local X scanner (posts in each coin's Alpha tab).
3. **Activity → Sync latest** to decode swaps from chain and build cost basis automatically.

## Layout

```
src/shared     types and valuation maths used by both processes
src/main       data layer: store, solana, market, portfolio, alerts, social, bridge
src/preload    the two-function API exposed to the UI
src/renderer   React UI, plus bridge.html (the Wallet Adapter page opened in your browser)
scripts        shot.ps1: launch with an isolated profile and capture screenshots
```

Your data lives in `%APPDATA%\Bagscope`: `bagscope.json` (wallets, settings, trades, snapshots), `cache.json` (last known data), `secrets.bin` (keys, encrypted with Windows DPAPI).
