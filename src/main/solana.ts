import { SOL_MINT, type TxChange, type TxRecord } from '@shared/types'
import { HttpError, errMsg, fetchJson, limiter } from './http'
import { getSecrets } from './store'

// The public endpoint is rate limited but returns complete data. Endpoints that
// silently return empty results are deliberately not used as fallbacks.
const PUBLIC_RPC = 'https://api.mainnet-beta.solana.com'
const TOKEN_PROGRAMS = [
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
]

const publicGate = limiter(260)
const customGate = limiter(40)

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

export function base58Decode(s: string): Uint8Array {
  const bytes: number[] = [0]
  for (const ch of s) {
    let carry = ALPHABET.indexOf(ch)
    if (carry < 0) throw new Error('Invalid base58 character')
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58
      bytes[i] = carry & 0xff
      carry >>= 8
    }
    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }
  for (const ch of s) {
    if (ch !== '1') break
    bytes.push(0)
  }
  return Uint8Array.from(bytes.reverse())
}

export function base58Encode(buf: Uint8Array): string {
  const digits: number[] = [0]
  for (const byte of buf) {
    let carry = byte
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8
      digits[i] = carry % 58
      carry = (carry / 58) | 0
    }
    while (carry > 0) {
      digits.push(carry % 58)
      carry = (carry / 58) | 0
    }
  }
  let out = ''
  for (const byte of buf) {
    if (byte !== 0) break
    out += '1'
  }
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]]
  return out
}

export function isValidAddress(address: string): boolean {
  try {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) && base58Decode(address).length === 32
  } catch {
    return false
  }
}

async function post<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetchJson<{ result?: T; error?: { message: string; code: number } }>(url, {
    method: 'POST',
    body: { jsonrpc: '2.0', id: 1, method, params },
    retries: 3
  })
  if (res.error) throw new Error(`Solana RPC: ${res.error.message}`)
  if (res.result === undefined) throw new Error('Solana RPC returned no result')
  return res.result
}

export async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const custom = getSecrets().rpcUrl
  if (custom) {
    try {
      return await customGate(() => post<T>(custom, method, params))
    } catch (e) {
      // Only fall back on transport failures; an RPC-level error is a real answer.
      if (!(e instanceof HttpError) && !/network|timed out/.test(errMsg(e))) throw e
    }
  }
  return publicGate(() => post<T>(PUBLIC_RPC, method, params))
}

export interface WalletBalances {
  /** mint -> { amount (UI units), decimals }. Native SOL and wrapped SOL are merged under SOL_MINT. */
  tokens: Record<string, { amount: number; decimals: number; accounts?: string[] }>
}

interface ParsedTokenAccount {
  pubkey: string
  account: {
    data: { parsed: { info: { mint: string; tokenAmount: { amount: string; decimals: number } } } }
  }
}

export async function getWalletBalances(address: string): Promise<WalletBalances> {
  const raw = new Map<string, { raw: bigint; decimals: number; accounts: string[] }>()
  const lamports = await rpc<{ value: number }>('getBalance', [address, { commitment: 'confirmed' }])
  raw.set(SOL_MINT, { raw: BigInt(lamports.value), decimals: 9, accounts: [] })

  for (const programId of TOKEN_PROGRAMS) {
    const res = await rpc<{ value: ParsedTokenAccount[] }>('getTokenAccountsByOwner', [
      address,
      { programId },
      { encoding: 'jsonParsed', commitment: 'confirmed' }
    ])
    for (const acc of res.value) {
      const info = acc.account.data.parsed.info
      const amount = BigInt(info.tokenAmount.amount)
      if (amount === 0n) continue
      const prev = raw.get(info.mint)
      raw.set(info.mint, { raw: (prev?.raw ?? 0n) + amount, decimals: info.tokenAmount.decimals, accounts: [...(prev?.accounts ?? []), acc.pubkey] })
    }
  }

  const tokens: WalletBalances['tokens'] = {}
  for (const [mint, { raw: amount, decimals, accounts }] of raw) {
    // Split integer/fraction before converting so large raw amounts keep precision.
    const base = 10n ** BigInt(decimals)
    tokens[mint] = { amount: Number(amount / base) + Number(amount % base) / Number(base), decimals, accounts }
  }
  return { tokens }
}

// ---------- transaction history ----------

export interface SigInfo {
  signature: string
  blockTime: number | null
  err: unknown
}

export function getSignatures(address: string, limit: number, before?: string): Promise<SigInfo[]> {
  return rpc<SigInfo[]>('getSignaturesForAddress', [address, { limit, ...(before ? { before } : {}) }])
}

interface RpcTokenBalance {
  mint: string
  owner?: string
  uiTokenAmount: { uiAmountString: string }
}
interface RpcTx {
  blockTime: number | null
  meta: {
    err: unknown
    fee: number
    preBalances: number[]
    postBalances: number[]
    preTokenBalances?: RpcTokenBalance[]
    postTokenBalances?: RpcTokenBalance[]
  } | null
  transaction: { message: { accountKeys: { pubkey: string }[] } }
}

/** Highest transaction format requested from the node. Raised automatically when the node reports a newer one. */
let txVersion = 1

/** Reads the wallet's net balance changes from one transaction. Returns null if the node has pruned it. */
export async function getTxRecord(sig: string, wallet: string): Promise<Omit<TxRecord, 'usdValue' | 'symbols'> | null> {
  const fetchTx = (): Promise<RpcTx | null> => rpc<RpcTx | null>('getTransaction', [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: txVersion, commitment: 'confirmed' }])
  let tx: RpcTx | null
  try {
    tx = await fetchTx()
  } catch (e) {
    // Solana adds transaction formats over time; the node says which version it needs, so adopt it and retry.
    const wanted = /maxSupportedTransactionVersion\\?"?:\s*(\d+)/.exec(errMsg(e))
    if (!wanted || Number(wanted[1]) <= txVersion) throw e
    txVersion = Number(wanted[1])
    tx = await fetchTx()
  }
  if (!tx?.meta) return null
  const { meta } = tx
  const deltas = new Map<string, number>()
  const add = (mint: string, d: number): void => void deltas.set(mint, (deltas.get(mint) ?? 0) + d)

  const idx = tx.transaction.message.accountKeys.findIndex((k) => k.pubkey === wallet)
  if (idx >= 0) {
    let lamports = meta.postBalances[idx] - meta.preBalances[idx]
    if (idx === 0) lamports += meta.fee // show the trade, not the network fee
    add(SOL_MINT, lamports / 1e9)
  }
  for (const b of meta.preTokenBalances ?? []) if (b.owner === wallet) add(b.mint, -Number(b.uiTokenAmount.uiAmountString))
  for (const b of meta.postTokenBalances ?? []) if (b.owner === wallet) add(b.mint, Number(b.uiTokenAmount.uiAmountString))

  // Exact SOL movement for rebuilding past balances: fee included, wrapped SOL counted, nothing filtered.
  const solDelta = (deltas.get(SOL_MINT) ?? 0) - (idx === 0 ? meta.fee / 1e9 : 0)
  let changes: TxChange[] = [...deltas].map(([mint, delta]) => ({ mint, delta })).filter((c) => Math.abs(c.delta) > 1e-12)
  // Token-to-token swaps still move a little SOL (account rent); that is not a leg of the trade.
  const nonSol = changes.filter((c) => c.mint !== SOL_MINT)
  if (nonSol.some((c) => c.delta > 0) && nonSol.some((c) => c.delta < 0)) {
    changes = changes.filter((c) => c.mint !== SOL_MINT || Math.abs(c.delta) >= 0.01)
  } else {
    changes = changes.filter((c) => c.mint !== SOL_MINT || Math.abs(c.delta) >= 0.000006)
  }
  const ins = changes.filter((c) => c.delta > 0)
  const outs = changes.filter((c) => c.delta < 0)
  const type = ins.length && outs.length ? 'swap' : ins.length ? 'receive' : outs.length ? 'send' : 'other'
  return { sig, wallet, ts: (tx.blockTime ?? 0) * 1000, type, changes, fee: meta.fee / 1e9, failed: !!meta.err, solDelta }
}

// ---------- endpoint health ----------

export interface RpcReport {
  ok: boolean
  custom: boolean
  host: string
  ms: number | null
  detail: string
}

/** Speed check always; the completeness checks need one of the user's own wallets to compare on. */
async function probe(url: string, address: string | undefined): Promise<{ ms: number; tokens: number; sigs: number }> {
  const t0 = Date.now()
  await post<number>(url, 'getSlot', [])
  const ms = Date.now() - t0
  if (!address) return { ms, tokens: 0, sigs: 0 }
  const tokens = await post<{ value: unknown[] }>(url, 'getTokenAccountsByOwner', [address, { programId: TOKEN_PROGRAMS[0] }, { encoding: 'jsonParsed' }])
  const sigs = await post<unknown[]>(url, 'getSignaturesForAddress', [address, { limit: 5 }])
  return { ms, tokens: tokens.value.length, sigs: sigs.length }
}

/**
 * Checks an endpoint against the public one using a real wallet. Some free endpoints
 * answer quickly but silently return no token accounts or no history; those would make
 * balances look empty, so they are rejected.
 */
export async function testRpc(url: string | undefined, address?: string): Promise<RpcReport> {
  const target = url ?? PUBLIC_RPC
  const host = new URL(target).host
  let mine: Awaited<ReturnType<typeof probe>>
  try {
    mine = await probe(target, address)
  } catch (e) {
    return { ok: false, custom: !!url, host, ms: null, detail: `Did not answer correctly: ${errMsg(e)}` }
  }
  if (!url) return { ok: true, custom: false, host, ms: mine.ms, detail: `Public endpoint is working (${mine.ms} ms). It is rate limited, so history sync is slow.` }
  const ref = await publicGate(() => probe(PUBLIC_RPC, address)).catch(() => null)
  if (ref && mine.tokens < ref.tokens) {
    return { ok: false, custom: true, host, ms: mine.ms, detail: `This endpoint returned ${mine.tokens} token accounts where the public one returns ${ref.tokens}. It would show wrong balances, so it was not saved.` }
  }
  if (ref && ref.sigs > 0 && mine.sigs === 0) {
    return { ok: false, custom: true, host, ms: mine.ms, detail: 'This endpoint returns no transaction history, so it was not saved.' }
  }
  if (!address) return { ok: true, custom: true, host, ms: mine.ms, detail: `Responding (${mine.ms} ms). Its token data is checked against the public endpoint once you have added a wallet; use Test connection then.` }
  return { ok: true, custom: true, host, ms: mine.ms, detail: `Working (${mine.ms} ms) and returns complete token data${ref ? '' : ' (could not cross-check against the public endpoint right now)'}.` }
}