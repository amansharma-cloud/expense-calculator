import { dateForDay } from './bills'
import { cycleTransactions, variableNet } from './budget'
import { addDays, diffDays } from './dates'
import { formatMoney } from './money'
import type { BudgetResult, Cycle, ISODate, Paise, PlannedItem, Transaction } from './types'

/** Everything here is plain, local rule-of-thumb arithmetic on your own numbers: no AI, no network. */

export interface PreviousComparison {
  prevSpentPaise: Paise
  spentPaise: Paise
  deltaPaise: Paise
  /** Rounded percent change vs the previous cycle at the same point; null when the previous figure is zero */
  deltaPct: number | null
}

/**
 * Spending so far this cycle vs the previous cycle at the same day number.
 * Imported months only have one total per item (no dates), so for those the previous total is pro-rated by day.
 */
export function compareWithPrevious(cycle: Cycle, cycles: Cycle[], allTxs: Transaction[], today: ISODate): PreviousComparison | null {
  const prev = cycles.filter((c) => c.end <= cycle.start).sort((a, b) => b.start.localeCompare(a.start))[0]
  if (!prev) return null
  const cycleDays = diffDays(cycle.start, cycle.end)
  const dayNo = Math.min(cycleDays, Math.max(1, diffDays(cycle.start, today) + 1))
  const spent = variableNet(cycleTransactions(cycle, allTxs).filter((t) => t.date <= today))
  const prevTxs = cycleTransactions(prev, allTxs)
  const prevDays = diffDays(prev.start, prev.end)
  const prevSpent =
    prev.source === 'import'
      ? Math.round((variableNet(prevTxs) * Math.min(dayNo, prevDays)) / prevDays)
      : variableNet(prevTxs.filter((t) => t.date < addDays(prev.start, dayNo)))
  if (prevSpent <= 0 && spent <= 0) return null
  return { prevSpentPaise: prevSpent, spentPaise: spent, deltaPaise: spent - prevSpent, deltaPct: prevSpent > 0 ? Math.round(((spent - prevSpent) / prevSpent) * 100) : null }
}

export interface UpcomingItem {
  key: string
  kind: 'planned' | 'allocation'
  id: string
  title: string
  amountPaise: Paise
  date: ISODate
  /** Negative = overdue */
  daysUntil: number
  expected: boolean
}

/** Bills still to pay this cycle, soonest first: reserved/expected items and set-asides that have a due day. */
export function upcomingItems(cycle: Cycle, planned: PlannedItem[], allocationPaid: Record<string, Paise>, today: ISODate): UpcomingItem[] {
  const out: UpcomingItem[] = []
  for (const p of planned) {
    if (p.done || p.dueDate < cycle.start || p.dueDate >= cycle.end) continue
    out.push({ key: 'p-' + p.id, kind: 'planned', id: p.id, title: p.title, amountPaise: p.amountPaise, date: p.dueDate, daysUntil: diffDays(today, p.dueDate), expected: p.id.startsWith('exp-') })
  }
  for (const a of cycle.allocations) {
    if (!a.dueDay || a.amountPaise <= 0) continue
    const left = a.amountPaise - (allocationPaid[a.id] ?? 0)
    if (left <= 0) continue
    const date = dateForDay(a.dueDay, cycle.start, cycle.end)
    if (!date) continue
    out.push({ key: 'a-' + a.id, kind: 'allocation', id: a.id, title: a.name, amountPaise: left, date, daysUntil: diffDays(today, date), expected: false })
  }
  return out.sort((x, y) => x.date.localeCompare(y.date) || x.title.localeCompare(y.title))
}

export interface Tip {
  id: string
  tone: 'good' | 'warn' | 'info'
  text: string
}

const dueText = (n: number) => (n < 0 ? `was due ${-n} day${n === -1 ? '' : 's'} ago` : n === 0 ? 'is due today' : `is due in ${n} day${n === 1 ? '' : 's'}`)

export function smartTips(args: {
  budget: BudgetResult
  upcoming: UpcomingItem[]
  comparison: PreviousComparison | null
  cycle: Cycle
  txs: Transaction[]
  today: ISODate
}): Tip[] {
  const { budget: b, upcoming, comparison, cycle, txs, today } = args
  const tips: Tip[] = []

  const soon = upcoming.filter((u) => u.daysUntil <= 3)[0]
  if (soon) tips.push({ id: 'bill', tone: soon.daysUntil < 0 ? 'warn' : 'info', text: `${soon.title} ${dueText(soon.daysUntil)} (${formatMoney(soon.amountPaise)}). Tap Paid when you have paid it.` })

  const last = txs.filter((t) => t.date >= cycle.start && t.date <= today && (t.type === 'expense' || t.type === 'refund') && !t.allocationId).map((t) => t.date).sort().pop()
  const gap = last ? diffDays(last, today) : b.dayNumber
  if (b.status !== 'ended' && b.status !== 'not-started' && b.dayNumber > 3 && gap >= 3)
    tips.push({ id: 'gap', tone: 'warn', text: `No expenses recorded for ${gap} days. If you spent anything, add it so today’s limit stays accurate.` })

  if (comparison && comparison.deltaPct !== null && Math.abs(comparison.deltaPct) >= 8) {
    const less = comparison.deltaPct < 0
    tips.push({ id: 'trend', tone: less ? 'good' : 'warn', text: `You are spending ${Math.abs(comparison.deltaPct)}% ${less ? 'less' : 'more'} than at this point last cycle (${formatMoney(Math.abs(comparison.deltaPaise))} ${less ? 'less' : 'more'}).` })
  }

  if (b.status === 'on-track' && b.originalDailyPaise > 0 && b.todayLimitPaise >= b.originalDailyPaise * 1.1 && b.dayNumber > 1)
    tips.push({ id: 'ahead', tone: 'good', text: `You are ahead of plan: today’s limit is ${formatMoney(Math.floor(b.todayLimitPaise / 100) * 100)}, above the ${formatMoney(Math.floor(b.originalDailyPaise / 100) * 100)} you started the cycle with.` })

  if (b.status === 'watch' || b.status === 'over' || b.status === 'exhausted')
    tips.push({ id: 'slow', tone: 'warn', text: 'Spending is running ahead of plan. Keeping the next few days under the limit brings it back on track.' })

  if (!tips.length) tips.push({ id: 'default', tone: 'info', text: 'Add expenses as you spend: it takes a few seconds and keeps today’s limit accurate.' })
  return tips
}
