import { cycleLabel, isValidDate } from '../engine/dates'
import { closingBalance } from '../engine/budget'
import { getCurrency, isCurrencyCode } from '../engine/currency'
import { toDecimalString } from '../engine/money'
import type { Cycle, Plan, Transaction } from '../engine/types'
import { emptyData, type ProfileData } from './storage'

export const BACKUP_SCHEMA = 1

export interface BackupFile {
  app: 'daily-spend'
  schema: number
  exportedAt: string
  profileName: string
  data: ProfileData
}

/** NOTE: backups are plain JSON (not encrypted), even if the profile has a PIN. Keep the file somewhere private. */
export function makeBackup(profileName: string, data: ProfileData, now = new Date()): string {
  const file: BackupFile = { app: 'daily-spend', schema: BACKUP_SCHEMA, exportedAt: now.toISOString(), profileName, data }
  return JSON.stringify(file, null, 2)
}

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n)
const isStr = (s: unknown): s is string => typeof s === 'string'
const TYPES = ['expense', 'refund', 'income', 'transfer']
const KINDS = ['fixed', 'investment', 'reserved']

function checkAllocations(list: unknown, where: string) {
  if (!Array.isArray(list)) throw new Error(`${where}: allocations missing`)
  for (const a of list as Record<string, unknown>[]) {
    if (!isStr(a.id) || !isStr(a.name) || !KINDS.includes(a.kind as string) || !isInt(a.amountPaise) || (a.amountPaise as number) < 0)
      throw new Error(`${where}: invalid allocation "${String(a.name)}"`)
  }
}

/** Strict validation: a restore must never write malformed money or dates into the database. */
export function parseBackup(text: string): { profileName: string; data: ProfileData } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('This is not a valid JSON file.')
  }
  const f = raw as Partial<BackupFile>
  if (!f || f.app !== 'daily-spend') throw new Error('This file is not a Daily Spend backup.')
  if (f.schema !== BACKUP_SCHEMA) throw new Error(`Unsupported backup version ${String(f.schema)}.`)
  const d = f.data
  if (!d || !Array.isArray(d.cycles) || !Array.isArray(d.transactions) || !Array.isArray(d.planned)) throw new Error('Backup data is incomplete.')

  const data = emptyData()
  if (d.plan) {
    const p = d.plan as Plan
    if (!isInt(p.salaryDay) || p.salaryDay < 1 || p.salaryDay > 31 || !isInt(p.takeHomePaise) || !isInt(p.releasedCarryPaise) || !Array.isArray(p.categories))
      throw new Error('Backup plan is invalid.')
    if (p.currency !== undefined && !isCurrencyCode(p.currency)) throw new Error(`Backup uses an unsupported currency (${String(p.currency)}).`)
    checkAllocations(p.allocations, 'plan')
    data.plan = p
  }
  for (const c of d.cycles as Cycle[]) {
    if (!isValidDate(c.start) || !isValidDate(c.end) || c.end <= c.start) throw new Error(`Invalid cycle dates (${String(c.start)}).`)
    for (const k of ['takeHomePaise', 'extraCreditsPaise', 'openingCarryPaise', 'releasedCarryPaise'] as const)
      if (!isInt(c[k])) throw new Error(`Cycle ${c.start}: ${k} is not a whole number of paise.`)
    checkAllocations(c.allocations, `cycle ${c.start}`)
    data.cycles.push(c)
  }
  const seen = new Set<string>()
  for (const t of d.transactions as Transaction[]) {
    if (!isStr(t.id) || seen.has(t.id)) throw new Error('Duplicate or missing transaction id.')
    seen.add(t.id)
    if (!isValidDate(t.date)) throw new Error(`Transaction ${t.id}: invalid date.`)
    if (!isInt(t.amountPaise) || t.amountPaise <= 0) throw new Error(`Transaction ${t.id}: invalid amount.`)
    if (!TYPES.includes(t.type)) throw new Error(`Transaction ${t.id}: invalid type.`)
    data.transactions.push(t)
  }
  for (const p of d.planned) {
    if (!isStr(p.id) || !isInt(p.amountPaise) || !isValidDate(p.dueDate)) throw new Error('Invalid planned item in backup.')
    data.planned.push(p)
  }
  return { profileName: isStr(f.profileName) ? f.profileName : 'Restored', data }
}

export const BACKUP_REMINDER_DAYS = 14

/** Should the user be nudged to back up? Only when there is data worth losing. */
export function backupDue(lastBackupAt: string | undefined, now: Date, hasData: boolean, days = BACKUP_REMINDER_DAYS): { due: boolean; daysSince: number | null } {
  if (!hasData) return { due: false, daysSince: null }
  if (!lastBackupAt) return { due: true, daysSince: null }
  const t = Date.parse(lastBackupAt)
  if (!Number.isFinite(t)) return { due: true, daysSince: null }
  const daysSince = Math.floor((now.getTime() - t) / 86_400_000)
  return { due: daysSince >= days, daysSince }
}

/**
 * Backup status for a profile. With cloud sync on, a recent successful sync counts as a backup (the encrypted
 * cloud copy plus daily restore points), so the reminder is gentler (30 days) and refers to a file backup.
 */
export function backupStatus(meta: { lastBackupAt?: string; sync?: { enabled: true; lastSyncAt?: string } } | null, now: Date, hasData: boolean) {
  const synced = !!meta?.sync?.enabled
  const times = [meta?.lastBackupAt, synced ? meta?.sync?.lastSyncAt : undefined].filter(Boolean) as string[]
  const latest = times.sort().pop()
  return { ...backupDue(latest, now, hasData, synced ? 30 : BACKUP_REMINDER_DAYS), synced }
}

export const backupFileName = (profileName: string, now = new Date()) =>
  `expense-calculator-${profileName.replace(/\W+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'profile'}-${now.toISOString().slice(0, 10)}.json`

// ---------- CSV / XLSX export ----------

/** Quote a CSV field; neutralise spreadsheet formulas (=, +, -, @) in text so a note cannot run as a formula. */
function csvCell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? "'" + v : v
  return /[",\n\r]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe
}

const txHeaders = () => ['Date', 'Time', 'Type', `Amount (${getCurrency().code})`, 'Category', 'Merchant / Description', 'Payment method', 'Card', 'Note', 'Source']

const txRow = (t: Transaction) => [t.date, t.time, t.type, toDecimalString(t.amountPaise), t.category, t.merchant, t.method, t.card ?? '', t.note, t.source]

export function transactionsToCSV(txs: Transaction[]): string {
  const rows = [...txs].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).map(txRow)
  return [txHeaders(), ...rows].map((r) => r.map((c) => csvCell(String(c))).join(',')).join('\r\n') + '\r\n'
}

export async function exportWorkbook(data: ProfileData): Promise<Uint8Array<ArrayBuffer>> {
  const XLSX = await import('xlsx') // loaded only when someone exports to Excel
  const wb = XLSX.utils.book_new()
  const txs = [...data.transactions].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
  const txSheet = XLSX.utils.aoa_to_sheet([
    txHeaders(),
    ...txs.map((t) => {
      const r = txRow(t)
      r[3] = t.amountPaise / 100 as unknown as string
      return r.map((c, i) => (i !== 3 && typeof c === 'string' && /^[=+\-@]/.test(c) ? "'" + c : c))
    }),
  ])
  XLSX.utils.book_append_sheet(wb, txSheet, 'Transactions')
  const cycles = [...data.cycles].sort((a, b) => a.start.localeCompare(b.start))
  const sum = XLSX.utils.aoa_to_sheet([
    ['Cycle', `Opening carry-over (${getCurrency().code})`, 'Salary', 'Other credits', 'Allocations', 'Spent (variable)', 'Closing balance'],
    ...cycles.map((c) => {
      const inC = data.transactions.filter((t) => t.date >= c.start && t.date < c.end)
      const alloc = c.allocations.reduce((s, a) => s + a.amountPaise, 0)
      const spent = inC.filter((t) => !t.allocationId && t.type === 'expense').reduce((s, t) => s + t.amountPaise, 0)
      return [cycleLabel(c.start, c.end), c.openingCarryPaise / 100, c.takeHomePaise / 100, c.extraCreditsPaise / 100, alloc / 100, spent / 100, closingBalance(c, data.transactions) / 100]
    }),
  ])
  XLSX.utils.book_append_sheet(wb, sum, 'Cycles')
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
}

export function downloadBlob(name: string, content: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
