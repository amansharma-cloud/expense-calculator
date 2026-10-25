import { useMemo, useRef, useState } from 'react'
import { formatMoney } from '../../engine/money'
import { buildImport, parseWorkbook, type Overrides, type ParseResult, type RowGroup } from '../../import/excel'
import { useStore } from '../../state/store'
import { Alert, Confirm, useToast } from './common'

const GROUPS: [RowGroup, string][] = [
  ['fixed', 'Fixed bill / EMI'], ['investment', 'Investment'], ['reserved', 'Reserved / savings'], ['variable', 'Spending'], ['skip', 'Skip'],
]

/** Excel → app migration. Parses in the browser, shows a preview with every problem, writes only after confirmation. */
export function ImportWizard({ onDone }: { onDone?: () => void }) {
  const { plan, data, applyImport } = useStore()
  const toast = useToast()
  const [buf, setBuf] = useState<ArrayBuffer | null>(null)
  const [fileName, setFileName] = useState('')
  const [overrides, setOverrides] = useState<Overrides>({})
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [makePlan, setMakePlan] = useState(!data.plan || data.plan.allocations.length === 0)
  const [picked, setPicked] = useState<Set<string> | null>(null)
  const input = useRef<HTMLInputElement>(null)

  let parsed: ParseResult | null = null
  let parseError = ''
  if (buf) {
    try {
      parsed = parseWorkbook(buf, plan.salaryDay, overrides)
    } catch (e) {
      parseError = e instanceof Error ? e.message : 'Could not read this file.'
    }
  }
  const sheets = useMemo(() => (parsed ? parsed.sheets.filter((s) => !picked || picked.has(s.sheetName)) : []), [parsed, picked])
  const result = useMemo(() => (sheets.length ? buildImport(sheets, data) : null), [sheets, data])

  const onFile = async (f: File | undefined) => {
    setError('')
    if (!f) return
    if (!/\.xlsx?$/i.test(f.name)) return setError('Please choose an .xlsx or .xls file.')
    if (f.size > 25 * 1024 * 1024) return setError('That file is larger than 25 MB.')
    try {
      setBuf(await f.arrayBuffer())
      setFileName(f.name)
      setOverrides({})
      setPicked(null)
    } catch {
      setError('Could not read that file.')
    }
  }

  const allLabels = useMemo(() => {
    const m = new Map<string, { label: string; group: RowGroup; count: number }>()
    for (const s of sheets) for (const r of s.rows) {
      const k = r.label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
      const e = m.get(k)
      if (e) e.count++
      else m.set(k, { label: r.label, group: r.group, count: 1 })
    }
    return [...m.entries()]
  }, [sheets])

  return (
    <div className="stack">
      <p className="ink2">
        Choose your old tracker (<b>.xlsx</b>). It is read inside this browser tab and is never uploaded. Sheets named “<i>Month Year Expenses</i>” are imported; other sheets are ignored.
        Nothing is saved until you confirm.
      </p>
      <input ref={input} type="file" accept=".xlsx,.xls" hidden onChange={(e) => onFile(e.target.files?.[0])} />
      <div className="row">
        <button className="btn primary" onClick={() => input.current?.click()}>{buf ? 'Choose a different file' : 'Choose Excel file'}</button>
        {fileName && <span className="muted">{fileName}</span>}
      </div>
      {(error || parseError) && <Alert kind="bad">{error || parseError}</Alert>}

      {parsed && (
        <>
          {parsed.ignored.length > 0 && <p className="hint">Ignored sheets: {parsed.ignored.join(', ')}</p>}
          {parsed.sheets.length === 0 && <Alert kind="bad">No sheets named like “October 2026 Expenses” were found.</Alert>}

          {parsed.sheets.length > 0 && (
            <>
              <div>
                <h3>1. Months found</h3>
                <p className="hint">Each sheet becomes one salary cycle. A sheet is mapped to the cycle that started on your salary day of the previous month (salary day {plan.salaryDay}; change it in Budget &amp; Allocations first if needed).</p>
                <div className="scroll-x">
                  <table className="t">
                    <thead><tr><th></th><th>Sheet</th><th>Cycle</th><th className="r">Sheet balance</th><th className="r">App balance</th></tr></thead>
                    <tbody>
                      {parsed.sheets.map((s) => {
                        const rec = result?.reconciliation.find((r) => r.sheetName === s.sheetName)
                        const skip = result?.skippedCycles.find((r) => r.sheetName === s.sheetName)
                        const diff = rec && rec.sheetBalancePaise !== null && rec.sheetBalancePaise !== rec.appBalancePaise
                        return (
                          <tr key={s.sheetName}>
                            <td><input type="checkbox" aria-label={`Import ${s.sheetName}`} checked={!picked || picked.has(s.sheetName)} disabled={!!skip}
                              onChange={(e) => { const next = new Set(picked ?? parsed!.sheets.map((x) => x.sheetName)); e.target.checked ? next.add(s.sheetName) : next.delete(s.sheetName); setPicked(next) }} /></td>
                            <td>{s.sheetName}{skip && <div className="hint">{skip.reason} Skipped.</div>}</td>
                            <td className="num">{s.cycleStart} → {s.cycleEnd}</td>
                            <td className="r num">{s.sheetBalancePaise !== null ? formatMoney(s.sheetBalancePaise, { decimals: true }) : '–'}</td>
                            <td className="r num" style={diff ? { color: 'var(--bad)', fontWeight: 700 } : undefined}>{rec ? formatMoney(rec.appBalancePaise, { decimals: true }) : '–'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {parsed.sheets.some((s) => s.issues.length > 0) && (
                <div className="stack">
                  <h3>2. Things to check</h3>
                  {parsed.sheets.filter((s) => s.issues.length > 0).map((s) => (
                    <Alert key={s.sheetName} kind="warn">
                      <b>{s.sheetName}</b>
                      <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{s.issues.map((i, k) => <li key={k}>{i}</li>)}</ul>
                    </Alert>
                  ))}
                  <p className="hint">Nothing is corrected silently: balances are recomputed from the rows, and the original sheet value is shown above for comparison.</p>
                </div>
              )}

              <details>
                <summary>3. How each item is treated ({allLabels.length} labels)</summary>
                <p className="hint">Fixed bills, investments and savings are set aside from income. Everything else is spending. Change a label here if the guess is wrong.</p>
                <div className="scroll-x">
                  <table className="t">
                    <thead><tr><th>Item in your sheet</th><th>Months</th><th>Treat as</th></tr></thead>
                    <tbody>
                      {allLabels.map(([k, v]) => (
                        <tr key={k}>
                          <td>{v.label}</td><td>{v.count}</td>
                          <td>
                            <select className="input" aria-label={`Treatment of ${v.label}`} value={overrides[k] ?? v.group} onChange={(e) => setOverrides({ ...overrides, [k]: e.target.value as RowGroup })}>
                              {GROUPS.map(([g, l]) => <option key={g} value={g}>{l}</option>)}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>

              {result && (
                <div className="card" style={{ background: 'var(--surface-2)' }}>
                  <h3>Ready to import</h3>
                  <p className="ink2">
                    {result.cycles.length} salary cycle{result.cycles.length === 1 ? '' : 's'} and {result.transactions.length} records
                    {result.duplicateTransactions > 0 && ` (${result.duplicateTransactions} duplicates skipped)`}.
                    Item totals are imported as one record per item per month, because the sheet has no individual dates.
                  </p>
                  <label className="row" style={{ margin: '8px 0' }}>
                    <input type="checkbox" checked={makePlan} onChange={(e) => setMakePlan(e.target.checked)} />
                    <span>Use the latest month’s fixed bills &amp; investments as my starting plan{data.plan && data.plan.allocations.length ? ' (replaces my current plan)' : ''}</span>
                  </label>
                  <button className="btn primary" disabled={result.cycles.length === 0} onClick={() => setConfirm(true)}>Import {result.cycles.length} cycle{result.cycles.length === 1 ? '' : 's'}</button>
                </div>
              )}
            </>
          )}
        </>
      )}
      {confirm && result && (
        <Confirm
          title="Import into this profile?" confirmLabel="Import"
          body={<>This adds {result.cycles.length} cycles and {result.transactions.length} records to the current profile. Existing records are not changed.</>}
          onCancel={() => setConfirm(false)}
          onConfirm={async () => {
            setConfirm(false)
            await applyImport(result, makePlan)
            toast('Import complete')
            setBuf(null)
            onDone?.()
          }}
        />
      )}
    </div>
  )
}
