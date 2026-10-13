import type { Holding, Lot } from './types'

/** Token amount for one wallet, or across all wallets when wallet is null. */
export function amountOf(h: Holding, wallet: string | null): number {
  if (wallet) return h.byWallet[wallet] ?? 0
  let sum = 0
  for (const k in h.byWallet) sum += h.byWallet[k]
  return sum
}

/** USD value shown next to a position. Null when there is no trustworthy price. */
export function valueOf(h: Holding, wallet: string | null): number | null {
  return h.price == null ? null : amountOf(h, wallet) * h.price
}

/** USD value that counts toward portfolio totals (excluded positions count as zero). */
export function countedValue(h: Holding, wallet: string | null): number {
  return h.excluded || h.price == null ? 0 : amountOf(h, wallet) * h.price
}

export function totalValue(holdings: Holding[], wallet: string | null): number {
  let sum = 0
  for (const h of holdings) sum += countedValue(h, wallet)
  return sum
}

export interface Position {
  /** tokens still held according to the recorded buys and sells */
  trackedQty: number
  costBasis: number
  avgCost: number | null
  realized: number
  buys: number
  sells: number
  invested: number
}

/** Average-cost accounting over a token's lots, oldest first. */
export function positionFromLots(lots: Lot[]): Position {
  let qty = 0
  let cost = 0
  let realized = 0
  let buys = 0
  let sells = 0
  let invested = 0
  for (const lot of [...lots].sort((a, b) => a.ts - b.ts)) {
    if (lot.side === 'buy') {
      qty += lot.amount
      cost += lot.amount * lot.priceUsd
      invested += lot.amount * lot.priceUsd
      buys++
    } else {
      const sold = Math.min(lot.amount, qty)
      const avg = qty > 0 ? cost / qty : 0
      realized += sold * (lot.priceUsd - avg)
      cost -= sold * avg
      qty -= sold
      sells++
    }
  }
  if (qty < 1e-12) {
    qty = 0
    cost = 0
  }
  return { trackedQty: qty, costBasis: cost, avgCost: qty > 0 ? cost / qty : null, realized, buys, sells, invested }
}

/** Unrealized PnL on the part of the balance that has a known cost basis. */
export function unrealized(pos: Position, balance: number, price: number | null): number | null {
  if (price == null || pos.avgCost == null) return null
  return Math.min(pos.trackedQty, balance) * (price - pos.avgCost)
}

export function lotsFor(lots: Lot[], mint: string, wallet: string | null): Lot[] {
  return lots.filter((l) => l.mint === mint && (!wallet || !l.wallet || l.wallet === wallet))
}
