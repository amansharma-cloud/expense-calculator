import type { ISODate, PayCycle } from './types'

const pad = (n: number) => String(n).padStart(2, '0')

export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

const toUTC = (s: ISODate) => {
  const [y, m, d] = s.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}
const fromUTC = (t: number): ISODate => {
  const d = new Date(t)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export const addDays = (s: ISODate, n: number): ISODate => fromUTC(toUTC(s) + n * 86_400_000)
export const diffDays = (a: ISODate, b: ISODate): number => Math.round((toUTC(b) - toUTC(a)) / 86_400_000)
export const daysInMonth = (y: number, m1: number): number => new Date(Date.UTC(y, m1, 0)).getUTCDate()

export function todayISO(now: Date = new Date()): ISODate {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
export function nowHM(now: Date = new Date()): string {
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`
}

/** Salary date in a given month; a day that doesn't exist (e.g. 31 in June) clamps to month end. */
export function salaryDateIn(y: number, m1: number, salaryDay: number): ISODate {
  return `${y}-${pad(m1)}-${pad(Math.min(salaryDay, daysInMonth(y, m1)))}`
}

const shiftMonth = (y: number, m1: number, delta: number): [number, number] => {
  const idx = y * 12 + (m1 - 1) + delta
  return [Math.floor(idx / 12), (idx % 12) + 1]
}

/** The cycle (start inclusive, end exclusive) that contains `date`. */
export function cycleBounds(date: ISODate, salaryDay: number): { start: ISODate; end: ISODate } {
  const [y, m] = date.split('-').map(Number)
  const thisMonth = salaryDateIn(y, m, salaryDay)
  let sy = y
  let sm = m
  if (date < thisMonth) [sy, sm] = shiftMonth(y, m, -1)
  const start = salaryDateIn(sy, sm, salaryDay)
  const [ey, em] = shiftMonth(sy, sm, 1)
  return { start, end: salaryDateIn(ey, em, salaryDay) }
}

export function monthName(m1: number): string {
  return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m1 - 1]
}

export function shortDate(s: ISODate): string {
  const [y, m, d] = s.split('-').map(Number)
  return `${d} ${monthName(m).slice(0, 3)}${y !== new Date().getFullYear() ? ' ' + y : ''}`
}

export function cycleLabel(start: ISODate, end: ISODate): string {
  return `${shortDate(start)} – ${shortDate(addDays(end, -1))}`
}

/** The pay cycle (start inclusive, end exclusive) containing `date`, for any pay frequency. */
export function cycleBoundsFor(date: ISODate, pay: PayCycle): { start: ISODate; end: ISODate } {
  if (pay.kind === 'monthly') return cycleBounds(date, pay.day)
  if (pay.kind === 'interval') {
    const k = Math.floor(diffDays(pay.anchor, date) / pay.everyDays)
    const start = addDays(pay.anchor, k * pay.everyDays)
    return { start, end: addDays(start, pay.everyDays) }
  }
  // semimonthly: paydays are the two chosen days of every month (clamped in short months)
  const [y, m] = date.split('-').map(Number)
  const days = new Set<ISODate>()
  for (const delta of [-1, 0, 1]) {
    const [yy, mm] = shiftMonth(y, m, delta)
    for (const d of pay.days) days.add(salaryDateIn(yy, mm, d))
  }
  const sorted = [...days].sort()
  const start = [...sorted].reverse().find((d) => d <= date)!
  const end = sorted.find((d) => d > date)!
  return { start, end }
}
