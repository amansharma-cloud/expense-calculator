import { useMemo, useState } from 'react'
import { exportWorkbook } from '../../db/backup'
import { closingBalance, cycleTransactions, outflowByCategory, variableNet } from '../../engine/budget'
import { cycleLabel } from '../../engine/dates'
import { formatMoney } from '../../engine/money'
import { sum } from '../../engine/money'
import { useStore } from '../../state/store'
import { download, Icon } from '../components/common'
import { CategoryBars, Legend, MonthlyChart } from '../components/charts'

export function Reports() {
  const { data, cycle } = useStore()
  const cycles = useMemo(() => [...data.cycles].sort((a, b) => b.start.localeCompare(a.start)), [data.cycles])
  const [sel, setSel] = useState(cycle?.start ?? cycles[0]?.start ?? '')
  const c = cycles.find((x) => x.start === sel) ?? cycles[0]

  const rows = useMemo(() => [...cycles].reverse().map((cy) => {
    const t = cycleTransactions(cy, data.transactions)
    const allocated = sum(cy.allocations.map((a) => a.amountPaise))
    const income = sum(t.filter((x) => x.type === 'income').map((x) => x.amountPaise))
    const credits = cy.takeHomePaise + cy.extraCreditsPaise + income
    return {
      cy, label: cy.label?.replace(/ 20(\d\d)$/, " '$1") ?? cycleLabel(cy.start, cy.end).split(' – ')[0],
      credits, allocated, spent: variableNet(t), spendable: credits + cy.releasedCarryPaise - allocated,
      closing: closingBalance(cy, data.transactions),
    }
  }), [cycles, data.transactions])

  if (!c) return <div className="stack"><h1>Reports</h1><div className="card"><p className="muted">Reports appear once you have a salary cycle.</p></div></div>
  const t = cycleTransactions(c, data.transactions)
  const row = rows.find((r) => r.cy.start === c.start)!
  const outflow = outflowByCategory(t)
  const recent = rows.slice(-12)

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Reports</h1>
        <div className="row">
          <label className="sr" htmlFor="rc">Cycle</label>
          <select id="rc" className="input" style={{ width: 'auto' }} value={c.start} onChange={(e) => setSel(e.target.value)}>
            {cycles.map((x) => <option key={x.start} value={x.start}>{x.label ? x.label + ' · ' : ''}{cycleLabel(x.start, x.end)}</option>)}
          </select>
          <button className="btn sm" onClick={() => download('daily-spend-report.xlsx', exportWorkbook(data), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}><Icon name="download" size={16} /> Excel</button>
        </div>
      </div>

      <div className="grid stats">
        <div className="card stat"><div className="label">Money in</div><div className="value num">{formatMoney(row.credits)}</div><div className="sub">salary &amp; credits</div></div>
        <div className="card stat"><div className="label">Set aside</div><div className="value num">{formatMoney(row.allocated)}</div><div className="sub">bills, investments, savings</div></div>
        <div className="card stat"><div className="label">Spent</div><div className="value num">{formatMoney(row.spent)}</div><div className="sub">of {formatMoney(row.spendable)} spendable</div></div>
        <div className="card stat"><div className="label">Closing balance</div><div className="value num">{formatMoney(row.closing)}</div><div className="sub">opened with {formatMoney(c.openingCarryPaise)}</div></div>
      </div>

      <div className="grid cols-2">
        <section className="card">
          <h2>All outflow by category</h2>
          <p className="hint">Includes rent, EMIs and investments paid in this cycle.</p>
          <CategoryBars rows={outflow} max={12} />
        </section>
        <section className="card">
          <h2>Budget vs actual</h2>
          <Legend items={[['var(--s3)', 'Spendable budget'], ['var(--s1)', 'Spent']]} />
          <MonthlyChart rows={recent.map((r) => ({ label: r.label, spendable: Math.max(0, r.spendable), spent: Math.max(0, r.spent) }))} />
        </section>
      </div>

      <section className="card">
        <h2>Cycle by cycle</h2>
        <div className="scroll-x">
          <table className="t">
            <thead><tr><th>Cycle</th><th className="r">Opening</th><th className="r">In</th><th className="r">Set aside</th><th className="r">Spent</th><th className="r">Closing</th></tr></thead>
            <tbody>
              {[...rows].reverse().map((r) => (
                <tr key={r.cy.start}>
                  <td>{r.cy.label ?? cycleLabel(r.cy.start, r.cy.end)}</td>
                  <td className="r num">{formatMoney(r.cy.openingCarryPaise)}</td><td className="r num">{formatMoney(r.credits)}</td>
                  <td className="r num">{formatMoney(r.allocated)}</td><td className="r num">{formatMoney(r.spent)}</td><td className="r num"><b>{formatMoney(r.closing)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint" style={{ marginTop: 8 }}>Closing balance = opening + money in − set aside − spending. Transfers are ignored; refunds reduce spending.</p>
      </section>
    </div>
  )
}
