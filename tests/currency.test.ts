import { afterEach, describe, expect, it } from 'vitest'
import { makeBackup, parseBackup, transactionsToCSV } from '../src/db/backup'
import { emptyData } from '../src/db/storage'
import { CURRENCIES, formatMoney, getCurrency, setActiveCurrency } from '../src/engine/currency'
import { computeBudget } from '../src/engine/budget'
import { parseAmount } from '../src/engine/money'
import { parseQuickEntry, suggestCategory, DEFAULT_CATEGORIES } from '../src/engine/quick'
import type { Cycle, Plan, Transaction } from '../src/engine/types'

afterEach(() => setActiveCurrency(undefined))

describe('currency formatting', () => {
  it('defaults to INR with lakh/crore grouping', () => {
    expect(getCurrency().code).toBe('INR')
    expect(formatMoney(123456700)).toBe('₹12,34,567')
  })
  it('uses western grouping and the right symbol for CAD and others', () => {
    setActiveCurrency('CAD')
    expect(formatMoney(123456750)).toBe('$1,234,567.50')
    expect(formatMoney(-450)).toBe('-$4.50')
    expect(formatMoney(5, { decimals: true })).toBe('$0.05')
    setActiveCurrency('GBP'); expect(formatMoney(100000)).toBe('£1,000')
    setActiveCurrency('EUR'); expect(formatMoney(100000)).toBe('€1,000')
    setActiveCurrency('AUD'); expect(formatMoney(100000)).toBe('A$1,000')
    setActiveCurrency('AED'); expect(formatMoney(100000)).toBe('AED 1,000')
  })
  it('falls back to INR for an unknown or missing code', () => {
    setActiveCurrency('XXX'); expect(getCurrency().code).toBe('INR')
    setActiveCurrency(undefined); expect(getCurrency().code).toBe('INR')
  })
  it('lists only 2-decimal currencies with unique codes', () => {
    expect(new Set(CURRENCIES.map((c) => c.code)).size).toBe(CURRENCIES.length)
    expect(CURRENCIES.map((c) => c.code)).toContain('CAD')
  })
})

describe('typing amounts in any supported currency', () => {
  it.each([['$4.50', 450], ['CA$12', 1200], ['C$12', null], ['€1,200', 120000], ['£9.99', 999], ['45 cad', 4500], ['USD 20', 2000], ['₹350', 35000], ['Rs 90', 9000], ['12 dollars', 1200]])('%s', (input, expected) => {
    expect(parseAmount(input)).toBe(expected)
  })
  it('quick entry understands dollars and Canadian merchants', () => {
    expect(parseQuickEntry('Tim Hortons $4.50', '2026-10-25')).toMatchObject({ amountPaise: 450, description: 'Tim Hortons', missing: [] })
    expect(parseQuickEntry('Costco 182.35 cad yesterday', '2026-10-25')).toMatchObject({ amountPaise: 18235, date: '2026-10-24', description: 'Costco' })
    expect(parseQuickEntry('Spent €20 on lunch today', '2026-10-25').amountPaise).toBe(2000)
    expect(suggestCategory('Tim Hortons', DEFAULT_CATEGORIES)).toBe('Eating out')
    expect(suggestCategory('Loblaws', DEFAULT_CATEGORIES)).toBe('Food & Grocery')
    expect(suggestCategory('TTC', DEFAULT_CATEGORIES)).toBe('Transport & Fuel')
    expect(suggestCategory('Rogers', DEFAULT_CATEGORIES)).toBe('Recharge & Internet')
    expect(suggestCategory('Uber Eats', DEFAULT_CATEGORIES)).toBe('Eating out')
  })
})

describe('changing currency never changes numbers', () => {
  const cycle: Cycle = { start: '2026-10-01', end: '2026-10-31', takeHomePaise: 500000, extraCreditsPaise: 0, openingCarryPaise: 0, releasedCarryPaise: 0, allocations: [], source: 'app' }
  const t: Transaction = { id: 'a', date: '2026-10-02', time: '10:00', amountPaise: 12345, type: 'expense', category: 'Food', merchant: '', method: 'upi', note: '', source: 'manual', createdAt: '' }
  it('the budget is identical whatever the currency label', () => {
    setActiveCurrency('INR'); const a = computeBudget(cycle, [t], [], '2026-10-05')
    setActiveCurrency('CAD'); const b = computeBudget(cycle, [t], [], '2026-10-05')
    expect(b.todayLimitPaise).toBe(a.todayLimitPaise)
    expect(b.remainingPaise).toBe(a.remainingPaise)
    expect(b.warnings.join(' ')).not.toContain('₹')
  })
  it('exports carry the currency code', () => {
    setActiveCurrency('CAD')
    expect(transactionsToCSV([t]).split('\r\n')[0]).toContain('Amount (CAD)')
  })
  it('backups keep the currency and reject unknown ones', () => {
    const plan: Plan = { currency: 'CAD', salaryDay: 25, takeHomePaise: 1, releasedCarryPaise: 0, allocations: [], categories: [], theme: 'system' }
    const d = { ...emptyData(), plan }
    expect(parseBackup(makeBackup('X', d)).data.plan?.currency).toBe('CAD')
    const bad = JSON.parse(makeBackup('X', d)); bad.data.plan.currency = 'JPY'
    expect(() => parseBackup(JSON.stringify(bad))).toThrow(/unsupported currency/)
  })
})
