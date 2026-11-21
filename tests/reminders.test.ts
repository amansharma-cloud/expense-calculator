import { describe, expect, it } from 'vitest'
import { buildReminders, reminderDays } from '../src/engine/reminders'
import type { Cycle, Plan, PlannedItem } from '../src/engine/types'

const cycle: Cycle = {
  start: '2026-10-25', end: '2026-11-25', takeHomePaise: 1, extraCreditsPaise: 0, openingCarryPaise: 0, releasedCarryPaise: 0, source: 'app',
  allocations: [{ id: 'rent', name: 'Rent', kind: 'fixed', amountPaise: 2300000, dueDay: 1 }, { id: 'mf', name: 'MF', kind: 'investment', amountPaise: 500000, dueDay: 3 }],
}
const plan = {
  allocations: [{ id: 'rent', name: 'Rent', kind: 'fixed', amountPaise: 2300000, dueDay: 1 }],
  expectedBills: [
    { id: 'jio', name: 'Jio', estimatePaise: 89900, category: 'Jio', everyDays: 84, lastDone: '2026-11-20' },
    { id: 'claude', name: 'Claude', estimatePaise: 200000, category: 'Claude', subscription: true, renewMonth: 12, dueDay: 8 },
  ],
} as unknown as Plan
const planned: PlannedItem[] = [{ id: 'exp-elec-2026-10-25', title: 'Electricity', amountPaise: 239000, dueDate: '2026-11-23', done: false, category: 'Electricity' }, { id: 'x', title: 'Paid', amountPaise: 1, dueDate: '2026-11-22', done: true, category: 'c' }]
const base = { plan, cycle, planned, allocationPaid: { rent: 0, mf: 500000 }, txs: [], today: '2026-11-21' }
const days = (over = {}) => reminderDays({ ...base, ...over })

describe('reminder dates', () => {
  it('counts unpaid items in this pay period and the next, never paid ones', () => {
    const d = days()
    expect(d.find((x) => x.date === '2026-11-23')).toMatchObject({ due: 1 }) // electricity
    expect(d.find((x) => x.date === '2026-11-22')).toBeUndefined() // done
    expect(d.find((x) => x.date === '2026-11-03')).toBeUndefined() // MF already paid, and in the past anyway
    expect(d.find((x) => x.date === '2026-12-01')).toMatchObject({ due: 1 }) // rent next period
    expect(d.find((x) => x.date === '2026-12-08')).toMatchObject({ due: 1 }) // yearly renewal month
  })
  it('an every-N-days bill is only counted on its date', () => {
    expect(days({ days: 120 }).find((x) => x.date === '2027-02-12')).toMatchObject({ due: 1 })
    expect(days().some((x) => x.date === '2027-02-12')).toBe(false) // beyond the 45-day window
  })
  it('overdue items roll into today', () => {
    const d = days({ allocationPaid: { rent: 2300000, mf: 500000 }, planned: [...planned, { id: 'late', title: 'Late', amountPaise: 1, dueDate: '2026-11-10', done: false, category: 'c' }] })
    expect(d.find((x) => x.date === '2026-11-21')).toMatchObject({ overdue: 1 })
  })
})

describe('reminder times', () => {
  const at = (d: string, h: number) => Date.parse(`${d}T${String(h).padStart(2, '0')}:00:00Z`)
  const toMs = (d: string, h: number) => at(d, h)
  const now = at('2026-11-21', 12)
  it('sends a generic line the day before and on the day, only for the future', () => {
    const r = buildReminders([{ date: '2026-11-23', due: 2, overdue: 0 }, { date: '2026-11-21', due: 1, overdue: 0 }], { dayBefore: true, onDay: true, hour: 9 }, now, toMs)
    expect(r.map((x) => [new Date(x.at).toISOString().slice(0, 13), x.body])).toEqual([
      ['2026-11-22T09', '2 bills due tomorrow. Open Daily Spend to see which.'],
      ['2026-11-23T09', '2 bills due today. Open Daily Spend to see which.'],
    ])
    expect(JSON.stringify(r)).not.toMatch(/Rent|Electricity|₹/) // names and amounts never appear
  })
  it('respects the switches', () => {
    expect(buildReminders([{ date: '2026-11-25', due: 1, overdue: 0 }], { dayBefore: false, onDay: true, hour: 9 }, now, toMs)).toHaveLength(1)
    expect(buildReminders([{ date: '2026-11-25', due: 1, overdue: 0 }], { dayBefore: false, onDay: false, hour: 9 }, now, toMs)).toHaveLength(0)
  })
})
