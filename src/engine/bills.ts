import { addDays, daysInMonth } from './dates'
import { billsAreIn } from './pay'
import type { Cycle, ExpectedBill, ISODate, PayCycle, Plan, PlannedItem, Transaction } from './types'

/** The planned (reserved) items that the expected bills create for one cycle. Ids are stable, so this never duplicates. */
export function billsForCycle(bills: ExpectedBill[] | undefined, start: ISODate, end: ISODate, pay: PayCycle): PlannedItem[] {
  const out: PlannedItem[] = []
  const last = addDays(end, -1)
  for (const b of bills ?? []) {
    let due: ISODate | null = last
    if (b.dueDay) {
      due = null
      for (let d = start; d < end; d = addDays(d, 1)) {
        const [y, m, dd] = d.split('-').map(Number)
        if (dd === Math.min(b.dueDay, daysInMonth(y, m))) { due = d; break }
      }
      // monthly pay: one cycle per month, so a bill whose day fell on a boundary still belongs to this cycle
      if (!due && billsAreIn(pay)) due = last
    }
    if (!due) continue // this bill's day is in a different pay period
    out.push({ id: `exp-${b.id}-${start}`, title: b.name, amountPaise: b.estimatePaise, dueDate: due, done: false, category: b.category })
  }
  return out
}

export interface ConvertInput {
  plan: Plan
  cycles: Cycle[]
  transactions: Transaction[]
  planned: PlannedItem[]
}
export interface ConvertResult {
  plan: Plan
  changedCycles: Cycle[]
  changedTransactions: Transaction[]
  addedPlanned: PlannedItem[]
  /** How many cycles had the item removed. */
  cyclesTouched: number
}

/**
 * Turn a fixed set-aside into ordinary spending or into an expected bill.
 *  - removed from the plan and from the current cycle (and from past cycles when `pastCycles`),
 *  - its payments stop being "commitment payments" and count as spending,
 *  - closed cycles keep exactly the same closing balance (planned = paid, now counted as spending),
 *  - `to: 'expected'` also adds an expected bill (estimate = what it was set aside for) and, if it hasn't been paid yet
 *    this cycle, reserves it for the current cycle.
 */
export function convertAllocation(
  input: ConvertInput, name: string, to: 'spending' | 'expected', opts: { pastCycles: boolean; today: ISODate; pay: PayCycle; newId: () => string },
): ConvertResult {
  const same = (n: string) => n.trim().toLowerCase() === name.trim().toLowerCase()
  const fromPlan = input.plan.allocations.find((a) => same(a.name))
  const plan: Plan = { ...input.plan, allocations: input.plan.allocations.filter((a) => !same(a.name)), categories: [...input.plan.categories] }
  if (!plan.categories.includes(name)) plan.categories.push(name)

  const removedIds = new Set<string>()
  const changedCycles: Cycle[] = []
  let currentCycle: Cycle | undefined
  let latestAmount = fromPlan?.amountPaise ?? 0
  for (const c of input.cycles) {
    const isCurrent = opts.today >= c.start && opts.today < c.end
    const isPast = c.end <= opts.today
    if (isCurrent) currentCycle = c
    if (!(isCurrent || (isPast && opts.pastCycles))) continue
    const hit = c.allocations.filter((a) => same(a.name))
    if (!hit.length) continue
    hit.forEach((a) => removedIds.add(a.id))
    if (isCurrent && !fromPlan) latestAmount = hit[0].amountPaise
    changedCycles.push({ ...c, allocations: c.allocations.filter((a) => !same(a.name)) })
  }
  const changedTransactions = input.transactions.filter((t) => t.allocationId && removedIds.has(t.allocationId)).map((t) => ({ ...t, allocationId: undefined }))

  let addedPlanned: PlannedItem[] = []
  if (to === 'expected') {
    const bill: ExpectedBill = { id: opts.newId(), name, estimatePaise: latestAmount, dueDay: fromPlan?.dueDay, category: name }
    plan.expectedBills = [...(plan.expectedBills ?? []).filter((b) => !same(b.name)), bill]
    if (currentCycle) {
      const paidThisCycle = changedTransactions.some((t) => t.date >= currentCycle!.start && t.date < currentCycle!.end)
      if (!paidThisCycle) addedPlanned = billsForCycle([bill], currentCycle.start, currentCycle.end, opts.pay).filter((p) => !input.planned.some((x) => x.id === p.id))
    }
  }
  return { plan, changedCycles, changedTransactions, addedPlanned, cyclesTouched: changedCycles.length }
}
