import { describe, expect, it } from 'vitest'
import { billsForCycle, convertAllocation } from '../src/engine/bills'
import { closingBalance, computeBudget } from '../src/engine/budget'
import type { Cycle, ExpectedBill, PayCycle, Plan, PlannedItem, Transaction } from '../src/engine/types'

const monthly: PayCycle = { kind: 'monthly', day: 25 }
const biweekly: PayCycle = { kind: 'interval', everyDays: 14, anchor: '2026-10-09' }
const elec: ExpectedBill = { id: 'e1', name: 'Electricity Bill', estimatePaise: 180000, dueDay: 5, category: 'Electricity Bill' }

describe('expected bills per cycle', () => {
  it('monthly pay: due on the chosen day inside the cycle; no due day = last day of the cycle', () => {
    expect(billsForCycle([elec], '2026-10-25', '2026-11-25', monthly)[0]).toMatchObject({ dueDate: '2026-11-05', amountPaise: 180000, done: false, title: 'Electricity Bill' })
    expect(billsForCycle([{ ...elec, dueDay: undefined }], '2026-10-25', '2026-11-25', monthly)[0].dueDate).toBe('2026-11-24')
  })
  it('a due day clamps to the end of short months, and monthly pay never skips a month', () => {
    expect(billsForCycle([{ ...elec, dueDay: 31 }], '2027-01-25', '2027-02-25', monthly)[0].dueDate).toBe('2027-01-31')
    expect(billsForCycle([{ ...elec, dueDay: 29 }], '2027-01-31', '2027-02-28', { kind: 'monthly', day: 31 })).toHaveLength(1)
  })
  it('bi-weekly pay: the bill appears only in the pay period containing its day', () => {
    let hits = 0
    for (let start = '2026-10-09'; start < '2027-01-01'; ) {
      const end = new Date(Date.parse(start + 'T00:00:00Z') + 14 * 86400000).toISOString().slice(0, 10)
      hits += billsForCycle([elec], start, end, biweekly).length
      start = end
    }
    expect(hits).toBe(2) // the 5th of Nov and of Dec each fall in exactly one pay period of the window
  })
  it('ids are stable per cycle so starting a cycle twice cannot duplicate', () => {
    const a = billsForCycle([elec], '2026-10-25', '2026-11-25', monthly)[0].id
    const b = billsForCycle([elec], '2026-10-25', '2026-11-25', monthly)[0].id
    expect(a).toBe(b)
    expect(a).not.toBe(billsForCycle([elec], '2026-11-25', '2026-12-25', monthly)[0].id)
  })
})

describe('reserving and paying an expected bill', () => {
  const cycle: Cycle = { start: '2026-10-25', end: '2026-11-25', takeHomePaise: 1000000, extraCreditsPaise: 0, openingCarryPaise: 0, releasedCarryPaise: 0, allocations: [], source: 'app' }
  const unpaid: PlannedItem = billsForCycle([elec], cycle.start, cycle.end, monthly)[0]
  const tx = (amountPaise: number): Transaction => ({ id: 't', date: '2026-11-05', time: '10:00', amountPaise, type: 'expense', category: 'Electricity Bill', merchant: 'Electricity Bill', method: 'upi', note: '', plannedId: unpaid.id, source: 'manual', createdAt: '' })

  it('the estimate lowers the daily limit before the bill arrives', () => {
    const without = computeBudget(cycle, [], [], '2026-10-25')
    const withBill = computeBudget(cycle, [], [unpaid], '2026-10-25')
    expect(withBill.remainingPaise).toBe(without.remainingPaise - 180000)
    expect(withBill.todayLimitPaise).toBeLessThan(without.todayLimitPaise)
  })
  it('paying a higher or lower real amount moves exactly the difference into spending', () => {
    const base = computeBudget(cycle, [], [], '2026-11-06').remainingPaise
    const high = computeBudget(cycle, [tx(260000)], [{ ...unpaid, done: true }], '2026-11-06').remainingPaise
    const low = computeBudget(cycle, [tx(120000)], [{ ...unpaid, done: true }], '2026-11-06').remainingPaise
    expect(base - high).toBe(260000)
    expect(base - low).toBe(120000)
  })
})

describe('moving a fixed set-aside to spending or to expected bills', () => {
  const mkCycle = (start: string, end: string, id: string, opening: number): Cycle => ({
    start, end, takeHomePaise: 1500000, extraCreditsPaise: 0, openingCarryPaise: opening, releasedCarryPaise: 0, source: 'import',
    allocations: [
      { id: 'rent-' + id, name: 'Rent', kind: 'fixed', amountPaise: 230000 },
      { id: 'elec-' + id, name: 'Electricity Bill', kind: 'fixed', amountPaise: 183000 },
    ],
  })
  const past = mkCycle('2026-09-25', '2026-10-25', 'p', 100000)
  const current = mkCycle('2026-10-25', '2026-11-25', 'c', 500000)
  const t = (id: string, date: string, alloc: string, amountPaise: number): Transaction => ({
    id, date, time: '00:00', amountPaise, type: 'expense', category: 'Electricity Bill', merchant: 'Electricity Bill', method: 'other', note: '', allocationId: alloc, source: 'import', createdAt: '',
  })
  const plan: Plan = {
    salaryDay: 25, takeHomePaise: 1500000, releasedCarryPaise: 0, theme: 'system', categories: ['Food'],
    allocations: [{ id: 'pr', name: 'Rent', kind: 'fixed', amountPaise: 230000 }, { id: 'pe', name: 'Electricity Bill', kind: 'fixed', amountPaise: 183000, dueDay: 5 }],
  }
  const baseInput = { plan, cycles: [past, current], planned: [] as PlannedItem[], transactions: [t('t1', '2026-10-24', 'elec-p', 183000)] }
  const opts = { pastCycles: true, today: '2026-11-02', pay: monthly, newId: () => 'bill-1' }

  it('history is unchanged: the past closing balance is identical, and the item now counts as spending', () => {
    const before = closingBalance(past, baseInput.transactions)
    const r = convertAllocation(baseInput, 'electricity bill', 'expected', opts)
    const pastAfter = r.changedCycles.find((c) => c.start === past.start)!
    const txAfter = baseInput.transactions.map((x) => r.changedTransactions.find((c) => c.id === x.id) ?? x)
    expect(pastAfter.allocations.map((a) => a.name)).toEqual(['Rent'])
    expect(txAfter[0].allocationId).toBeUndefined()
    expect(closingBalance(pastAfter, txAfter)).toBe(before)
    expect(computeBudget(pastAfter, txAfter, [], '2026-10-24').variableSpentPaise).toBe(183000)
  })
  it('the plan and the current cycle no longer set it aside; an expected bill reserves the estimate instead', () => {
    const r = convertAllocation(baseInput, 'Electricity Bill', 'expected', opts)
    expect(r.plan.allocations.map((a) => a.name)).toEqual(['Rent'])
    expect(r.plan.expectedBills).toEqual([{ id: 'bill-1', name: 'Electricity Bill', estimatePaise: 183000, dueDay: 5, category: 'Electricity Bill' }])
    const cur = r.changedCycles.find((c) => c.start === current.start)!
    expect(cur.allocations.map((a) => a.name)).toEqual(['Rent'])
    expect(r.addedPlanned).toHaveLength(1)
    expect(r.addedPlanned[0]).toMatchObject({ amountPaise: 183000, dueDate: '2026-11-05', done: false })
    const spendableBefore = computeBudget(current, [], [], '2026-11-02').spendablePaise
    const after = computeBudget(cur, [], r.addedPlanned, '2026-11-02')
    expect(after.spendablePaise).toBe(spendableBefore + 183000) // no longer set aside…
    expect(after.remainingPaise).toBe(spendableBefore) // …but reserved as an estimate, so the limit is the same until it is paid
  })
  it('moving to plain spending reserves nothing', () => {
    const r = convertAllocation(baseInput, 'Electricity Bill', 'spending', opts)
    expect(r.plan.expectedBills).toBeUndefined()
    expect(r.addedPlanned).toEqual([])
    expect(r.plan.categories).toContain('Electricity Bill')
  })
  it('can leave past cycles alone', () => {
    const r = convertAllocation(baseInput, 'Electricity Bill', 'spending', { ...opts, pastCycles: false })
    expect(r.changedCycles.map((c) => c.start)).toEqual([current.start])
    expect(r.changedTransactions).toEqual([])
  })
  it('an already-paid bill this cycle is not reserved again', () => {
    const paid = { ...baseInput, transactions: [t('t2', '2026-11-01', 'elec-c', 191000)] }
    const r = convertAllocation(paid, 'Electricity Bill', 'expected', opts)
    expect(r.addedPlanned).toEqual([])
    expect(r.changedTransactions[0].allocationId).toBeUndefined()
  })
  it('unknown names change nothing', () => {
    const r = convertAllocation(baseInput, 'Netflix', 'spending', opts)
    expect(r.changedCycles).toEqual([])
    expect(r.changedTransactions).toEqual([])
  })
})
