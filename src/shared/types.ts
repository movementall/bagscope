// Types shared between the main process (data + secrets) and the renderer (UI).

export const SOL_MINT = 'So11111111111111111111111111111111111111112'
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
export const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
export const STABLES = new Set([USDC_MINT, USDT_MINT])
/** Where voluntary donations to the developer go. Shown in full wherever it is used so it can be checked. */
export const DONATE_ADDRESS = '3iVACqzJpf2cKU3UD6fA4ca2diSATs8J9qvozV9QD7f5'

export interface Wallet {
  address: string
  label: string
  color: string
  /** true when ownership was proven by a Phantom signature, false for watch-only addresses */
  verified: boolean
  addedAt: number
}

export type PriceSource = 'jupiter' | 'dexscreener'
export type ExcludeReason = 'no-price' | 'low-liquidity' | 'exceeds-liquidity'

export interface Holding {
  mint: string
  symbol: string
  name: string
  icon: string | null
  decimals: number
  /** UI amount per wallet address */
  byWallet: Record<string, number>
  price: number | null
  priceSource: PriceSource | null
  change24h: number | null
  liquidity: number | null
  mcap: number | null
  verified: boolean
  /** Set when the position is not counted in totals; the UI always says why. */
  excluded: ExcludeReason | null
}

export interface WalletStatus {
  address: string
  ok: boolean
  /** when this wallet's balances were last read from chain */
  updatedAt: number | null
  error: string | null
}

export interface Portfolio {
  /** time of the last fully successful refresh attempt */
  updatedAt: number | null
  pricesAt: number | null
  holdings: Holding[]
  /** watchlist tokens, priced with the same sources (byWallet is empty) */
  watch: Holding[]
  wallets: WalletStatus[]
  /** true while showing cached data because the last refresh failed */
  offline: boolean
  error: string | null
  refreshing: boolean
}

export interface TokenMeta {
  pinned?: boolean
  tags?: string[]
  note?: string
}

export interface Lot {
  id: string
  mint: string
  wallet: string | null
  side: 'buy' | 'sell'
  amount: number
  priceUsd: number
  ts: number
  source: 'manual' | 'auto'
  sig?: string
  /** how an automatic entry was priced: an actual swap, or a transfer in valued at the market price at that time */
  basis?: 'swap' | 'received'
}

export interface TxChange {
  mint: string
  delta: number
}
export interface TxRecord {
  sig: string
  wallet: string
  ts: number
  type: 'swap' | 'send' | 'receive' | 'other'
  changes: TxChange[]
  fee: number
  failed: boolean
  usdValue: number | null
  symbols: Record<string, string>
  /** exact SOL change including network fees (native + wrapped); absent on records synced before this existed */
  solDelta?: number
}

export interface SnapshotPosition {
  mint: string
  symbol: string
  amount: number
  price: number
  value: number
}
export interface Snapshot {
  id: string
  ts: number
  kind: 'daily' | 'weekly' | 'manual'
  label: string
  total: number
  byWallet: Record<string, number>
  positions: SnapshotPosition[]
}
export interface SeriesPoint {
  ts: number
  total: number
  byWallet: Record<string, number>
}

export type AlertKind = 'price-above' | 'price-below' | 'mcap-above' | 'mcap-below' | 'whale' | 'liquidity-drop'
export interface AlertRule {
  id: string
  kind: AlertKind
  mint: string
  symbol: string
  /** price in USD, market cap in USD, trade size in USD, or drop in % depending on kind */
  value: number
  enabled: boolean
  createdAt: number
  lastFiredAt: number | null
  /** price alerts fire once then disable; others re-arm after a cooldown */
  repeat: boolean
}
export interface Notif {
  id: string
  ts: number
  title: string
  body: string
  mint?: string
  url?: string
  kind: AlertKind | 'kol' | 'system'
  read: boolean
}

export interface Settings {
  theme: 'dark' | 'light'
  accent: string
  hideSmall: boolean
  smallThreshold: number
  /** pools below this USD liquidity are never used for valuation */
  minLiquidity: number
  excludeOverLiquidity: boolean
  refreshSec: number
  autoSnapshot: boolean
  grokModel: string
  kolPollMin: number
  /** read the full transaction history in the background and derive entries from it */
  autoHistory: boolean
  /** treat tokens received from outside as bought at the market price at that moment */
  receivesAsBuys: boolean
  /** benchmark ids shown in the performance comparison */
  benchmarks: string[]
  notifications: boolean
  /** hides dust and ranks the list by 24h volatility */
  degenMode: boolean
  density: 'comfortable' | 'compact'
  /** blocks anything that could start a transaction */
  readOnly: boolean
  /** require Windows Hello / PIN to leave read-only mode */
  lockWithHello: boolean
  closeToTray: boolean
  startMinimized: boolean
}

export interface SecretsStatus {
  rpcCustom: boolean
  rpcHost: string | null
  xaiKey: boolean
  xClientId: boolean
  xUser: string | null
  encrypted: boolean
}

export interface AppState {
  wallets: Wallet[]
  settings: Settings
  tokenMeta: Record<string, TokenMeta>
  tags: string[]
  lots: Lot[]
  watchlist: string[]
  alerts: AlertRule[]
  notifications: Notif[]
  snapshots: Snapshot[]
  series: SeriesPoint[]
  kols: string[]
  /** display order of pinned tokens */
  pinOrder: string[]
  secrets: SecretsStatus
}

export interface PriceHistory {
  /** [unix seconds, close] ascending */
  hour: [number, number][]
  day: [number, number][]
  updatedAt: number
}

export interface RiskFactor {
  key: string
  label: string
  value: string
  points: number
  max: number
  known: boolean
}
export interface TokenInsight {
  mint: string
  symbol: string
  name: string
  icon: string | null
  price: number | null
  change: { m5: number | null; h1: number | null; h6: number | null; h24: number | null }
  volume24h: number | null
  mcap: number | null
  fdv: number | null
  liquidity: number | null
  holders: number | null
  createdAt: number | null
  verified: boolean
  pool: { address: string; dex: string; liquidity: number; url: string; quote: string } | null
  top10Pct: number | null
  lpLockedPct: number | null
  mintAuthority: boolean | null
  freezeAuthority: boolean | null
  rugged: boolean
  /** Deployer wallet and its current share of supply. Status is derived from that share only. */
  dev: { address: string | null; pct: number | null; status: 'Holding' | 'Reduced' | 'Sold' | 'Unknown' }
  rugcheckRisks: { name: string; level: string; description: string }[]
  risk: { level: 'Low' | 'Medium' | 'High' | 'Unknown'; score: number; factors: RiskFactor[]; complete: boolean }
  links: { label: string; url: string }[]
  fetchedAt: number
  errors: string[]
}

export type ChartRange = '1H' | '1D' | '1W' | '1M' | '3M' | 'ALL'
export interface Candle {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

export interface XPost {
  id: string
  text: string
  createdAt: number
  author: { name: string; username: string; avatar: string | null; verified: boolean; followers: number | null }
  metrics: { likes: number; reposts: number; replies: number; views: number | null }
  url: string
}
export interface FeedResult {
  posts: XPost[]
  fetchedAt: number
  source: 'api'
}
export interface GrokAnalysis {
  mint: string
  text: string
  sentiment: 'bullish' | 'bearish' | 'neutral' | null
  sentimentScore: number | null
  citations: string[]
  /** false when Grok answered without live X/web search */
  liveSearch: boolean
  model: string
  fetchedAt: number
}
export interface TrendingItem {
  mint: string
  symbol: string
  posts24h: number
}

export interface PastHolding {
  mint: string
  symbol: string
  name: string
  icon: string | null
  amountThen: number
  amountNow: number
  /** share of the token's current circulating supply that amountThen represents */
  supplyPct: number | null
  /** the transaction history cannot fully explain this balance, so amountThen is not shown as fact */
  incomplete: boolean
  /** SOL rebuilt from older records that did not store network fees */
  approx: boolean
}
export interface PastView {
  ts: number
  rows: PastHolding[]
  wallets: { address: string; covered: boolean; complete: boolean; oldestTs: number | null; txCount: number }[]
}

export interface BenchSeries {
  id: string
  /** [timestamp ms, value] ascending; includes one point before the window when available */
  points: [number, number][]
  source: string
  error: string | null
}

export interface WhaleTrade {
  tx: string
  ts: number
  kind: 'buy' | 'sell'
  usd: number
  maker: string
}

export type AppEvent =
  | { type: 'state'; state: AppState }
  | { type: 'portfolio'; portfolio: Portfolio }
  | { type: 'history'; history: Record<string, PriceHistory> }
  | { type: 'bridge'; status: 'opened' | 'connected' | 'error'; detail?: string }
  | { type: 'notif'; notif: Notif }
  | { type: 'txsync'; wallet: string; done: number; total: number; finished: boolean; error?: string; note?: string }
