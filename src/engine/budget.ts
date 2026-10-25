import { addDays, diffDays } from './dates'
import { floorDiv, formatMoney, sum } from './money'
import type { BudgetResult, Cycle, ExplainLine, ISODate, Paise, PlannedItem, Status, Transaction } from './types'

/**
 * THE calculation engine. Every screen reads numbers from here; no formula is written anywhere else.
 *
 * Rules (also documented in docs/CALCULATIONS.md):
 *  - Allocations (fixed, investment, reserved) are taken out of income first. They are never "spending".
 *  - A payment tagged with an allocationId settles that allocation and is NOT counted as spending,
 *    except for any amount paid above the planned amount (overrun).
 *  - Variable spend = expenses − refunds that carry no allocationId. Transfers are ignored.
 *  - One-off income during the cycle adds to the pool.
 *  - The daily limit is recomputed from what is left, so under/overspending shifts the other days.
 */

const inCycle = (c: Cycle, d: ISODate) => d >= c.start && d < c.end

export function cycleTransactions(cycle: Cycle, txs: Transaction[]): Transaction[] {
  return txs.filter((t) => inCycle(cycle, t.date))
}

const isVariable = (t: Transaction) => !t.allocationId && (t.type === 'expense' || t.type === 'refund')

/** Net variable spending for a set of transactions (expenses minus refunds). */
export function variableNet(txs: Transaction[]): Paise {
  return sum(txs.filter(isVariable).map((t) => (t.type === 'expense' ? t.amountPaise : -t.amountPaise)))
}

export function allocationPaid(cycle: Cycle, txs: Transaction[]): Record<string, Paise> {
  const paid: Record<string, Paise> = {}
  for (const a of cycle.allocations) paid[a.id] = 0
  for (const t of cycleTransactions(cycle, txs)) {
    if (!t.allocationId || !(t.allocationId in paid)) continue
    if (t.type === 'expense') paid[t.allocationId] += t.amountPaise
    else if (t.type === 'refund') paid[t.allocationId] -= t.amountPaise
  }
  return paid
}

const incomeTotal = (txs: Transaction[]) =>
  sum(txs.filter((t) => t.type === 'income').map((t) => t.amountPaise))

/** What carries over to the next cycle if the cycle ended now. */
export function closingBalance(cycle: Cycle, allTxs: Transaction[]): Paise {
  const txs = cycleTransactions(cycle, allTxs)
  const paid = allocationPaid(cycle, txs)
  const allocated = sum(cycle.allocations.map((a) => Math.max(a.amountPaise, paid[a.id] ?? 0)))
  return (
    cycle.openingCarryPaise + cycle.takeHomePaise + cycle.extraCreditsPaise + incomeTotal(txs) - allocated - variableNet(txs)
  )
}

export interface BalanceSummary {
  openingCarryPaise: Paise
  /** Salary + other credits + one-off income this cycle */
  incomePaise: Paise
  /** Money already paid out against set-asides (rent, EMIs, SIPs…) */
  setAsidePaidPaise: Paise
  /** Regular spending (expenses minus refunds) */
  spentPaise: Paise
  /** What is in the account right now: opening + income − set-asides paid − spending */
  inAccountNowPaise: Paise
  /** Set-asides not yet paid */
  setAsideDuePaise: Paise
  /** Expected / planned bills not yet paid (their estimates) */
  plannedDuePaise: Paise
  /** What will be left once everything planned is paid: the Excel tracker's "Balance" */
  afterPlanPaise: Paise
}

/**
 * The tracker's balance: carry-over + this cycle's money − everything spent or still to pay.
 * `inAccountNow` only counts what has really left the account; `afterPlan` also subtracts the unpaid set-asides and
 * the reserved bill estimates (exactly what the old sheet did by subtracting every row at once).
 */
export function balanceSummary(cycle: Cycle, allTxs: Transaction[], planned: PlannedItem[]): BalanceSummary {
  const txs = cycleTransactions(cycle, allTxs)
  const paid = allocationPaid(cycle, txs)
  const income = cycle.takeHomePaise + cycle.extraCreditsPaise + incomeTotal(txs)
  const setAsidePaid = sum(Object.values(paid))
  const spent = variableNet(txs)
  const due = sum(cycle.allocations.map((a) => Math.max(0, a.amountPaise - (paid[a.id] ?? 0))))
  const plannedDue = sum(planned.filter((p) => !p.done && p.dueDate >= cycle.start && p.dueDate < cycle.end).map((p) => p.amountPaise))
  const now = cycle.openingCarryPaise + income - setAsidePaid - spent
  return {
    openingCarryPaise: cycle.openingCarryPaise,
    incomePaise: income,
    setAsidePaidPaise: setAsidePaid,
    spentPaise: spent,
    inAccountNowPaise: now,
    setAsideDuePaise: due,
    plannedDuePaise: plannedDue,
    afterPlanPaise: now - due - plannedDue,
  }
}

export function computeBudget(
  cycle: Cycle,
  allTxs: Transaction[],
  planned: PlannedItem[],
  today: ISODate,
): BudgetResult {
  const txs = cycleTransactions(cycle, allTxs)
  const cycleDays = diffDays(cycle.start, cycle.end)
  const notStarted = today < cycle.start
  const ended = today >= cycle.end
  const t: ISODate = notStarted ? cycle.start : ended ? addDays(cycle.end, -1) : today
  const dayNumber = diffDays(cycle.start, t) + 1
  const daysLeft = Math.max(1, diffDays(t, cycle.end))

  const byKind = (k: string) => sum(cycle.allocations.filter((a) => a.kind === k).map((a) => a.amountPaise))
  const paid = allocationPaid(cycle, txs)
  const overrun = sum(cycle.allocations.map((a) => Math.max(0, (paid[a.id] ?? 0) - a.amountPaise)))

  const income = incomeTotal(txs)
  const pool = cycle.takeHomePaise + cycle.extraCreditsPaise + income + cycle.releasedCarryPaise
  const protectedAmt = sum(cycle.allocations.map((a) => a.amountPaise))
  const spendable = pool - protectedAmt

  const cyclePlanned = planned.filter((p) => inCycle(cycle, p.dueDate))
  const plannedTotal = sum(cyclePlanned.map((p) => p.amountPaise))
  const plannedUnpaid = sum(cyclePlanned.filter((p) => !p.done).map((p) => p.amountPaise))

  const spent = variableNet(txs)
  const remaining = spendable - spent - overrun - plannedUnpaid
  const todaySpent = !notStarted && !ended ? variableNet(txs.filter((x) => x.date === today)) : 0
  const remainingAtDayStart = remaining + todaySpent
  const originalDaily = Math.max(0, floorDiv(spendable - plannedTotal, cycleDays))
  const todayLimit = notStarted || ended ? 0 : Math.max(0, floorDiv(remainingAtDayStart, daysLeft))
  const todayRemaining = todayLimit - todaySpent

  const used = spent + overrun
  const base = spendable - plannedUnpaid
  const utilizationPct = base > 0 ? Math.round((Math.max(0, used) / base) * 1000) / 10 : used > 0 ? 100 : 0
  const dailyAverage = Math.max(0, floorDiv(Math.max(0, used), dayNumber))

  let projectedLastDay: ISODate | null = null
  if (!ended && !notStarted && remaining > 0 && dailyAverage > 0) {
    const covered = Math.floor(remaining / dailyAverage)
    const last = addDays(t, covered)
    if (last < addDays(cycle.end, -1)) projectedLastDay = last
  } else if (!ended && !notStarted && remaining <= 0 && cycleDays > 0) {
    projectedLastDay = t
  }

  const warnings: string[] = []
  let status: Status = 'on-track'
  if (notStarted) {
    status = 'not-started'
  } else if (ended) {
    status = 'ended'
    warnings.push('This salary cycle has ended. Start the next cycle to get a new daily limit.')
  } else if (remaining <= 0) {
    status = 'exhausted'
    warnings.push(`The spendable budget for this cycle is used up (${formatMoney(-remaining)} over). Avoid non-essential spending until the next salary.`)
  } else if (todayRemaining < 0) {
    status = 'over'
    warnings.push(`Today's spending is ${formatMoney(-todayRemaining)} over the limit. Tomorrow's limit will be lower.`)
  } else if (utilizationPct >= 80 || (originalDaily > 0 && todayLimit < originalDaily / 2) || projectedLastDay) {
    status = 'watch'
    if (utilizationPct >= 80) warnings.push(`${utilizationPct}% of the spendable budget is used.`)
    if (originalDaily > 0 && todayLimit < originalDaily / 2)
      warnings.push(`Today's limit (${formatMoney(todayLimit)}) is below half of the original daily budget.`)
    if (projectedLastDay)
      warnings.push(`At your current pace the money runs out around ${projectedLastDay}, before the next salary.`)
  }
  if (!notStarted && !ended && overrun > 0)
    warnings.push(`Commitments cost ${formatMoney(overrun)} more than planned; this was taken from the spendable budget.`)

  const lastEntry = txs.filter(isVariable).map((x) => x.date).sort().pop()
  if (!notStarted && !ended && dayNumber > 3) {
    const gap = lastEntry ? diffDays(lastEntry, t) : dayNumber
    if (gap >= 3)
      warnings.push(
        lastEntry
          ? `No spending recorded for ${gap} days. If you did spend, add it so the limit stays accurate.`
          : `No spending recorded yet in this cycle. The limit assumes nothing has been spent.`,
      )
  }

  const L = (label: string, paise: Paise, sign: ExplainLine['sign'], note?: string): ExplainLine => ({ label, paise, sign, note })
  const explain: ExplainLine[] = [
    L('Take-home salary', cycle.takeHomePaise, '+'),
    L('Other credits this cycle', cycle.extraCreditsPaise + income, '+', 'interest, refunds-to-account, payouts'),
    L('Carry-over released into this cycle', cycle.releasedCarryPaise, '+', `of ${formatMoney(cycle.openingCarryPaise)} carry-over`),
    L('Money available this cycle', pool, '='),
    L('Fixed commitments', byKind('fixed'), '-'),
    L('Investments', byKind('investment'), '-'),
    L('Reserved / other', byKind('reserved'), '-'),
    L('Spendable budget', spendable, '='),
    L('Upcoming planned bills & purchases', plannedUnpaid, '-'),
    L('Spent so far', spent, '-', 'expenses minus refunds'),
    L('Commitments paid above plan', overrun, '-'),
    L('Remaining budget', remaining, '='),
    L(`Today's limit (÷ ${daysLeft} day${daysLeft === 1 ? '' : 's'} left)`, todayLimit, '='),
  ]

  return {
    poolPaise: pool,
    protectedPaise: protectedAmt,
    spendablePaise: spendable,
    plannedTotalPaise: plannedTotal,
    plannedUnpaidPaise: plannedUnpaid,
    variableSpentPaise: spent,
    allocationOverrunPaise: overrun,
    remainingPaise: remaining,
    remainingAtDayStartPaise: remainingAtDayStart,
    originalDailyPaise: originalDaily,
    todayLimitPaise: todayLimit,
    todaySpentPaise: todaySpent,
    todayRemainingPaise: todayRemaining,
    cycleDays,
    dayNumber,
    daysLeft: ended ? 0 : daysLeft,
    dailyAveragePaise: dailyAverage,
    utilizationPct,
    projectedLastDay,
    status,
    warnings,
    projectedCarryPaise: closingBalance(cycle, allTxs),
    allocationPaid: paid,
    explain,
  }
}

export interface DayPoint {
  date: ISODate
  spentPaise: Paise
  cumulativePaise: Paise
  remainingPaise: Paise
  idealRemainingPaise: Paise
}

/** Day-by-day series for charts (up to and including `today`, or the whole cycle if it has ended). */
export function dailySeries(cycle: Cycle, allTxs: Transaction[], today: ISODate): DayPoint[] {
  const txs = cycleTransactions(cycle, allTxs)
  const protectedAmt = sum(cycle.allocations.map((a) => a.amountPaise))
  const spendable = cycle.takeHomePaise + cycle.extraCreditsPaise + incomeTotal(txs) + cycle.releasedCarryPaise - protectedAmt
  const cycleDays = diffDays(cycle.start, cycle.end)
  const last = today >= cycle.end ? addDays(cycle.end, -1) : today
  const out: DayPoint[] = []
  let cum = 0
  for (let d = cycle.start; d <= last; d = addDays(d, 1)) {
    const spent = variableNet(txs.filter((t) => t.date === d))
    cum += spent
    const n = diffDays(cycle.start, d) + 1
    out.push({
      date: d,
      spentPaise: spent,
      cumulativePaise: cum,
      remainingPaise: spendable - cum,
      idealRemainingPaise: spendable - Math.round((spendable * n) / cycleDays),
    })
  }
  return out
}

/** Net spend per category (expenses minus refunds), largest first. Allocation payments are excluded. */
export function spendByCategory(txs: Transaction[]): { category: string; paise: Paise }[] {
  const m = new Map<string, Paise>()
  for (const t of txs.filter(isVariable)) {
    m.set(t.category, (m.get(t.category) ?? 0) + (t.type === 'expense' ? t.amountPaise : -t.amountPaise))
  }
  return [...m.entries()].map(([category, paise]) => ({ category, paise })).filter((x) => x.paise !== 0).sort((a, b) => b.paise - a.paise)
}

/** Possible duplicates: same date, amount and merchant (case-insensitive) as another transaction. */
export function findDuplicates(txs: Transaction[]): Transaction[][] {
  const groups = new Map<string, Transaction[]>()
  for (const t of txs) {
    const k = `${t.date}|${t.amountPaise}|${t.type}|${t.merchant.trim().toLowerCase()}`
    groups.set(k, [...(groups.get(k) ?? []), t])
  }
  return [...groups.values()].filter((g) => g.length > 1)
}

/** All money that left in each category, INCLUDING rent/EMI/investment payments (for reports, not for the daily budget). */
export function outflowByCategory(txs: Transaction[]): { category: string; paise: Paise }[] {
  const m = new Map<string, Paise>()
  for (const t of txs) {
    if (t.type !== 'expense' && t.type !== 'refund') continue
    m.set(t.category, (m.get(t.category) ?? 0) + (t.type === 'expense' ? t.amountPaise : -t.amountPaise))
  }
  return [...m.entries()].map(([category, paise]) => ({ category, paise })).filter((x) => x.paise !== 0).sort((a, b) => b.paise - a.paise)
}
