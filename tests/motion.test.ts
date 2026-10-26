import { describe, expect, it } from 'vitest'
import { balanceSeries, balanceSummary } from '../src/engine/budget'
import type { Cycle, Transaction } from '../src/engine/types'
import { countUpValue, easeOutCubic, effectiveMotion, greeting, lerp } from '../src/ui/motion'

describe('count-up maths', () => {
  it('eases from the start to the end and never overshoots', () => {
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
    expect(easeOutCubic(-5)).toBe(0)
    expect(easeOutCubic(9)).toBe(1)
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5) // fast start, slow finish
    expect(lerp(10, 20, 0.5)).toBe(15)
  })
  it('counts up over the duration and lands exactly on the target', () => {
    expect(countUpValue(0, 1000, 0, 800)).toBe(0)
    const mid = countUpValue(0, 1000, 400, 800)
    expect(mid).toBeGreaterThan(500)
    expect(mid).toBeLessThan(1000)
    expect(countUpValue(0, 1000, 800, 800)).toBe(1000)
    expect(countUpValue(0, 1000, 5000, 800)).toBe(1000)
    expect(countUpValue(300, 100, 800, 800)).toBe(100) // also counts down
    expect(countUpValue(0, 1000, 10, 0)).toBe(1000)
  })
})

describe('greeting and motion level', () => {
  it('follows the hour of the day', () => {
    const at = (h: number) => greeting(new Date(2026, 9, 26, h, 0))
    expect([at(5), at(11)]).toEqual(['Good morning', 'Good morning'])
    expect([at(12), at(16)]).toEqual(['Good afternoon', 'Good afternoon'])
    expect([at(17), at(21)]).toEqual(['Good evening', 'Good evening'])
    expect([at(22), at(2)]).toEqual(['Hello', 'Hello'])
  })
  it('Auto follows the device; an explicit choice always wins (even on a reduce-motion device)', () => {
    expect(effectiveMotion(undefined, true)).toBe('off')
    expect(effectiveMotion(undefined, false)).toBe('standard')
    expect(effectiveMotion('standard', true)).toBe('standard')
    expect(effectiveMotion('rich', true)).toBe('rich')
    expect(effectiveMotion('off', false)).toBe('off')
  })
})

describe('balance over the cycle (sparkline data)', () => {
  const cycle: Cycle = {
    start: '2026-10-25', end: '2026-11-25', takeHomePaise: 1000000, extraCreditsPaise: 0, openingCarryPaise: 5000000, releasedCarryPaise: 0, source: 'app',
    allocations: [{ id: 'r', name: 'Rent', kind: 'fixed', amountPaise: 230000 }],
  }
  const tx = (id: string, date: string, amountPaise: number, extra: Partial<Transaction> = {}): Transaction => ({
    id, date, time: '10:00', amountPaise, type: 'expense', category: 'Food', merchant: '', method: 'upi', note: '', source: 'manual', createdAt: '', ...extra,
  })
  const txs = [tx('a', '2026-10-25', 10000), tx('b', '2026-10-27', 230000, { allocationId: 'r' }), tx('c', '2026-10-27', 5000, { type: 'refund' }), tx('d', '2026-10-28', 99999, { type: 'transfer' })]
  it('has one point per day and starts from carry-over + money in', () => {
    const s = balanceSeries(cycle, [], '2026-10-27')
    expect(s.map((p) => p.date)).toEqual(['2026-10-25', '2026-10-26', '2026-10-27'])
    expect(s[0].paise).toBe(6000000)
  })
  it('its last point equals "in your account now"', () => {
    const s = balanceSeries(cycle, txs, '2026-10-28')
    expect(s[s.length - 1].paise).toBe(balanceSummary(cycle, txs.filter((t) => t.date <= '2026-10-28'), []).inAccountNowPaise)
    expect(s[0].paise).toBe(5990000)
    expect(s[2].paise).toBe(5990000 - 230000 + 5000)
    expect(s[3].paise).toBe(s[2].paise) // a transfer does not move the balance
  })
  it('stops at the end of a finished cycle', () => {
    expect(balanceSeries(cycle, [], '2027-01-01').length).toBe(31)
  })
})
