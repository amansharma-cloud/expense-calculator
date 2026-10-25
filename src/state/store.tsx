import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  createProfile, deleteProfile, emptyData, lastProfileId, listProfiles, openProfile, rememberProfile, renameProfile, requestPersistence, setLastBackup,
  type ProfileData, type ProfileMeta, type Session, WrongPinError,
} from '../db/storage'
import { closingBalance, computeBudget } from '../engine/budget'
import { cycleBounds, todayISO } from '../engine/dates'
import { DEFAULT_CATEGORIES } from '../engine/quick'
import type { Allocation, BudgetResult, Cycle, Paise, Plan, PlannedItem, Transaction } from '../engine/types'
import type { ImportPlan } from '../import/excel'

const uid = () => crypto.randomUUID()

export const defaultPlan = (): Plan => ({
  salaryDay: 25,
  takeHomePaise: 0,
  releasedCarryPaise: 0,
  allocations: [],
  categories: [...DEFAULT_CATEGORIES],
  theme: 'system',
})

export interface NewCycleInput {
  takeHomePaise: Paise
  extraCreditsPaise: Paise
  openingCarryPaise: Paise
  releasedCarryPaise: Paise
}

interface Store {
  // profiles
  profiles: ProfileMeta[]
  active: ProfileMeta | null
  locked: ProfileMeta | null // a PIN-protected profile waiting for its PIN
  ready: boolean
  refreshProfiles(): Promise<void>
  selectProfile(id: string, pin?: string): Promise<void>
  addProfile(name: string, pin?: string): Promise<void>
  removeProfile(id: string): Promise<void>
  renameActive(name: string): Promise<void>
  setPin(pin: string | null): Promise<void>
  lock(): void
  switchAway(): void
  // data
  data: ProfileData
  today: string
  plan: Plan
  cycle: Cycle | null
  budget: BudgetResult | null
  suggestedOpeningCarry: Paise
  categories: string[]
  addTx(t: Omit<Transaction, 'id' | 'createdAt'>): Promise<Transaction>
  updateTx(t: Transaction): Promise<void>
  deleteTx(id: string): Promise<void>
  addPlanned(p: Omit<PlannedItem, 'id' | 'done'>): Promise<void>
  deletePlanned(id: string): Promise<void>
  payPlanned(p: PlannedItem, tx: Omit<Transaction, 'id' | 'createdAt'>): Promise<void>
  savePlan(plan: Plan): Promise<void>
  startCycle(input: NewCycleInput, planOverride?: Plan): Promise<void>
  updateCycle(c: Cycle): Promise<void>
  applyImport(plan: ImportPlan, makePlanFromLatest: boolean): Promise<void>
  replaceAll(data: ProfileData): Promise<void>
  wipe(): Promise<void>
  markBackedUp(): Promise<void>
  exportData(): ProfileData
}

const Ctx = createContext<Store | null>(null)
export const useStore = (): Store => {
  const s = useContext(Ctx)
  if (!s) throw new Error('StoreProvider missing')
  return s
}

const IDLE_LOCK_MS = 5 * 60 * 1000

export function StoreProvider({ children }: { children: ReactNode }) {
  const [profiles, setProfiles] = useState<ProfileMeta[]>([])
  const [active, setActive] = useState<ProfileMeta | null>(null)
  const [locked, setLocked] = useState<ProfileMeta | null>(null)
  const [ready, setReady] = useState(false)
  const [data, setData] = useState<ProfileData>(emptyData())
  const [today, setToday] = useState(todayISO())
  const session = useRef<Session | null>(null)
  const openSeq = useRef(0)
  const booted = useRef(false)

  const refreshProfiles = useCallback(async () => setProfiles(await listProfiles()), [])

  const closeSession = useCallback(() => {
    openSeq.current++
    session.current?.close()
    session.current = null
    setActive(null)
    setData(emptyData())
  }, [])

  const selectProfile = useCallback(async (id: string, pin?: string) => {
    const list = await listProfiles()
    const meta = list.find((p) => p.id === id)
    if (!meta) throw new Error('Profile not found')
    if (meta.locked && !pin) {
      closeSession()
      setLocked(meta)
      return
    }
    const seq = ++openSeq.current
    const s = await openProfile(meta, pin) // throws WrongPinError
    const loaded = await s.load()
    if (seq !== openSeq.current) { s.close(); return } // a newer open/close superseded this one
    session.current?.close()
    session.current = s
    setData(loaded)
    setActive(meta)
    setLocked(null)
    setProfiles(list)
    rememberProfile(id)
    void requestPersistence()
  }, [closeSession])

  const addProfile = useCallback(async (name: string, pin?: string) => {
    const meta = await createProfile(name, pin)
    await selectProfile(meta.id, pin)
  }, [selectProfile])

  const removeProfile = useCallback(async (id: string) => {
    if (active?.id === id) {
      closeSession()
      rememberProfile(null)
    }
    if (locked?.id === id) setLocked(null)
    await deleteProfile(id)
    await refreshProfiles()
  }, [active, locked, closeSession, refreshProfiles])

  const renameActive = useCallback(async (name: string) => {
    if (!active) return
    await renameProfile(active.id, name)
    setActive({ ...active, name: name.trim() || 'Me' })
    await refreshProfiles()
  }, [active, refreshProfiles])

  const setPin = useCallback(async (pin: string | null) => {
    if (!session.current) return
    await session.current.setPin(pin)
    setActive({ ...session.current.meta })
    await refreshProfiles()
  }, [refreshProfiles])

  const lock = useCallback(() => {
    if (active?.locked) {
      const m = active
      closeSession()
      setLocked(m)
    }
  }, [active, closeSession])

  const switchAway = useCallback(() => {
    closeSession()
    setLocked(null)
    rememberProfile(null)
  }, [closeSession])

  // First load: reopen the last profile if it has no PIN.
  useEffect(() => {
    if (booted.current) return
    booted.current = true
    void (async () => {
      const list = await listProfiles()
      setProfiles(list)
      const last = lastProfileId()
      const meta = list.find((p) => p.id === last)
      if (meta && !meta.locked) await selectProfile(meta.id)
      else if (!meta && list.length === 1 && !list[0].locked) await selectProfile(list[0].id)
      setReady(true)
    })()
  }, [selectProfile])

  // "Today" follows the clock, so the daily limit rolls over at midnight without a reload.
  useEffect(() => {
    const t = setInterval(() => setToday((d) => (todayISO() !== d ? todayISO() : d)), 30_000)
    const onVis = () => document.visibilityState === 'visible' && setToday(todayISO())
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis) }
  }, [])

  // PIN-protected profiles lock themselves after being hidden for a while.
  useEffect(() => {
    if (!active?.locked) return
    let hiddenAt = 0
    const onVis = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now()
      else if (hiddenAt && Date.now() - hiddenAt > IDLE_LOCK_MS) lock()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [active, lock])

  const plan = data.plan ?? defaultPlan()

  const cycle = useMemo(
    () => data.cycles.find((c) => today >= c.start && today < c.end) ?? null,
    [data.cycles, today],
  )
  const budget = useMemo(
    () => (cycle ? computeBudget(cycle, data.transactions, data.planned, today) : null),
    [cycle, data.transactions, data.planned, today],
  )
  const suggestedOpeningCarry = useMemo(() => {
    const prev = data.cycles.filter((c) => c.end <= today).sort((a, b) => b.start.localeCompare(a.start))[0]
    return prev ? closingBalance(prev, data.transactions) : 0
  }, [data.cycles, data.transactions, today])

  const categories = useMemo(() => {
    const set = new Set(plan.categories)
    return [...set]
  }, [plan.categories])

  // ---- mutations (state first for instant UI, then persist) ----
  const s = () => {
    if (!session.current) throw new Error('No open profile')
    return session.current
  }

  const addTx: Store['addTx'] = async (t) => {
    const tx: Transaction = { ...t, id: uid(), createdAt: new Date().toISOString() }
    await s().put('transactions', tx.id, tx)
    setData((d) => ({ ...d, transactions: [...d.transactions, tx] }))
    return tx
  }
  const updateTx: Store['updateTx'] = async (t) => {
    await s().put('transactions', t.id, t)
    setData((d) => ({ ...d, transactions: d.transactions.map((x) => (x.id === t.id ? t : x)) }))
  }
  const deleteTx: Store['deleteTx'] = async (id) => {
    await s().remove('transactions', id)
    setData((d) => {
      const gone = d.transactions.find((x) => x.id === id)
      return {
        ...d,
        transactions: d.transactions.filter((x) => x.id !== id),
        planned: gone?.plannedId ? d.planned.map((p) => (p.id === gone.plannedId ? { ...p, done: false } : p)) : d.planned,
      }
    })
    const gone = data.transactions.find((x) => x.id === id)
    if (gone?.plannedId) {
      const p = data.planned.find((x) => x.id === gone.plannedId)
      if (p) await s().put('planned', p.id, { ...p, done: false })
    }
  }
  const addPlanned: Store['addPlanned'] = async (p) => {
    const item: PlannedItem = { ...p, id: uid(), done: false }
    await s().put('planned', item.id, item)
    setData((d) => ({ ...d, planned: [...d.planned, item] }))
  }
  const deletePlanned: Store['deletePlanned'] = async (id) => {
    await s().remove('planned', id)
    setData((d) => ({ ...d, planned: d.planned.filter((p) => p.id !== id) }))
  }
  const payPlanned: Store['payPlanned'] = async (p, t) => {
    const tx: Transaction = { ...t, id: uid(), createdAt: new Date().toISOString(), plannedId: p.id }
    const done = { ...p, done: true }
    await s().put('transactions', tx.id, tx)
    await s().put('planned', p.id, done)
    setData((d) => ({ ...d, transactions: [...d.transactions, tx], planned: d.planned.map((x) => (x.id === p.id ? done : x)) }))
  }

  /**
   * Saving the plan changes the plan template and the CURRENT cycle only.
   * Closed cycles keep their own snapshot, so history never changes.
   */
  const savePlan: Store['savePlan'] = async (p) => {
    await s().put('plan', 'plan', p)
    let nextCycle: Cycle | null = null
    if (cycle) {
      nextCycle = { ...cycle, takeHomePaise: p.takeHomePaise, releasedCarryPaise: Math.min(p.releasedCarryPaise, Math.max(0, cycle.openingCarryPaise)), allocations: p.allocations }
      await s().put('cycles', nextCycle.start, nextCycle)
    }
    setData((d) => ({ ...d, plan: p, cycles: nextCycle ? d.cycles.map((c) => (c.start === nextCycle!.start ? nextCycle! : c)) : d.cycles }))
  }

  const startCycle: Store['startCycle'] = async (input, planOverride) => {
    const pl = planOverride ?? plan
    const { start, end } = cycleBounds(today, pl.salaryDay)
    const c: Cycle = {
      start, end, ...input,
      releasedCarryPaise: Math.min(input.releasedCarryPaise, Math.max(0, input.openingCarryPaise)),
      allocations: pl.allocations.map((a: Allocation) => ({ ...a })),
      source: 'app',
    }
    await s().put('cycles', c.start, c)
    await s().put('plan', 'plan', pl)
    setData((d) => ({ ...d, plan: pl, cycles: [...d.cycles.filter((x) => x.start !== c.start), c] }))
  }

  const updateCycle: Store['updateCycle'] = async (c) => {
    await s().put('cycles', c.start, c)
    setData((d) => ({ ...d, cycles: d.cycles.map((x) => (x.start === c.start ? c : x)) }))
  }

  const applyImport: Store['applyImport'] = async (imp, makePlanFromLatest) => {
    const ses = s()
    await ses.putMany('cycles', imp.cycles.map((c) => ({ id: c.start, value: c })))
    await ses.putMany('transactions', imp.transactions.map((t) => ({ id: t.id, value: t })))
    let nextPlan = data.plan
    if (makePlanFromLatest && imp.cycles.length) {
      const latest = [...imp.cycles].sort((a, b) => b.start.localeCompare(a.start))[0]
      const base = data.plan ?? defaultPlan()
      const recent = [...imp.cycles].sort((a, b) => b.start.localeCompare(a.start)).slice(0, 3).map((c) => c.start)
      const cats = new Set(base.categories)
      for (const t of imp.transactions) if (!t.allocationId && recent.some((r) => t.date >= r)) cats.add(t.category)
      // A "Savings" line is the spendable buffer held at cycle start, not a protected set-aside:
      // it becomes the default release from carry-over instead of an allocation.
      const isBuffer = (a: Allocation) => a.kind === 'reserved' && /^savings\b/i.test(a.name)
      nextPlan = {
        ...base,
        takeHomePaise: latest.takeHomePaise,
        releasedCarryPaise: latest.allocations.filter(isBuffer).reduce((s, a) => s + a.amountPaise, 0),
        allocations: latest.allocations.filter((a) => !isBuffer(a)).map((a) => ({ ...a, id: uid() })),
        categories: [...cats],
      }
      await ses.put('plan', 'plan', nextPlan)
    }
    setData((d) => ({ ...d, plan: nextPlan, cycles: [...d.cycles, ...imp.cycles], transactions: [...d.transactions, ...imp.transactions] }))
  }

  const replaceAll: Store['replaceAll'] = async (next) => {
    const ses = s()
    await ses.wipe()
    if (next.plan) await ses.put('plan', 'plan', next.plan)
    await ses.putMany('cycles', next.cycles.map((c) => ({ id: c.start, value: c })))
    await ses.putMany('transactions', next.transactions.map((t) => ({ id: t.id, value: t })))
    await ses.putMany('planned', next.planned.map((p) => ({ id: p.id, value: p })))
    setData(next)
  }

  const markBackedUp: Store['markBackedUp'] = async () => {
    if (!active) return
    const iso = new Date().toISOString()
    await setLastBackup(active.id, iso)
    setActive((m) => (m ? { ...m, lastBackupAt: iso } : m))
  }

  const wipe: Store['wipe'] = async () => {
    await s().wipe()
    setData(emptyData())
  }

  const value: Store = {
    profiles, active, locked, ready, refreshProfiles, selectProfile, addProfile, removeProfile, renameActive, setPin, lock, switchAway,
    data, today, plan, cycle, budget, suggestedOpeningCarry, categories,
    addTx, updateTx, deleteTx, addPlanned, deletePlanned, payPlanned, savePlan, startCycle, updateCycle, applyImport, replaceAll, wipe, markBackedUp,
    exportData: () => data,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export { WrongPinError }
