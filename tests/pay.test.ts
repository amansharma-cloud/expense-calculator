import { describe, expect, it } from 'vitest'
import { computeBudget } from '../src/engine/budget'
import { addDays, cycleBounds, cycleBoundsFor, diffDays } from '../src/engine/dates'
import { allocationsForCycle, nextCycleBounds, payOf, validatePay } from '../src/engine/pay'
import type { Allocation, Cycle, PayCycle } from '../src/engine/types'

describe('monthly pay is unchanged', () => {
  it('matches the old function for every date in two years', () => {
    for (let d = '2026-01-01'; d < '2028-01-01'; d = addDays(d, 1)) {
      for (const day of [1, 15, 25, 29, 30, 31]) expect(cycleBoundsFor(d, { kind: 'monthly', day })).toEqual(cycleBounds(d, day))
    }
  })
  it('missing pay setting means monthly on the salary day', () => {
    expect(payOf({ salaryDay: 25 })).toEqual({ kind: 'monthly', day: 25 })
  })
})

describe('every 2 weeks / weekly', () => {
  const pay: PayCycle = { kind: 'interval', everyDays: 14, anchor: '2026-10-09' } // a Friday
  it('cycles are 14 days and tile the calendar with no gaps or overlaps', () => {
    let prevEnd: string | null = null
    for (let d = '2026-09-01'; d < '2027-03-01'; d = addDays(d, 1)) {
      const b = cycleBoundsFor(d, pay)
      expect(b.start <= d && d < b.end).toBe(true)
      expect(diffDays(b.start, b.end)).toBe(14)
      if (d === b.start && prevEnd) expect(b.start).toBe(prevEnd)
      if (d === b.start) prevEnd = b.end
    }
  })
  it('works before the anchor, across the year end and across a leap day', () => {
    expect(cycleBoundsFor('2026-10-08', pay)).toEqual({ start: '2026-09-25', end: '2026-10-09' })
    expect(cycleBoundsFor('2026-10-09', pay)).toEqual({ start: '2026-10-09', end: '2026-10-23' })
    expect(cycleBoundsFor('2026-12-31', pay)).toEqual({ start: '2026-12-18', end: '2027-01-01' })
    expect(cycleBoundsFor('2027-01-01', pay)).toEqual({ start: '2027-01-01', end: '2027-01-15' })
    expect(diffDays(cycleBoundsFor('2028-02-29', pay).start, cycleBoundsFor('2028-02-29', pay).end)).toBe(14)
  })
  it('an anchor in the future still works backwards', () => {
    expect(cycleBoundsFor('2026-10-01', { kind: 'interval', everyDays: 14, anchor: '2027-06-04' })).toEqual({ start: '2026-09-25', end: '2026-10-09' })
  })
  it('weekly', () => {
    expect(cycleBoundsFor('2026-10-25', { kind: 'interval', everyDays: 7, anchor: '2026-10-23' })).toEqual({ start: '2026-10-23', end: '2026-10-30' })
  })
})

describe('twice a month', () => {
  it('1st and 15th', () => {
    const pay: PayCycle = { kind: 'semimonthly', days: [1, 15] }
    expect(cycleBoundsFor('2026-10-10', pay)).toEqual({ start: '2026-10-01', end: '2026-10-15' })
    expect(cycleBoundsFor('2026-10-15', pay)).toEqual({ start: '2026-10-15', end: '2026-11-01' })
    expect(cycleBoundsFor('2026-12-20', pay)).toEqual({ start: '2026-12-15', end: '2027-01-01' })
  })
  it('15th and last day, in short months and in either order', () => {
    const pay: PayCycle = { kind: 'semimonthly', days: [31, 15] }
    expect(cycleBoundsFor('2026-02-20', pay)).toEqual({ start: '2026-02-15', end: '2026-02-28' })
    expect(cycleBoundsFor('2026-02-28', pay)).toEqual({ start: '2026-02-28', end: '2026-03-15' })
    expect(cycleBoundsFor('2028-02-29', pay)).toEqual({ start: '2028-02-29', end: '2028-03-15' })
    expect(cycleBoundsFor('2026-04-30', pay)).toEqual({ start: '2026-04-30', end: '2026-05-15' })
  })
  it('tiles the calendar for a full year', () => {
    const pay: PayCycle = { kind: 'semimonthly', days: [14, 30] }
    for (let d = '2026-01-01'; d < '2027-01-01'; d = addDays(d, 1)) {
      const b = cycleBoundsFor(d, pay)
      expect(b.start <= d && d < b.end).toBe(true)
      expect(cycleBoundsFor(b.end, pay).start).toBe(b.end)
    }
  })
})

describe('validation', () => {
  it('rejects bad settings', () => {
    expect(validatePay({ kind: 'monthly', day: 0 })).toMatch(/1 and 31/)
    expect(validatePay({ kind: 'semimonthly', days: [1, 1] })).toMatch(/different/)
    expect(validatePay({ kind: 'semimonthly', days: [1, 32] })).toMatch(/1 and 31/)
    expect(validatePay({ kind: 'interval', everyDays: 14, anchor: '2026-02-30' })).toMatch(/valid date/)
    expect(validatePay({ kind: 'interval', everyDays: 14, anchor: '2026-10-09' })).toBeNull()
    expect(validatePay({ kind: 'semimonthly', days: [1, 15] })).toBeNull()
  })
})

describe('set-asides that fall on a day of the month', () => {
  const rent: Allocation = { id: 'rent', name: 'Rent', kind: 'fixed', amountPaise: 200000, dueDay: 1 }
  const gym: Allocation = { id: 'gym', name: 'Gym', kind: 'fixed', amountPaise: 5000 }
  const car: Allocation = { id: 'car', name: 'Car', kind: 'fixed', amountPaise: 30000, dueDay: 31 }
  const pay: PayCycle = { kind: 'interval', everyDays: 14, anchor: '2026-10-09' }

  it('applies rent in exactly one bi-weekly cycle per month; undated items every cycle', () => {
    const count = new Map<string, number>()
    let d = '2026-01-02'
    while (d < '2026-12-31') {
      const b = cycleBoundsFor(d, pay)
      const names = allocationsForCycle([rent, gym], b.start, b.end, pay).map((a) => a.id)
      expect(names).toContain('gym')
      if (names.includes('rent')) {
        // which month's 1st does this cycle contain?
        for (let x = b.start; x < b.end; x = addDays(x, 1)) if (x.endsWith('-01')) count.set(x, (count.get(x) ?? 0) + 1)
      }
      d = b.end
    }
    for (const [, n] of count) expect(n).toBe(1)
    expect(count.size).toBe(11) // Feb 1 … Dec 1 inside the window
  })
  it('a due day beyond the month length falls on the last day', () => {
    expect(allocationsForCycle([car], '2026-02-20', '2026-03-06', pay).map((a) => a.id)).toEqual(['car']) // Feb has no 31st → Feb 28
    expect(allocationsForCycle([car], '2026-03-06', '2026-03-20', pay)).toEqual([])
  })
  it('with monthly pay every cycle contains every due day (nothing changes)', () => {
    for (const day of [1, 15, 25, 28, 29, 30, 31]) {
      for (let d = '2026-01-01'; d < '2027-03-01'; d = addDays(d, 5)) {
        const b = cycleBounds(d, day)
        for (const due of [1, 2, 15, 28, 29, 30, 31]) {
          expect(allocationsForCycle([{ ...rent, dueDay: due }], b.start, b.end, { kind: 'monthly', day })).toHaveLength(1)
        }
      }
    }
  })
  it('copies, so editing the plan later cannot change a stored cycle', () => {
    const [copy] = allocationsForCycle([gym], '2026-10-09', '2026-10-23', pay)
    copy.amountPaise = 1
    expect(gym.amountPaise).toBe(5000)
  })
})

describe('the daily limit on a 14-day cycle', () => {
  const cycle: Cycle = {
    start: '2026-10-09', end: '2026-10-23', takeHomePaise: 280000, extraCreditsPaise: 0, openingCarryPaise: 0, releasedCarryPaise: 0, source: 'app',
    allocations: [{ id: 'r', name: 'Rent', kind: 'fixed', amountPaise: 140000 }],
  }
  it('divides what is left by the days to the next payday', () => {
    const b = computeBudget(cycle, [], [], '2026-10-09')
    expect(b.cycleDays).toBe(14)
    expect(b.spendablePaise).toBe(140000)
    expect(b.todayLimitPaise).toBe(10000)
    expect(computeBudget(cycle, [], [], '2026-10-22').daysLeft).toBe(1)
    expect(computeBudget(cycle, [], [], '2026-10-23').status).toBe('ended')
  })
})

describe('switching pay frequency', () => {
  it('the next cycle starts where the last one ended, so nothing is counted twice', () => {
    // monthly cycle ended on 24 Nov; the new bi-weekly rhythm would have started on the 20th
    const pay: PayCycle = { kind: 'interval', everyDays: 14, anchor: '2026-10-23' }
    expect(cycleBoundsFor('2026-11-24', pay).start).toBe('2026-11-20')
    expect(nextCycleBounds('2026-11-24', pay, [{ end: '2026-11-24' }])).toEqual({ start: '2026-11-24', end: '2026-12-04' })
  })
  it('does nothing when there is no overlap or no history', () => {
    const pay: PayCycle = { kind: 'monthly', day: 25 }
    expect(nextCycleBounds('2026-10-25', pay, [{ end: '2026-10-25' }])).toEqual(cycleBoundsFor('2026-10-25', pay))
    expect(nextCycleBounds('2026-10-25', pay, [])).toEqual(cycleBoundsFor('2026-10-25', pay))
  })
})
