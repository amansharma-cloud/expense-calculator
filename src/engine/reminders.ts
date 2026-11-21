import { dateForDay, nextDueDate } from './bills'
import { addDays, daysInMonth, diffDays } from './dates'
import type { Allocation, Cycle, ISODate, Paise, Plan, PlannedItem, Transaction } from './types'

/**
 * Which dates need a reminder. Only DATES and COUNTS leave the device (the server never learns what a bill is):
 * "2 bills due tomorrow". Everything here is a pure function of the data you already have.
 */
export interface ReminderPrefs {
  /** A reminder the day before */
  dayBefore: boolean
  /** A reminder on the due day */
  onDay: boolean
  /** Hour of the day (0-23), local time */
  hour: number
}
export const DEFAULT_REMINDER_PREFS: ReminderPrefs = { dayBefore: true, onDay: true, hour: 9 }

export interface ReminderDay { date: ISODate; due: number; overdue: number }
export interface ReminderItem { at: number; title: string; body: string }

const TITLE = 'Daily Spend'
export const REMINDER_HORIZON_DAYS = 45

const dueOn = (day: number, date: ISODate) => {
  const [y, m, d] = date.split('-').map(Number)
  return d === Math.min(day, daysInMonth(y, m))
}

export function reminderDays(args: {
  plan: Plan | null
  cycle: Cycle
  planned: PlannedItem[]
  allocationPaid: Record<string, Paise>
  txs: Transaction[]
  today: ISODate
  days?: number
}): ReminderDay[] {
  const { plan, cycle, planned, allocationPaid, txs, today } = args
  const horizon = args.days ?? REMINDER_HORIZON_DAYS
  const out = new Map<ISODate, ReminderDay>()
  const bump = (date: ISODate, overdue = false) => {
    const row = out.get(date) ?? { date, due: 0, overdue: 0 }
    if (overdue) row.overdue++
    else row.due++
    out.set(date, row)
  }
  const inCycle = (d: ISODate) => d >= cycle.start && d < cycle.end

  // this pay period: reserved bills and set-asides that are still unpaid
  for (const p of planned) {
    if (p.done || !inCycle(p.dueDate)) continue
    if (p.dueDate < today) bump(today, true)
    else if (diffDays(today, p.dueDate) <= horizon) bump(p.dueDate)
  }
  for (const a of cycle.allocations) {
    if (!a.dueDay || a.amountPaise <= 0 || a.amountPaise - (allocationPaid[a.id] ?? 0) <= 0) continue
    const date = dateForDay(a.dueDay, cycle.start, cycle.end)
    if (!date) continue
    if (date < today) bump(today, true)
    else if (diffDays(today, date) <= horizon) bump(date)
  }

  // later days: from what you have planned (assumed unpaid until the pay period starts)
  const futureAllocs: Allocation[] = (plan?.allocations ?? []).filter((a) => a.dueDay && a.amountPaise > 0)
  for (let i = 0; i <= horizon; i++) {
    const d = addDays(today, i)
    if (inCycle(d)) continue
    for (const a of futureAllocs) if (dueOn(a.dueDay!, d)) bump(d)
    for (const b of plan?.expectedBills ?? []) {
      if (b.everyDays) continue
      if (b.renewMonth) {
        if (Number(d.slice(5, 7)) === b.renewMonth && dueOn(b.dueDay ?? 1, d)) bump(d)
      } else if (b.dueDay && dueOn(b.dueDay, d)) bump(d)
    }
  }
  for (const b of plan?.expectedBills ?? []) {
    const next = nextDueDate(b, txs)
    if (!next || next < today || diffDays(today, next) > horizon) continue
    if (inCycle(next) && planned.some((p) => p.id === `exp-${b.id}-${cycle.start}`)) continue // already counted as a reserved item
    bump(next)
  }
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date))
}

const bills = (n: number) => `${n} bill${n === 1 ? '' : 's'}`

/** Turn due dates into the times to send. `toMs` turns a local date and hour into a timestamp. */
export function buildReminders(
  days: ReminderDay[], prefs: ReminderPrefs, now: number,
  toMs: (date: ISODate, hour: number) => number = (d, h) => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd, h, 0, 0, 0).getTime() },
): ReminderItem[] {
  const out: ReminderItem[] = []
  for (const day of days) {
    const total = day.due + day.overdue
    if (prefs.dayBefore && day.due > 0) {
      const at = toMs(addDays(day.date, -1), prefs.hour)
      if (at > now) out.push({ at, title: TITLE, body: `${bills(day.due)} due tomorrow. Open Daily Spend to see which.` })
    }
    if (prefs.onDay && total > 0) {
      const at = toMs(day.date, prefs.hour)
      if (at > now) out.push({ at, title: TITLE, body: day.overdue ? `${bills(total)} to pay today, ${day.overdue} overdue.` : `${bills(day.due)} due today. Open Daily Spend to see which.` })
    }
  }
  return out.sort((a, b) => a.at - b.at)
}
