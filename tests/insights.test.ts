import { describe, expect, it } from 'vitest'
import { computeBudget } from '../src/engine/budget'
import { compareWithPrevious, smartTips, upcomingItems } from '../src/engine/insights'
import type { Cycle, PlannedItem, Transaction } from '../src/engine/types'
import { categoryStyle } from '../src/ui/categoryStyle'

const R = (n: number) => Math.round(n * 100)
const mk = (start: string, end: string, extra: Partial<Cycle> = {}): Cycle => ({
  start, end, takeHomePaise: R(100000), extraCreditsPaise: 0, openingCarryPaise: 0, releasedCarryPaise: 0, source: 'app', allocations: [], ...extra,
})
const tx = (id: string, date: string, amount: number, extra: Partial<Transaction> = {}): Transaction => ({
  id, date, time: '10:00', amountPaise: R(amount), type: 'expense', category: 'Food', merchant: '', method: 'upi', note: '', source: 'manual', createdAt: '', ...extra,
})

describe('compare with the previous cycle', () => {
  const prev = mk('2026-09-25', '2026-10-25')
  const cur = mk('2026-10-25', '2026-11-25')
  it('compares the same number of days', () => {
    const txs = [tx('p1', '2026-09-26', 1000), tx('p2', '2026-10-10', 9000), tx('c1', '2026-10-25', 600), tx('c2', '2026-10-26', 600)]
    const c = compareWithPrevious(cur, [prev, cur], txs, '2026-10-26')!
    expect(c.prevSpentPaise).toBe(R(1000)) // only the first two days of last cycle
    expect(c.spentPaise).toBe(R(1200))
    expect(c.deltaPct).toBe(20)
  })
  it('pro-rates imported months, which only have one total per item', () => {
    const imported = mk('2026-09-25', '2026-10-25', { source: 'import' })
    const txs = [tx('p', '2026-10-24', 30000), tx('c', '2026-10-25', 500)]
    const c = compareWithPrevious(cur, [imported, cur], txs, '2026-10-25')!
    expect(c.prevSpentPaise).toBe(R(1000)) // 30,000 × 1/30
  })
  it('has nothing to say without a previous cycle or without spending', () => {
    expect(compareWithPrevious(cur, [cur], [tx('c', '2026-10-25', 5)], '2026-10-25')).toBeNull()
    expect(compareWithPrevious(cur, [prev, cur], [], '2026-10-25')).toBeNull()
  })
  it('ignores set-aside payments and transfers', () => {
    const txs = [tx('a', '2026-10-25', 500, { allocationId: 'x' }), tx('b', '2026-10-25', 900, { type: 'transfer' }), tx('p', '2026-09-25', 100)]
    const c = compareWithPrevious(cur, [prev, cur], txs, '2026-10-25')!
    expect(c.spentPaise).toBe(0)
  })
})

describe('upcoming bills', () => {
  const cycle = mk('2026-10-25', '2026-11-25', {
    allocations: [
      { id: 'rent', name: 'Rent', kind: 'fixed', amountPaise: R(23000), dueDay: 1 },
      { id: 'mom', name: 'Mom', kind: 'fixed', amountPaise: R(20000) },
      { id: 'emi', name: 'Car EMI', kind: 'fixed', amountPaise: R(8000), dueDay: 5 },
    ],
  })
  const elec: PlannedItem = { id: 'exp-e-2026-10-25', title: 'Electricity', amountPaise: R(1800), dueDate: '2026-11-04', done: false }
  it('lists reserved bills and dated set-asides soonest first, skipping undated and paid ones', () => {
    const u = upcomingItems(cycle, [elec, { ...elec, id: 'x', done: true }], { emi: R(8000) }, '2026-10-30')
    expect(u.map((i) => [i.title, i.date, i.daysUntil])).toEqual([['Rent', '2026-11-01', 2], ['Electricity', '2026-11-04', 5]])
    expect(u[1].expected).toBe(true)
  })
  it('shows what is left of a part-paid set-aside and flags overdue ones', () => {
    const u = upcomingItems(cycle, [], { rent: R(10000) }, '2026-11-03')
    expect(u[0]).toMatchObject({ title: 'Rent', amountPaise: R(13000), daysUntil: -2 })
  })
})

describe('smart tips', () => {
  const cycle = mk('2026-10-25', '2026-11-25')
  const base = (today: string, txs: Transaction[]) => ({ budget: computeBudget(cycle, txs, [], today), cycle, txs, today })
  it('warns about a bill due soon first', () => {
    const upcoming = [{ key: 'k', kind: 'planned' as const, id: 'i', title: 'Electricity', amountPaise: R(1800), date: '2026-10-28', daysUntil: 2, expected: true }]
    const tips = smartTips({ ...base('2026-10-26', [tx('a', '2026-10-26', 10)]), upcoming, comparison: null })
    expect(tips[0].text).toMatch(/Electricity is due in 2 days/)
  })
  it('flags missing records, trend and being ahead of plan', () => {
    expect(smartTips({ ...base('2026-10-30', [tx('a', '2026-10-25', 10)]), upcoming: [], comparison: null }).some((t) => t.id === 'gap')).toBe(true)
    const cmp = { prevSpentPaise: R(1000), spentPaise: R(700), deltaPaise: -R(300), deltaPct: -30 }
    const t = smartTips({ ...base('2026-10-27', [tx('a', '2026-10-27', 1)]), upcoming: [], comparison: cmp })
    expect(t.find((x) => x.id === 'trend')).toMatchObject({ tone: 'good' })
    expect(t.find((x) => x.id === 'trend')!.text).toMatch(/30% less/)
  })
  it('always returns something', () => {
    const t = smartTips({ ...base('2026-10-25', []), upcoming: [], comparison: null })
    expect(t.length).toBeGreaterThan(0)
  })
})

describe('category icons and colours', () => {
  it('recognises the common ones, including your sheet’s names', () => {
    const c = (n: string) => categoryStyle(n).concept
    expect(c('Rent')).toBe('home')
    expect(c('Electricity Bill')).toBe('utilities')
    expect(c('Recharge Airtel/Jio')).toBe('phone')
    expect(c('Mutual Fund 2')).toBe('mutual-fund')
    expect(c('HDFC RD')).toBe('hdfc')
    expect(c('Car EMI')).toBe('car-emi')
    expect(['Netflix', 'Amazon Prime', 'Hotstar', 'Sony Liv', 'YouTube Premium', 'KodeKloud'].map(c)).toEqual(['netflix', 'prime', 'hotstar', 'sonyliv', 'youtube', 'kodekloud'])
    expect(c('Spotify')).toBe('subscription')
    expect(c('Jupiter Gold')).toBe('jupiter')
    expect(c('Digital Gold')).toBe('gold')
    expect(c('HDFC Credit Card')).toBe('hdfc')
    expect(c('Food/Grocery')).toBe('food')
    expect(c('BF/Lunch/Dinner/Zomato')).toBe('food')
    expect(c('Medicine/Doctor')).toBe('health')
    expect(c('Mom')).toBe('family')
    expect(c('Miscellenous/Subscriptions/EBill')).toBe('utilities')
    expect(c('Transport & Fuel')).toBe('transport')
    expect(c('Zzz unknown')).toBe('other')
  })
  it('the same name always gets the same colour and icon', () => {
    expect(categoryStyle('Food/Grocery')).toEqual(categoryStyle('Food/Grocery'))
    expect(categoryStyle('Rent').color).not.toBe(categoryStyle('Food/Grocery').color)
  })
})
