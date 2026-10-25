import { formatMoney } from './currency'
import type { Paise } from './types'

/** Currency symbols/words a person might type next to an amount. */
export const CURRENCY_MARKS = /(?:ca|a|nz|s|us)?\$|[₹€£]|\b(?:rs|inr|rupees?|cad|usd|gbp|eur|aud|nzd|aed|sgd|dollars?|bucks?)\b\.?/gi

/**
 * Parse a user-typed amount ("1,200", "₹350.5", "Rs 90") into integer paise.
 * Returns null for anything that is not a plain non-negative amount with ≤ 2 decimals.
 */
export function parseAmount(input: string | number): Paise | null {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) return null
    return Math.round(input * 100)
  }
  const cleaned = input.replace(CURRENCY_MARKS, '').replace(/[,\s]/g, '')
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

/** Kept for existing callers: formats in the active profile currency (INR by default). */
export const formatINR = formatMoney
export { formatMoney }

/** Plain decimal for CSV/XLSX export, e.g. 123456 -> "1234.56". */
export function toDecimalString(paise: Paise): string {
  const neg = paise < 0
  const abs = Math.abs(paise)
  return (neg ? '-' : '') + Math.floor(abs / 100) + '.' + String(abs % 100).padStart(2, '0')
}

export const sum = (xs: Paise[]): Paise => xs.reduce((a, b) => a + b, 0)

/** Integer division rounding toward zero for non-negative splits (never over-recommends). */
export const floorDiv = (a: Paise, b: number): Paise => (b <= 0 ? 0 : Math.floor(a / b))
