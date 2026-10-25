import type { Paise } from './types'

/**
 * Supported currencies. All use 2 decimals, so every amount stays an integer in minor units
 * (paise for INR, cents for CAD/USD…). The currency only changes how amounts are written and parsed;
 * changing it never converts a stored number.
 */
export type CurrencyCode = 'INR' | 'CAD' | 'USD' | 'GBP' | 'EUR' | 'AUD' | 'NZD' | 'AED' | 'SGD'

export interface Currency {
  code: CurrencyCode
  name: string
  symbol: string
  /** Digit grouping: 12,34,567 (indian) or 1,234,567 (western) */
  group: 'indian' | 'western'
  /** Put a space between the symbol and the number (for code-like symbols such as "AED") */
  spaced?: boolean
}

export const CURRENCIES: Currency[] = [
  { code: 'INR', name: 'Indian rupee', symbol: '₹', group: 'indian' },
  { code: 'CAD', name: 'Canadian dollar', symbol: '$', group: 'western' },
  { code: 'USD', name: 'US dollar', symbol: '$', group: 'western' },
  { code: 'GBP', name: 'British pound', symbol: '£', group: 'western' },
  { code: 'EUR', name: 'Euro', symbol: '€', group: 'western' },
  { code: 'AUD', name: 'Australian dollar', symbol: 'A$', group: 'western' },
  { code: 'NZD', name: 'New Zealand dollar', symbol: 'NZ$', group: 'western' },
  { code: 'SGD', name: 'Singapore dollar', symbol: 'S$', group: 'western' },
  { code: 'AED', name: 'UAE dirham', symbol: 'AED', group: 'western', spaced: true },
]

export const isCurrencyCode = (c: unknown): c is CurrencyCode => CURRENCIES.some((x) => x.code === c)
export const currencyOf = (code: string | undefined): Currency => CURRENCIES.find((c) => c.code === code) ?? CURRENCIES[0]

/**
 * The profile's currency, set once by the store whenever the open profile's plan changes, so every screen
 * formats the same way without passing it through each component.
 */
let active: Currency = CURRENCIES[0]
export const setActiveCurrency = (code: string | undefined) => { active = currencyOf(code) }
export const getCurrency = (): Currency => active

function group(intStr: string, style: Currency['group']): string {
  if (intStr.length <= 3) return intStr
  if (style === 'western') return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const last3 = intStr.slice(-3)
  return intStr.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3
}

/** ₹12,34,567.50 or $1,234,567.50 depending on the active currency. Decimals shown only when non-zero unless forced. */
export function formatMoney(minor: Paise, opts: { decimals?: boolean; symbol?: boolean; currency?: Currency } = {}): string {
  const cur = opts.currency ?? active
  const neg = minor < 0
  const abs = Math.abs(Math.round(minor))
  const whole = Math.floor(abs / 100)
  const frac = abs % 100
  const showFrac = opts.decimals ?? frac !== 0
  const body = group(String(whole), cur.group) + (showFrac ? '.' + String(frac).padStart(2, '0') : '')
  const sym = opts.symbol === false ? '' : cur.symbol + (cur.spaced ? ' ' : '')
  return (neg ? '-' : '') + sym + body
}
