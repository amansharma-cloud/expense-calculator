import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import { buildImport, classify, parseWorkbook } from '../src/import/excel'
import { emptyData } from '../src/db/storage'
import { transactionsToCSV, makeBackup, parseBackup } from '../src/db/backup'

/**
 * Synthetic workbook with the SAME STRUCTURE as the real tracker (never the real figures):
 * Month 1 is clean; Month 2 opens with an unexplained +₹5,000 and its Balance formula double-counts a row.
 */
type Row = [string, number, string?]
function sheet(wb: XLSX.WorkBook, name: string, total: [number, string], balance: number, rows: Row[]) {
  const aoa: (string | number | null)[][] = [['Item', 'Amount', 'Balance'], ['Total Salary', total[0], balance]]
  for (const r of rows) aoa.push([r[0], r[1], null])
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['B2'] = { t: 'n', v: total[0], f: total[1] }
  rows.forEach((r, i) => { if (r[2]) ws[`B${i + 3}`] = { t: 'n', v: r[1], f: r[2] } })
  XLSX.utils.book_append_sheet(wb, ws, name)
}

function makeBook(): ArrayBuffer {
  const wb = XLSX.utils.book_new()
  const rows1: Row[] = [
    ['Savings', 0], ['Rent', 20000], ['Mom', 10000], ['Jupiter Savings', 5000], ['Mutual Fund 1', 2000],
    ['Digital Gold', 1500], ['Food/Grocery', 600, '100+200+300'], ['Electricity Bill', 1830], ['Cash', 3000], ['Weird New Thing', 250.5],
  ]
  // total 500000 + 100000 salary + 250 credit = 600250 ; rows = 42350.5 ; balance = 557899.5
  sheet(wb, 'September 2026 Expenses', [600250, '500000+100000+250'], 556069.5, rows1)
  const rows2: Row[] = [['Rent', 20000], ['Mom', 10000], ['Food/Grocery', 900, '400+500'], ['Recharge Airtel/Jio', 1100]]
  // opens 557899.5 + 5000 (unexplained) + 100000 salary ; rows = 32000
  // true balance 630899.5 - 32000 = 630899.5-32000 ; sheet double counts Recharge (1100): shows 598999.5? -> 662899.5-32000-1100
  sheet(wb, 'October 2026 Expenses', [661069.5, '561069.5+100000'], 627969.5, rows2)
  wb.SheetNames.push('Expense List')
  wb.Sheets['Expense List'] = XLSX.utils.aoa_to_sheet([['ignored']])
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return out
}

describe('Excel importer', () => {
  const parsed = parseWorkbook(makeBook(), 25)

  it('finds monthly sheets and ignores the others', () => {
    expect(parsed.sheets.map((s) => s.sheetName)).toEqual(['September 2026 Expenses', 'October 2026 Expenses'])
    expect(parsed.ignored).toContain('Expense List')
  })

  it('maps a sheet created on the 1st to the cycle that started on the previous 25th', () => {
    const [sep, oct] = parsed.sheets
    expect([sep.cycleStart, sep.cycleEnd]).toEqual(['2026-08-25', '2026-09-25'])
    expect([oct.cycleStart, oct.cycleEnd]).toEqual(['2026-09-25', '2026-10-25'])
  })

  it('splits Total Salary into carry-over, salary and other credits', () => {
    const sep = parsed.sheets[0]
    expect(sep.openingCarryPaise).toBe(50000000)
    expect(sep.salaryPaise).toBe(10000000)
    expect(sep.extraCreditsPaise).toBe(25000)
  })

  it('reproduces a clean sheet balance exactly', () => {
    const sep = parsed.sheets[0]
    expect(sep.computedBalancePaise).toBe(sep.sheetBalancePaise)
    expect(sep.issues).toEqual([])
  })

  it('flags a balance formula error and an unexplained opening adjustment, never hiding them', () => {
    const oct = parsed.sheets[1]
    expect(oct.computedBalancePaise - (oct.sheetBalancePaise ?? 0)).toBe(110000) // the ₹1,100 double-count
    expect(oct.issues.some((i) => /unexplained adjustment/.test(i))).toBe(true)
    expect(oct.issues.some((i) => /rows add up/.test(i))).toBe(true)
  })

  it('classifies labels from the real tracker', () => {
    expect(classify('Rent')).toBe('fixed')
    expect(classify('Mom')).toBe('fixed')
    expect(classify('Car EMI')).toBe('fixed')
    expect(classify('Electricity Bill')).toBe('expected')
    expect(classify('Recharge Airtel/Jio')).toBe('expected')
    expect(classify('Airtel Wifi')).toBe('fixed')
    expect(classify('Jupiter LIC Account')).toBe('investment')
    expect(classify('Mutual Fund 3')).toBe('investment')
    expect(classify('Digital Gold')).toBe('investment')
    expect(classify('HDFC RD')).toBe('investment')
    expect(classify('Savings')).toBe('reserved')
    expect(classify('Credit Card IDFC/Jupiter')).toBe('variable')
    expect(classify('Food/Grocery')).toBe('variable')
    expect(classify('Cash')).toBe('variable')
    expect(classify('Something unseen')).toBe('variable')
  })

  it('builds cycles whose app-computed balance matches the sheet', () => {
    const plan = buildImport(parsed.sheets, emptyData())
    expect(plan.cycles).toHaveLength(2)
    const sep = plan.reconciliation[0]
    expect(sep.appBalancePaise).toBe(sep.sheetBalancePaise)
    // every non-zero row is kept: nothing silently dropped (Savings = 0 is skipped as empty)
    const labels = plan.transactions.map((t) => t.merchant)
    expect(labels).toContain('Weird New Thing')
    expect(labels).toContain('Cash')
    expect(plan.categories).toContain('Weird New Thing')
  })

  it('imports varying bills as spending and reports them as expected bills', () => {
    const plan = buildImport(parsed.sheets, emptyData())
    const sep = plan.cycles[0]
    expect(sep.allocations.some((a) => /electricity/i.test(a.name))).toBe(false)
    const tx = plan.transactions.find((t) => t.merchant === 'Electricity Bill')!
    expect(tx.allocationId).toBeUndefined()
    expect(plan.expected.map((e) => e.name)).toContain('Electricity Bill')
    const rec = plan.reconciliation[0]
    expect(rec.appBalancePaise).toBe(rec.sheetBalancePaise) // balances still match the sheet
  })

  it('does not count payments to fixed/investment allocations as spending', () => {
    const plan = buildImport(parsed.sheets, emptyData())
    const rent = plan.transactions.find((t) => t.merchant === 'Rent')!
    expect(rent.allocationId).toBeTruthy()
    expect(plan.cycles[0].allocations.find((a) => a.name === 'Rent')?.kind).toBe('fixed')
  })

  it('is idempotent: importing the same file twice adds nothing', () => {
    const first = buildImport(parsed.sheets, emptyData())
    const data = { ...emptyData(), cycles: first.cycles, transactions: first.transactions }
    const second = buildImport(parsed.sheets, data)
    expect(second.cycles).toHaveLength(0)
    expect(second.skippedCycles).toHaveLength(2)
  })

  it('rejects a workbook without monthly sheets without crashing', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['x']]), 'Sheet1')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    expect(parseWorkbook(buf, 25).sheets).toEqual([])
  })
})

describe('backup & export', () => {
  const data = emptyData()
  data.transactions.push({
    id: 'a', date: '2026-10-01', time: '10:00', amountPaise: 12345, type: 'expense', category: 'Food', merchant: '=HYPERLINK("x")',
    method: 'upi', note: 'a, "b"', source: 'manual', createdAt: '',
  })
  it('round-trips', () => {
    const back = parseBackup(makeBackup('Me', data))
    expect(back.data.transactions[0].amountPaise).toBe(12345)
    expect(back.profileName).toBe('Me')
  })
  it('rejects malformed or foreign files', () => {
    expect(() => parseBackup('nope')).toThrow(/valid JSON/)
    expect(() => parseBackup('{"app":"other"}')).toThrow(/not a Daily Spend/)
    const bad = JSON.parse(makeBackup('Me', data))
    bad.data.transactions[0].amountPaise = 12.5
    expect(() => parseBackup(JSON.stringify(bad))).toThrow(/invalid amount/)
    bad.data.transactions[0].amountPaise = 100
    bad.data.transactions[0].date = '2026-02-30'
    expect(() => parseBackup(JSON.stringify(bad))).toThrow(/invalid date/)
  })
  it('CSV quotes fields and neutralises formulas', () => {
    const csv = transactionsToCSV(data.transactions)
    expect(csv).toContain('123.45')
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`) // leading quote stops it running as a formula
    expect(csv).toContain('"a, ""b"""')
  })
})
