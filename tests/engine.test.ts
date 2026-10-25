import { describe, expect, it } from 'vitest'
import { allocationPaid, closingBalance, computeBudget, dailySeries, findDuplicates, spendByCategory } from '../src/engine/budget'
import { addDays, cycleBounds, diffDays, isValidDate } from '../src/engine/dates'
import { formatINR, parseAmount, toDecimalString, validateAmount } from '../src/engine/money'
import { parseQuickEntry, suggestCategory, DEFAULT_CATEGORIES } from '../src/engine/quick'
import type { Cycle, Transaction } from '../src/engine/types'

const R = (n: number) => Math.round(n * 100)

let seq = 0
const tx = (p: Partial<Transaction> & { date: string; amountPaise: number }): Transaction => ({
  id: 't' + ++seq,
  time: '12:00',
  type: 'expense',
  category: 'Food & Grocery',
  merchant: '',
  method: 'upi',
  note: '',
  source: 'manual',
  createdAt: '',
  ...p,
})

// 30-day cycle 25 Sep → 24 Oct, ₹80,000 salary: 15k savings + 10k invest + 20k fixed => ₹35,000 spendable.
const cycle = (over: Partial<Cycle> = {}): Cycle => ({
  start: '2026-09-25',
  end: '2026-10-25',
  takeHomePaise: R(80000),
  extraCreditsPaise: 0,
  openingCarryPaise: R(500000),
  releasedCarryPaise: 0,
  source: 'app',
  allocations: [
    { id: 'sav', name: 'Savings', kind: 'reserved', amountPaise: R(15000) },
    { id: 'mf', name: 'Mutual fund', kind: 'investment', amountPaise: R(10000) },
    { id: 'rent', name: 'Rent', kind: 'fixed', amountPaise: R(20000) },
  ],
  ...over,
})

describe('money', () => {
  it('parses amounts into integer paise without float error', () => {
    expect(parseAmount('1,200')).toBe(120000)
    expect(parseAmount('₹350.5')).toBe(35050)
    expect(parseAmount('Rs 90')).toBe(9000)
    expect(parseAmount('0.1')).toBe(10)
    expect(parseAmount('19.99')).toBe(1999)
    expect(parseAmount(15046.61)).toBe(1504661)
  })
  it('rejects invalid, negative and over-precise input', () => {
    for (const bad of ['', 'abc', '-5', '1.234', '1e5', '12..3']) expect(parseAmount(bad)).toBeNull()
    expect(parseAmount(-1)).toBeNull()
    expect(parseAmount(NaN)).toBeNull()
    expect(validateAmount('0')).toMatch(/greater than zero/)
    expect(validateAmount('')).toMatch(/Enter/)
    expect(validateAmount('250')).toBeNull()
  })
  it('formats with Indian grouping', () => {
    expect(formatINR(R(1234567))).toBe('₹12,34,567')
    expect(formatINR(R(999))).toBe('₹999')
    expect(formatINR(123456789)).toBe('₹12,34,567.89')
    expect(formatINR(-R(1500.5))).toBe('-₹1,500.50')
    expect(toDecimalString(123456)).toBe('1234.56')
  })
})

describe('cycles and dates', () => {
  it('finds the cycle for a date', () => {
    expect(cycleBounds('2026-10-24', 25)).toEqual({ start: '2026-09-25', end: '2026-10-25' })
    expect(cycleBounds('2026-10-25', 25)).toEqual({ start: '2026-10-25', end: '2026-11-25' })
    expect(cycleBounds('2026-01-10', 25)).toEqual({ start: '2025-12-25', end: '2026-01-25' })
  })
  it('handles different month lengths and a salary day that does not exist', () => {
    expect(diffDays('2026-02-25', '2026-03-25')).toBe(28)
    expect(cycleBounds('2026-03-01', 31)).toEqual({ start: '2026-02-28', end: '2026-03-31' })
    expect(cycleBounds('2028-03-01', 31)).toEqual({ start: '2028-02-29', end: '2028-03-31' }) // leap year
    expect(cycleBounds('2026-05-31', 31).end).toBe('2026-06-30')
  })
  it('validates dates', () => {
    expect(isValidDate('2026-02-29')).toBe(false)
    expect(isValidDate('2028-02-29')).toBe(true)
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
})

describe('daily allowance', () => {
  it('matches the worked example: ₹35,000 over 30 days', () => {
    const b = computeBudget(cycle(), [], [], '2026-09-25')
    expect(b.spendablePaise).toBe(R(35000))
    expect(b.cycleDays).toBe(30)
    expect(b.originalDailyPaise).toBe(Math.floor(R(35000) / 30))
    expect(b.todayLimitPaise).toBe(Math.floor(R(35000) / 30))
    expect(b.status).toBe('on-track')
  })
  it('never uses allocated money or the carry-over reserve', () => {
    const b = computeBudget(cycle(), [], [], '2026-09-25')
    expect(b.spendablePaise).toBe(R(80000 - 45000))
    expect(b.poolPaise).toBe(R(80000)) // opening carry of ₹5,00,000 is NOT in the pool
  })
  it('adds only the released slice of carry-over', () => {
    const b = computeBudget(cycle({ releasedCarryPaise: R(25000) }), [], [], '2026-09-25')
    expect(b.spendablePaise).toBe(R(60000))
  })
  it('raises tomorrow’s limit after underspending and lowers it after overspending', () => {
    const original = computeBudget(cycle(), [], [], '2026-09-25').todayLimitPaise // ≈ ₹1,166 (35,000 ÷ 30)
    const under = computeBudget(cycle(), [tx({ date: '2026-09-25', amountPaise: R(200) })], [], '2026-09-26').todayLimitPaise
    const over = computeBudget(cycle(), [tx({ date: '2026-09-25', amountPaise: R(5000) })], [], '2026-09-26').todayLimitPaise
    expect(under).toBe(Math.floor(R(34800) / 29))
    expect(under).toBeGreaterThan(original)
    expect(over).toBe(Math.floor(R(30000) / 29))
    expect(over).toBeLessThan(original)
  })
  it('keeps today’s limit stable while spending during the day, and reports what is left', () => {
    const t = [tx({ date: '2026-10-01', amountPaise: R(500) })]
    const b = computeBudget(cycle(), t, [], '2026-10-01')
    const before = computeBudget(cycle(), [], [], '2026-10-01')
    expect(b.todayLimitPaise).toBe(before.todayLimitPaise)
    expect(b.todayRemainingPaise).toBe(before.todayLimitPaise - R(500))
    expect(b.todaySpentPaise).toBe(R(500))
  })
  it('reserves upcoming planned bills and does not double count once paid', () => {
    const planned = [{ id: 'p1', title: 'Insurance', amountPaise: R(3000), dueDate: '2026-10-10', done: false }]
    const open = computeBudget(cycle(), [], planned, '2026-09-25')
    expect(open.remainingPaise).toBe(R(32000))
    expect(open.plannedUnpaidPaise).toBe(R(3000))
    const paidTx = [tx({ date: '2026-10-10', amountPaise: R(3000), plannedId: 'p1' })]
    const paid = computeBudget(cycle(), paidTx, [{ ...planned[0], done: true }], '2026-10-10')
    expect(paid.remainingPaise).toBe(R(32000)) // same money, now recorded as spent
  })
  it('floors at zero and flags exhausted when overspent', () => {
    const b = computeBudget(cycle(), [tx({ date: '2026-10-02', amountPaise: R(36000) })], [], '2026-10-03')
    expect(b.status).toBe('exhausted')
    expect(b.todayLimitPaise).toBe(0)
    expect(b.remainingPaise).toBe(-R(1000))
  })
  it('flags today as over the limit', () => {
    const b = computeBudget(cycle(), [tx({ date: '2026-10-01', amountPaise: R(2000) })], [], '2026-10-01')
    expect(b.status).toBe('over')
    expect(b.warnings.join(' ')).toMatch(/over the limit/)
  })
  it('warns at 80% utilisation', () => {
    const b = computeBudget(cycle(), [tx({ date: '2026-10-05', amountPaise: R(29000) })], [], '2026-10-10')
    expect(b.utilizationPct).toBeGreaterThanOrEqual(80)
    expect(b.status).not.toBe('on-track')
  })
  it('limit on the last day equals everything that is left', () => {
    const b = computeBudget(cycle(), [tx({ date: '2026-10-10', amountPaise: R(10000) })], [], '2026-10-24')
    expect(b.daysLeft).toBe(1)
    expect(b.todayLimitPaise).toBe(R(25000))
  })
  it('handles before-start and after-end', () => {
    expect(computeBudget(cycle(), [], [], '2026-09-20').status).toBe('not-started')
    const ended = computeBudget(cycle(), [], [], '2026-10-25')
    expect(ended.status).toBe('ended')
    expect(ended.todayLimitPaise).toBe(0)
  })
  it('works in a 28-day February cycle', () => {
    const c = cycle({ start: '2026-02-25', end: '2026-03-25' })
    expect(computeBudget(c, [], [], '2026-02-25').cycleDays).toBe(28)
    expect(computeBudget(c, [], [], '2026-03-24').daysLeft).toBe(1)
  })
  it('warns instead of silently assuming records are complete', () => {
    const b = computeBudget(cycle(), [tx({ date: '2026-09-26', amountPaise: R(100) })], [], '2026-10-05')
    expect(b.warnings.join(' ')).toMatch(/No spending recorded for/)
  })
})

describe('what counts as spending', () => {
  const t0 = '2026-10-02'
  it('refunds give budget back', () => {
    const b = computeBudget(cycle(), [tx({ date: t0, amountPaise: R(1000) }), tx({ date: t0, amountPaise: R(400), type: 'refund' })], [], t0)
    expect(b.variableSpentPaise).toBe(R(600))
  })
  it('ignores transfers such as credit-card bill payments', () => {
    const b = computeBudget(cycle(), [tx({ date: t0, amountPaise: R(9000), type: 'transfer', category: 'Credit card bill' })], [], t0)
    expect(b.variableSpentPaise).toBe(0)
  })
  it('one-off income increases the pool', () => {
    const b = computeBudget(cycle(), [tx({ date: t0, amountPaise: R(5000), type: 'income' })], [], t0)
    expect(b.spendablePaise).toBe(R(40000))
  })
  it('a rent payment settles the allocation and is not spending', () => {
    const t = [tx({ date: t0, amountPaise: R(20000), allocationId: 'rent', category: 'Rent' })]
    const b = computeBudget(cycle(), t, [], t0)
    expect(b.variableSpentPaise).toBe(0)
    expect(b.remainingPaise).toBe(R(35000))
    expect(allocationPaid(cycle(), t).rent).toBe(R(20000))
  })
  it('only the amount above plan is taken from the spendable budget', () => {
    const t = [tx({ date: t0, amountPaise: R(21500), allocationId: 'rent', category: 'Rent' })]
    const b = computeBudget(cycle(), t, [], t0)
    expect(b.allocationOverrunPaise).toBe(R(1500))
    expect(b.remainingPaise).toBe(R(33500))
  })
  it('deleting or editing a transaction recalculates consistently', () => {
    const a = tx({ date: t0, amountPaise: R(1000) })
    const withIt = computeBudget(cycle(), [a], [], t0).remainingPaise
    const without = computeBudget(cycle(), [], [], t0).remainingPaise
    const edited = computeBudget(cycle(), [{ ...a, amountPaise: R(400) }], [], t0).remainingPaise
    expect(without - withIt).toBe(R(1000))
    expect(without - edited).toBe(R(400))
  })
})

describe('history is not rewritten by new settings', () => {
  it('a closed cycle keeps its own snapshot', () => {
    const old = cycle()
    const before = computeBudget(old, [], [], '2026-10-24')
    const newPlan = { ...old, takeHomePaise: R(200000) } // a *different* cycle object, as the app does
    expect(newPlan.takeHomePaise).not.toBe(old.takeHomePaise)
    expect(computeBudget(old, [], [], '2026-10-24').spendablePaise).toBe(before.spendablePaise)
  })
})

describe('closing balance (carry-over)', () => {
  it('opening + income − allocations − spending', () => {
    const t = [tx({ date: '2026-10-02', amountPaise: R(1000) }), tx({ date: '2026-10-03', amountPaise: R(5000), type: 'income' })]
    expect(closingBalance(cycle(), t)).toBe(R(500000 + 80000 + 5000 - 45000 - 1000))
  })
  it('ignores transactions outside the cycle', () => {
    expect(closingBalance(cycle(), [tx({ date: '2026-08-01', amountPaise: R(999) })])).toBe(R(535000))
  })
})

describe('series, categories, duplicates', () => {
  it('builds a cumulative series up to today', () => {
    const s = dailySeries(cycle(), [tx({ date: '2026-09-25', amountPaise: R(100) }), tx({ date: '2026-09-27', amountPaise: R(300) })], '2026-09-27')
    expect(s).toHaveLength(3)
    expect(s[2].cumulativePaise).toBe(R(400))
    expect(s[2].remainingPaise).toBe(R(35000 - 400))
  })
  it('groups spend by category net of refunds', () => {
    const r = spendByCategory([
      tx({ date: '2026-10-01', amountPaise: R(500), category: 'A' }),
      tx({ date: '2026-10-01', amountPaise: R(100), category: 'A', type: 'refund' }),
      tx({ date: '2026-10-01', amountPaise: R(50), category: 'B' }),
    ])
    expect(r).toEqual([{ category: 'A', paise: R(400) }, { category: 'B', paise: R(50) }])
  })
  it('detects likely duplicates', () => {
    const a = tx({ date: '2026-10-01', amountPaise: R(250), merchant: 'Uber' })
    const b = tx({ date: '2026-10-01', amountPaise: R(250), merchant: 'uber' })
    expect(findDuplicates([a, b, tx({ date: '2026-10-02', amountPaise: R(250), merchant: 'Uber' })])).toHaveLength(1)
  })
})

describe('quick entry', () => {
  const today = '2026-10-25'
  it('parses natural language', () => {
    const p = parseQuickEntry('Spent ₹350 on groceries today', today)
    expect(p).toMatchObject({ amountPaise: 35000, date: today, description: 'groceries', missing: [] })
    expect(parseQuickEntry('Uber 250 yesterday', today)).toMatchObject({ amountPaise: 25000, date: '2026-10-24', description: 'Uber' })
    expect(parseQuickEntry('Lunch at office – ₹180', today)).toMatchObject({ amountPaise: 18000, description: 'Lunch office' })
    expect(parseQuickEntry('Netflix 649', today).amountPaise).toBe(64900)
  })
  it('asks only for what is missing', () => {
    expect(parseQuickEntry('groceries', today).missing).toEqual(['amount'])
    expect(parseQuickEntry('₹200', today).missing).toEqual(['description'])
  })
  it('suggests categories from keywords, mapped onto the profile’s own names', () => {
    expect(suggestCategory('Uber', DEFAULT_CATEGORIES)).toBe('Transport & Fuel')
    expect(suggestCategory('Netflix', DEFAULT_CATEGORIES)).toBe('Subscriptions')
    expect(suggestCategory('Electricity bill', DEFAULT_CATEGORIES)).toBe('Bills & Utilities')
    expect(suggestCategory('Lunch at office', DEFAULT_CATEGORIES)).toBe('Eating out')
    expect(suggestCategory('milk', ['Food/Grocery', 'Shopping'])).toBe('Food/Grocery')
    expect(suggestCategory('zzzz', DEFAULT_CATEGORIES)).toBeNull()
  })
  it('learns from previous transactions', () => {
    const hist = [tx({ date: '2026-10-01', amountPaise: 100, merchant: 'Ramesh Store', category: 'Family' })]
    expect(suggestCategory('Ramesh Store', DEFAULT_CATEGORIES, hist)).toBe('Family')
  })
})
