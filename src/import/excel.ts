import * as XLSX from 'xlsx'
import { closingBalance } from '../engine/budget'
import { salaryDateIn } from '../engine/dates'
import { formatMoney, sum } from '../engine/money'
import type { Allocation, AllocationKind, Cycle, Paise, Transaction } from '../engine/types'
import type { ProfileData } from '../db/storage'

/**
 * Importer for the "<Month> <Year> Expenses" sheet layout used in the original tracker:
 *   A = item, B = amount, row 2 = "Total Salary" (formula: carry-over + salary + other credits), C2 = Balance.
 * Nothing is written until the user confirms the preview. Rows are never silently dropped:
 * unknown labels become spending categories, and every mismatch is reported.
 */

/** `expected` = a bill that comes every month with a varying amount (electricity, recharge): spending in history, an estimate going forward. */
export type RowGroup = AllocationKind | 'variable' | 'expected' | 'skip'

export interface ParsedRow {
  label: string
  amountPaise: Paise
  formula?: string
  group: RowGroup
  category: string
  issue?: string
}

export interface ParsedSheet {
  sheetName: string
  year: number
  month: number
  cycleStart: string
  cycleEnd: string
  totalPaise: Paise
  terms: Paise[] | null
  openingCarryPaise: Paise
  salaryPaise: Paise
  extraCreditsPaise: Paise
  sheetBalancePaise: Paise | null
  computedBalancePaise: Paise
  rows: ParsedRow[]
  issues: string[]
}

export interface ParseResult {
  sheets: ParsedSheet[]
  ignored: string[]
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const p = (n: number): Paise => Math.round(n * 100)

export type Overrides = Record<string, RowGroup>

/** Default grouping of a row label. Anything not recognised is kept as a spending category. */
export function classify(label: string): RowGroup {
  const n = norm(label)
  if (n === 'total salary') return 'skip'
  if (/^savings( \d+)?$/.test(n)) return 'reserved'
  if (/credit card|\bcc\b/.test(n)) return 'variable' // a card bill is spending in the old sheet, not an investment
  if (/jupiter|mutual fund|digital gold|\brd\b|\bsip\b|\blic\b|\bppf\b|\bnps\b/.test(n)) return 'investment'
  if (/electricity|\brecharge\b|\be bill\b/.test(n)) return 'expected'
  if (/^rent\b|^mom\b|\bemi\b|wifi|maid/.test(n)) return 'fixed'
  return 'variable'
}

function parseTerms(formula: string | undefined): Paise[] | null {
  if (!formula) return null
  const f = formula.replace(/^=/, '').replace(/\s+/g, '')
  if (!/^[+\-]?\d+(\.\d+)?([+\-]\d+(\.\d+)?)*$/.test(f)) return null
  return (f.match(/[+\-]?\d+(\.\d+)?/g) ?? []).map((t) => p(Number(t)))
}

const cellNum = (ws: XLSX.WorkSheet, addr: string): number | null => {
  const c = ws[addr]
  return c && typeof c.v === 'number' && Number.isFinite(c.v) ? c.v : null
}

export function parseWorkbook(buf: ArrayBuffer, salaryDay: number, overrides: Overrides = {}): ParseResult {
  const wb = XLSX.read(buf, { type: 'array', cellFormula: true })
  const sheets: ParsedSheet[] = []
  const ignored: string[] = []

  for (const name of wb.SheetNames) {
    const m = name.match(/^([A-Za-z]+)\s+(\d{4})\s+Expenses$/)
    const month = m ? MONTHS.indexOf(m[1].toLowerCase()) + 1 : 0
    if (!m || month === 0) {
      ignored.push(name)
      continue
    }
    const ws = wb.Sheets[name]
    const year = Number(m[2])
    const issues: string[] = []
    const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1:A1')

    let totalRow = -1
    for (let r = range.s.r; r <= range.e.r; r++) {
      if (norm(String(ws[`A${r + 1}`]?.v ?? '')) === 'total salary') { totalRow = r + 1; break }
    }
    const total = totalRow > 0 ? cellNum(ws, `B${totalRow}`) : null
    if (totalRow < 0 || total === null) {
      issues.push('Could not find a numeric "Total Salary" row, so this sheet cannot be imported.')
      ignored.push(`${name} (no Total Salary row)`)
      continue
    }
    const terms = parseTerms(ws[`B${totalRow}`]?.f)
    const totalPaise = p(total)
    if (terms && sum(terms) !== totalPaise) issues.push(`Total Salary formula adds up to ${formatMoney(sum(terms), { decimals: true })} but the cell shows ${formatMoney(totalPaise, { decimals: true })}.`)

    const rows: ParsedRow[] = []
    const seen = new Set<string>()
    for (let r = totalRow + 1; r <= range.e.r + 1; r++) {
      const label = String(ws[`A${r}`]?.v ?? '').trim()
      const cell = ws[`B${r}`]
      if (!label || !cell || cell.v === undefined || cell.v === '') continue
      const key = norm(label)
      const group = overrides[key] ?? classify(label)
      const row: ParsedRow = { label, amountPaise: 0, group, category: label }
      if (typeof cell.v !== 'number' || !Number.isFinite(cell.v)) {
        row.group = 'skip'
        row.issue = `Amount "${String(cell.v)}" is not a number; row not imported.`
      } else {
        row.amountPaise = p(cell.v)
        if (cell.f) row.formula = String(cell.f).replace(/^=/, '')
        if (seen.has(key)) row.issue = 'This label appears more than once in the sheet.'
        if (row.amountPaise < 0) {
          row.issue = 'Negative amount.'
          if (row.group !== 'variable' && row.group !== 'expected') row.group = 'skip'
        }
        if (row.amountPaise === 0) row.group = 'skip'
      }
      seen.add(key)
      rows.push(row)
    }

    // Reconcile against the sheet's own balance (C2): the sum of ALL rows, exactly like the original formula intends.
    const rowsSum = sum(rows.map((x) => x.amountPaise))
    const computed = totalPaise - rowsSum
    const bal = cellNum(ws, `C${totalRow}`)
    const sheetBalance = bal === null ? null : p(bal)
    if (sheetBalance !== null && sheetBalance !== computed)
      issues.push(`The sheet's Balance is ${formatMoney(sheetBalance, { decimals: true })} but its rows add up to a balance of ${formatMoney(computed, { decimals: true })} (difference ${formatMoney(computed - sheetBalance, { decimals: true })}). The app uses the recomputed value.`)
    if (sheetBalance === null) issues.push('No Balance cell found next to Total Salary.')

    let opening = 0
    let salary = totalPaise
    let extra = 0
    if (terms && terms.length >= 2) {
      opening = terms[0]
      const rest = terms.slice(1)
      salary = Math.max(...rest)
      extra = sum(rest) - salary
    } else if (terms && terms.length === 1) {
      issues.push('Total Salary is a single number, so carry-over and salary cannot be told apart; all of it is treated as salary.')
    } else {
      issues.push('Total Salary is not a simple sum, so carry-over and salary cannot be told apart; all of it is treated as salary.')
    }

    const startMonth = month === 1 ? 12 : month - 1
    const startYear = month === 1 ? year - 1 : year
    sheets.push({
      sheetName: name,
      year,
      month,
      cycleStart: salaryDateIn(startYear, startMonth, salaryDay),
      cycleEnd: salaryDateIn(year, month, salaryDay),
      totalPaise,
      terms,
      openingCarryPaise: opening,
      salaryPaise: salary,
      extraCreditsPaise: extra,
      sheetBalancePaise: sheetBalance,
      computedBalancePaise: computed,
      rows,
      issues,
    })
  }

  sheets.sort((a, b) => a.cycleStart.localeCompare(b.cycleStart))
  // Continuity: each sheet should open with the previous sheet's balance.
  for (let i = 1; i < sheets.length; i++) {
    const prev = sheets[i - 1]
    const cur = sheets[i]
    if (!cur.terms || cur.terms.length < 2 || prev.cycleEnd !== cur.cycleStart) continue
    const prevClose = prev.sheetBalancePaise ?? prev.computedBalancePaise
    // If some term of the formula equals last month's closing balance, that term is the carry-over (not necessarily the first one).
    const j = cur.terms.findIndex((t) => Math.abs(t - prevClose) <= 100)
    if (j > 0) {
      const rest = cur.terms.filter((_, k) => k !== j)
      cur.openingCarryPaise = cur.terms[j]
      cur.salaryPaise = Math.max(...rest)
      cur.extraCreditsPaise = sum(rest) - cur.salaryPaise
    }
    const diff = cur.openingCarryPaise - prevClose
    if (diff !== 0)
      cur.issues.push(
        `Opens with ${formatMoney(cur.openingCarryPaise, { decimals: true })} but ${prev.sheetName} closed at ${formatMoney(prevClose, { decimals: true })} (${diff > 0 ? '+' : ''}${formatMoney(diff, { decimals: true })} unexplained adjustment). Imported as written.`,
      )
  }
  return { sheets, ignored }
}

export interface ImportPlan {
  cycles: Cycle[]
  transactions: Transaction[]
  skippedCycles: { sheetName: string; reason: string }[]
  duplicateTransactions: number
  /** Balance the app will compute for each imported cycle vs. what the sheet said. */
  reconciliation: { sheetName: string; appBalancePaise: Paise; sheetBalancePaise: Paise | null }[]
  categories: string[]
  /** Expected-bill rows found in the imported sheets (the app uses the latest cycle's as the starting estimates). */
  expected: { name: string; amountPaise: Paise; cycleStart: string }[]
}

const stableId = (hash: string) => 'imp-' + hash.replace(/[^a-z0-9]+/gi, '-').toLowerCase()

/** Turn parsed sheets into cycles + transactions, skipping anything already present. */
export function buildImport(sheets: ParsedSheet[], existing: ProfileData, now = new Date()): ImportPlan {
  const out: ImportPlan = { cycles: [], transactions: [], skippedCycles: [], duplicateTransactions: 0, reconciliation: [], categories: [], expected: [] }
  const haveStart = new Set(existing.cycles.map((c) => c.start))
  const haveHash = new Set(existing.transactions.map((t) => t.importHash).filter(Boolean))
  const cats = new Set<string>()

  for (const s of sheets) {
    if (haveStart.has(s.cycleStart)) {
      out.skippedCycles.push({ sheetName: s.sheetName, reason: `A cycle starting ${s.cycleStart} already exists.` })
      continue
    }
    const date = new Date(s.cycleEnd + 'T00:00:00Z')
    date.setUTCDate(date.getUTCDate() - 1)
    const lastDay = date.toISOString().slice(0, 10)
    const allocations: Allocation[] = []
    const txs: Transaction[] = []

    for (const r of s.rows) {
      if (r.group === 'skip' || r.amountPaise === 0) continue
      const hash = `xlsx|${s.sheetName}|${norm(r.label)}|${r.amountPaise}`
      if (haveHash.has(hash)) {
        out.duplicateTransactions++
        continue
      }
      const isAlloc = r.group === 'fixed' || r.group === 'investment' || r.group === 'reserved'
      const allocId = isAlloc ? stableId(`${s.sheetName}-${r.label}`) : undefined
      if (allocId) allocations.push({ id: allocId, name: r.label, kind: r.group as AllocationKind, amountPaise: r.amountPaise })
      const negative = r.amountPaise < 0
      txs.push({
        id: stableId(hash),
        date: lastDay,
        time: '00:00',
        amountPaise: Math.abs(r.amountPaise),
        type: negative ? 'refund' : 'expense',
        category: r.category,
        merchant: r.label,
        method: /cash/i.test(r.label) ? 'cash' : 'other',
        note: `Imported from "${s.sheetName}" (monthly total, no individual dates)${r.formula ? ': ' + r.formula.slice(0, 400) : ''}`,
        allocationId: allocId,
        source: 'import',
        importHash: hash,
        createdAt: now.toISOString(),
      })
      if (!isAlloc) cats.add(r.category)
      if (r.group === 'expected') out.expected.push({ name: r.label, amountPaise: r.amountPaise, cycleStart: s.cycleStart })
    }

    const cycle: Cycle = {
      start: s.cycleStart,
      end: s.cycleEnd,
      takeHomePaise: s.salaryPaise,
      extraCreditsPaise: s.extraCreditsPaise,
      openingCarryPaise: s.openingCarryPaise,
      releasedCarryPaise: 0,
      allocations,
      label: s.sheetName.replace(/ Expenses$/, ''),
      source: 'import',
      sheetBalancePaise: s.sheetBalancePaise ?? undefined,
    }
    out.cycles.push(cycle)
    out.transactions.push(...txs)
    out.reconciliation.push({ sheetName: s.sheetName, appBalancePaise: closingBalance(cycle, txs), sheetBalancePaise: s.sheetBalancePaise })
  }
  out.categories = [...cats]
  return out
}
