import { describe, expect, it } from 'vitest'
import { computeBudget } from '../src/engine/budget'
import { matchAllocation } from '../src/engine/commitments'
import type { Allocation, Cycle, Transaction } from '../src/engine/types'

const allocs: Allocation[] = [
  { id: 'rent', name: 'Rent', kind: 'fixed', amountPaise: 2300000 },
  { id: 'mom', name: 'Mom', kind: 'fixed', amountPaise: 2000000 },
  { id: 'mf3', name: 'Mutual Fund 3', kind: 'investment', amountPaise: 500000 },
  { id: 'zero', name: 'HDFC EMI', kind: 'fixed', amountPaise: 0 },
]

describe('recognising a commitment payment', () => {
  it('links "Sent as Rent" ₹23,000 to Rent', () => {
    expect(matchAllocation('Sent as Rent', 'Rent', 2300000, allocs)).toMatchObject({ allocation: { id: 'rent' }, confident: true })
    expect(matchAllocation('rent for november', 'Other', 2250000, allocs)?.confident).toBe(true)
  })
  it('matches by category alone and by multi-word names', () => {
    expect(matchAllocation('', 'Rent', 2300000, allocs)?.allocation.id).toBe('rent')
    expect(matchAllocation('mutual fund 3 sip', '', 500000, allocs)?.allocation.id).toBe('mf3')
  })
  it('is not fooled by a small gift to Mom, but still offers the link', () => {
    const m = matchAllocation('Mom birthday gift', 'Family', 50000, allocs)
    expect(m?.allocation.id).toBe('mom')
    expect(m?.confident).toBe(false)
  })
  it('ignores unrelated spending and zero-amount items', () => {
    expect(matchAllocation('Lunch', 'Eating out', 18000, allocs)).toBeNull()
    expect(matchAllocation('HDFC EMI', 'HDFC EMI', 700000, allocs)).toBeNull()
  })
})

describe('what a linked payment does to the budget (the reported bug)', () => {
  const cycle: Cycle = {
    start: '2026-10-25', end: '2026-11-25', takeHomePaise: 17335000, extraCreditsPaise: 0, openingCarryPaise: 0, releasedCarryPaise: 0, source: 'app',
    allocations: allocs,
  }
  const rentTx = (allocationId?: string): Transaction => ({
    id: 't', date: '2026-10-25', time: '10:00', amountPaise: 2300000, type: 'expense', category: 'Rent', merchant: 'Sent as Rent',
    method: 'upi', note: '', allocationId, source: 'manual', createdAt: '',
  })
  it('unlinked rent is counted as spending a second time; linked rent only ticks off the set-aside', () => {
    const none = computeBudget(cycle, [], [], '2026-10-25')
    const unlinked = computeBudget(cycle, [rentTx()], [], '2026-10-25')
    const linked = computeBudget(cycle, [rentTx('rent')], [], '2026-10-25')
    expect(unlinked.remainingPaise).toBe(none.remainingPaise - 2300000)
    expect(unlinked.todayRemainingPaise).toBeLessThan(0)
    expect(linked.remainingPaise).toBe(none.remainingPaise)
    expect(linked.todayRemainingPaise).toBe(none.todayRemainingPaise)
    expect(linked.allocationPaid.rent).toBe(2300000)
  })
})
