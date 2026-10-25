import { describe, expect, it } from 'vitest'
import { balanceSummary, closingBalance } from '../src/engine/budget'
import type { Cycle, PlannedItem, Transaction } from '../src/engine/types'

const R = (n: number) => Math.round(n * 100)
const cycle: Cycle = {
  start: '2026-10-25', end: '2026-11-25', takeHomePaise: R(173350), extraCreditsPaise: R(5000), openingCarryPaise: R(838375.66), releasedCarryPaise: R(25000), source: 'app',
  allocations: [
    { id: 'rent', name: 'Rent', kind: 'fixed', amountPaise: R(23000) },
    { id: 'sip', name: 'SIP', kind: 'investment', amountPaise: R(10000) },
  ],
}
const tx = (id: string, amount: number, extra: Partial<Transaction> = {}): Transaction => ({
  id, date: '2026-10-26', time: '10:00', amountPaise: R(amount), type: 'expense', category: 'Food', merchant: '', method: 'upi', note: '', source: 'manual', createdAt: '', ...extra,
})

describe('balance = carry-over + this cycle − what is spent or still to pay', () => {
  it('start of cycle: nothing spent yet', () => {
    const b = balanceSummary(cycle, [], [])
    expect(b.inAccountNowPaise).toBe(R(838375.66 + 173350 + 5000)) // carry-over + salary + credits
    expect(b.setAsideDuePaise).toBe(R(33000))
    expect(b.afterPlanPaise).toBe(R(838375.66 + 173350 + 5000 - 33000)) // what the Excel sheet showed as Balance
  })
  it('paying a set-aside moves it from "still to pay" to "paid" without changing the after-plan balance', () => {
    const before = balanceSummary(cycle, [], [])
    const after = balanceSummary(cycle, [tx('r', 23000, { allocationId: 'rent', category: 'Rent' })], [])
    expect(after.setAsidePaidPaise).toBe(R(23000))
    expect(after.inAccountNowPaise).toBe(before.inAccountNowPaise - R(23000))
    expect(after.setAsideDuePaise).toBe(R(10000))
    expect(after.afterPlanPaise).toBe(before.afterPlanPaise)
  })
  it('spending lowers both numbers; refunds and one-off income raise them; transfers change nothing', () => {
    const base = balanceSummary(cycle, [], [])
    const t = [tx('a', 1000), tx('b', 200, { type: 'refund' }), tx('c', 500, { type: 'income' }), tx('d', 9000, { type: 'transfer' })]
    const b = balanceSummary(cycle, t, [])
    expect(b.spentPaise).toBe(R(800))
    expect(b.inAccountNowPaise).toBe(base.inAccountNowPaise - R(800) + R(500))
    expect(b.afterPlanPaise).toBe(base.afterPlanPaise - R(800) + R(500))
  })
  it('reserved bills lower the after-plan balance until they are paid with the real amount', () => {
    const bill: PlannedItem = { id: 'exp-e-1', title: 'Electricity', amountPaise: R(1800), dueDate: '2026-11-05', done: false }
    const reserved = balanceSummary(cycle, [], [bill])
    expect(reserved.plannedDuePaise).toBe(R(1800))
    expect(reserved.afterPlanPaise).toBe(balanceSummary(cycle, [], []).afterPlanPaise - R(1800))
    const paid = balanceSummary(cycle, [tx('p', 2600, { plannedId: bill.id })], [{ ...bill, done: true }])
    expect(paid.plannedDuePaise).toBe(0)
    expect(paid.afterPlanPaise).toBe(balanceSummary(cycle, [], []).afterPlanPaise - R(2600)) // the real amount, not the estimate
  })
  it('paying more than planned counts the real amount; released carry-over is not money spent', () => {
    const b = balanceSummary(cycle, [tx('r', 24500, { allocationId: 'rent', category: 'Rent' })], [])
    expect(b.setAsidePaidPaise).toBe(R(24500))
    expect(b.setAsideDuePaise).toBe(R(10000)) // rent has nothing left to pay
    expect(balanceSummary({ ...cycle, releasedCarryPaise: 0 }, [], []).afterPlanPaise).toBe(balanceSummary(cycle, [], []).afterPlanPaise)
  })
  it('once everything planned is paid, it equals the carry-over the next cycle starts with', () => {
    const t = [tx('r', 23000, { allocationId: 'rent' }), tx('s', 10000, { allocationId: 'sip' }), tx('f', 4000)]
    const b = balanceSummary(cycle, t, [])
    expect(b.setAsideDuePaise).toBe(0)
    expect(b.afterPlanPaise).toBe(b.inAccountNowPaise)
    expect(b.afterPlanPaise).toBe(closingBalance(cycle, t))
  })
})
