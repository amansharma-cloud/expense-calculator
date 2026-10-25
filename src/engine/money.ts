import type { Paise } from './types'

/**
 * Parse a user-typed amount ("1,200", "₹350.5", "Rs 90") into integer paise.
 * Returns null for anything that is not a plain non-negative amount with ≤ 2 decimals.
 */
export function parseAmount(input: string | number): Paise | null {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) return null
    return Math.round(input * 100)
  }
  const cleaned = input.replace(/₹|rs\.?|inr|rupees?/gi, '').replace(/[,\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const [whole, frac = ''] = cleaned.split('.')
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, '0'))
  return Number.isSafeInteger(paise) ? paise : null
}

/** Validation message for an amount field, or null if it is acceptable (must be > 0). */
export function validateAmount(input: string): string | null {
  if (input.trim() === '') return 'Enter an amount'
  const p = parseAmount(input)
  if (p === null) return 'Use digits with at most 2 decimals, e.g. 249.50'
  if (p <= 0) return 'Amount must be greater than zero'
  if (p > 1_000_000_000_00) return 'Amount is too large'
  return null
}

function groupIndian(intStr: string): string {
  if (intStr.length <= 3) return intStr
  const last3 = intStr.slice(-3)
  const rest = intStr.slice(0, -3)
  return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3
}

/** ₹12,34,567.50 style (Indian digit grouping). Decimals only shown when non-zero unless forced. */
export function formatINR(paise: Paise, opts: { decimals?: boolean; symbol?: boolean } = {}): string {
  const neg = paise < 0
  const abs = Math.abs(Math.round(paise))
  const whole = Math.floor(abs / 100)
  const frac = abs % 100
  const showFrac = opts.decimals ?? frac !== 0
  const body = groupIndian(String(whole)) + (showFrac ? '.' + String(frac).padStart(2, '0') : '')
  return (neg ? '-' : '') + (opts.symbol === false ? '' : '₹') + body
}

/** Plain decimal for CSV/XLSX export, e.g. 123456 -> "1234.56". */
export function toDecimalString(paise: Paise): string {
  const neg = paise < 0
  const abs = Math.abs(paise)
  return (neg ? '-' : '') + Math.floor(abs / 100) + '.' + String(abs % 100).padStart(2, '0')
}

export const sum = (xs: Paise[]): Paise => xs.reduce((a, b) => a + b, 0)

/** Integer division rounding toward zero for non-negative splits (never over-recommends). */
export const floorDiv = (a: Paise, b: number): Paise => (b <= 0 ? 0 : Math.floor(a / b))
