/** All money is an integer in minor units (paise, cents…; 100 per unit). The type is still called Paise. All dates are local 'YYYY-MM-DD' strings. */
export type Paise = number
export type ISODate = string

export type AllocationKind = 'fixed' | 'investment' | 'reserved'

/** Money set aside from income before any spending is allowed. */
export interface Allocation {
  id: string
  name: string
  kind: AllocationKind
  amountPaise: Paise
  /** Day of the month this is due. With non-monthly pay it only applies in the cycle that contains that day. */
  dueDay?: number
}

/**
 * expense  – money spent (reduces budget)
 * refund   – money returned for an earlier expense (increases budget)
 * income   – one-off credit during the cycle: interest, payout, … (increases pool)
 * transfer – own-account movement, card bill payment, … (ignored by the budget)
 */
export type TxType = 'expense' | 'refund' | 'income' | 'transfer'

export type PayMethod = 'cash' | 'upi' | 'card' | 'bank' | 'other'

export interface Transaction {
  id: string
  date: ISODate
  time: string // 'HH:MM'
  amountPaise: Paise // always positive; direction comes from `type`
  type: TxType
  category: string
  merchant: string
  method: PayMethod
  card?: string
  note: string
  /** Set when this payment settles a fixed/investment allocation (so it is not counted twice). */
  allocationId?: string
  /** Set when this expense settles a planned item. */
  plannedId?: string
  source: 'manual' | 'quick' | 'import'
  importHash?: string
  createdAt: string
}

export interface PlannedItem {
  id: string
  title: string
  amountPaise: Paise
  dueDate: ISODate
  done: boolean
  category?: string
}

/**
 * One salary cycle. It stores a snapshot of the plan it was created with, so
 * changing salary/allocations later never rewrites an older cycle.
 */
export interface Cycle {
  start: ISODate
  /** Exclusive: the day the next cycle starts (next salary date). */
  end: ISODate
  takeHomePaise: Paise
  extraCreditsPaise: Paise
  openingCarryPaise: Paise
  /** Slice of the carry-over released into this cycle's spendable pool. */
  releasedCarryPaise: Paise
  allocations: Allocation[]
  label?: string
  source: 'app' | 'import'
  /** Importer only: the balance the original sheet reported, for reconciliation. */
  sheetBalancePaise?: Paise
}

/** How often pay arrives. A cycle runs from one payday to the day before the next. */
export type PayCycle =
  | { kind: 'monthly'; day: number }
  | { kind: 'semimonthly'; days: [number, number] }
  | { kind: 'interval'; everyDays: 7 | 14; anchor: ISODate }

export interface Plan {
  /** ISO 4217 code of a supported currency (see currency.ts). Missing = INR. */
  currency?: string
  /** Pay day for monthly pay (also used by the Excel importer). */
  salaryDay: number
  /** Pay frequency. Missing = monthly on `salaryDay`. */
  pay?: PayCycle
  takeHomePaise: Paise
  releasedCarryPaise: Paise
  allocations: Allocation[]
  categories: string[]
  theme: 'system' | 'light' | 'dark'
}

export type Status = 'on-track' | 'watch' | 'over' | 'exhausted' | 'not-started' | 'ended'

export interface ExplainLine {
  label: string
  paise: Paise
  sign: '+' | '-' | '='
  note?: string
}

export interface BudgetResult {
  poolPaise: Paise
  protectedPaise: Paise
  spendablePaise: Paise
  plannedTotalPaise: Paise
  plannedUnpaidPaise: Paise
  variableSpentPaise: Paise
  allocationOverrunPaise: Paise
  remainingPaise: Paise
  /** Budget left at the start of today (before today's spending). */
  remainingAtDayStartPaise: Paise
  originalDailyPaise: Paise
  todayLimitPaise: Paise
  todaySpentPaise: Paise
  todayRemainingPaise: Paise
  cycleDays: number
  dayNumber: number
  daysLeft: number
  dailyAveragePaise: Paise
  utilizationPct: number
  projectedLastDay: ISODate | null
  status: Status
  warnings: string[]
  /** Closing balance if the cycle ended now: what would carry over. */
  projectedCarryPaise: Paise
  allocationPaid: Record<string, Paise>
  explain: ExplainLine[]
}
