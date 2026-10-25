import { addDays, cycleBoundsFor, daysInMonth, isValidDate } from './dates'
import type { Allocation, Cycle, ISODate, PayCycle, Plan } from './types'

export const payOf = (plan: Pick<Plan, 'pay' | 'salaryDay'>): PayCycle => plan.pay ?? { kind: 'monthly', day: plan.salaryDay }

/** Human-readable validation message for a pay setting, or null when it is fine. */
export function validatePay(pay: PayCycle): string | null {
  const dayOk = (d: number) => Number.isInteger(d) && d >= 1 && d <= 31
  if (pay.kind === 'monthly') return dayOk(pay.day) ? null : 'Pay day must be between 1 and 31.'
  if (pay.kind === 'semimonthly') {
    if (!pay.days.every(dayOk)) return 'Both pay days must be between 1 and 31.'
    return pay.days[0] === pay.days[1] ? 'Choose two different pay days.' : null
  }
  if (pay.everyDays !== 7 && pay.everyDays !== 14) return 'Pay must repeat every 7 or 14 days.'
  return isValidDate(pay.anchor) ? null : 'Enter a valid date for a recent payday.'
}

export function describePay(pay: PayCycle): string {
  if (pay.kind === 'monthly') return `monthly on day ${pay.day}`
  if (pay.kind === 'semimonthly') return `twice a month (days ${pay.days.join(' & ')})`
  return pay.everyDays === 7 ? 'every week' : 'every 2 weeks'
}

/**
 * The set-asides that apply in one pay cycle. Items without a due day apply every cycle. An item with a due
 * day (day of month) applies only in the cycle that contains that day, so monthly rent is charged once a month
 * even when pay arrives every two weeks. With monthly pay there is one cycle per month, so everything applies.
 */
export function allocationsForCycle(allocations: Allocation[], start: ISODate, end: ISODate, pay: PayCycle = { kind: 'monthly', day: 1 }): Allocation[] {
  if (pay.kind === 'monthly') return allocations.map((a) => ({ ...a })) // one cycle per month: everything applies
  const dueIn = (day: number) => {
    for (let d = start; d < end; d = addDays(d, 1)) {
      const [y, m, dd] = d.split('-').map(Number)
      if (dd === Math.min(day, daysInMonth(y, m))) return true
    }
    return false
  }
  return allocations.filter((a) => !a.dueDay || dueIn(a.dueDay)).map((a) => ({ ...a }))
}

/** Cycle dates for `today`, never starting before the end of an earlier cycle (no overlap after a pay-frequency change). */
export function nextCycleBounds(today: ISODate, pay: PayCycle, cycles: Pick<Cycle, 'end'>[]): { start: ISODate; end: ISODate } {
  const b = cycleBoundsFor(today, pay)
  const prevEnd = cycles.map((c) => c.end).filter((e) => e <= today).sort().pop()
  return prevEnd && prevEnd > b.start ? { start: prevEnd, end: b.end } : b
}

/** Monthly pay has exactly one cycle per month, so month-based items always belong to it. */
export const billsAreIn = (pay: PayCycle): boolean => pay.kind === 'monthly'

export { cycleBoundsFor }
