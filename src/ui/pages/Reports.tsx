import { useMemo, useState } from 'react'
import { exportWorkbook } from '../../db/backup'
import { closingBalance, cycleTransactions, outflowByCategory, variableNet } from '../../engine/budget'
import { cycleLabel } from '../../engine/dates'
import { formatMoney } from '../../engine/money'
import { sum } from '../../engine/money'
import { useStore } from '../../state/store'
import { download, Icon } from '../components/common'
import { EmptyState, SectionHead } from '../components/Section'
import { KpiTile } from '../components/Tiles'
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
      <div className="page-head reveal">
        <div>
          <h1>Reports</h1>
          <span className="muted small">{c.label ?? 'Pay cycle'} · {cycleLabel(c.start, c.end)}</span>
        </div>
        <div className="row">
          <label className="sr" htmlFor="rc">Cycle</label>
          <select id="rc" className="input" style={{ width: 'auto', maxWidth: '100%' }} value={c.start} onChange={(e) => setSel(e.target.value)}>
            {cycles.map((x) => <option key={x.start} value={x.start}>{x.label ? x.label + ' · ' : ''}{cycleLabel(x.start, x.end)}</option>)}
          </select>
          <button className="btn sm" onClick={async () => download('daily-spend-report.xlsx', await exportWorkbook(data), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}><Icon name="download" size={16} /> Excel</button>
        </div>
      </div>

      <div className="grid stats">
        <KpiTile index={0} label="Money in" value={row.credits} format={(n) => formatMoney(Math.round(n))} icon="down" color="var(--s6)" sub="salary & credits" />
        <KpiTile index={1} label="Set aside" value={row.allocated} format={(n) => formatMoney(Math.round(n))} icon="home" color="var(--s7)" sub="bills, investments, savings" />
        <KpiTile index={2} label="Spent" value={row.spent} format={(n) => formatMoney(Math.round(n))} icon="bag" color="var(--s2)" sub={`of ${formatMoney(row.spendable)} spendable`} />
        <KpiTile index={3} label="Closing balance" value={row.closing} format={(n) => formatMoney(Math.round(n))} icon="cash" color="var(--s3)" sub={`opened with ${formatMoney(c.openingCarryPaise)}`} />
      </div>

      <div className="grid cols-2">
        <section className="card reveal" style={{ '--i': 5 } as React.CSSProperties}>
          <SectionHead icon="bag" color="var(--s2)" title="All outflow by category" hint="Includes rent, EMIs and investments paid in this cycle." />
          {outflow.length === 0 ? <EmptyState title="No outflow yet" text="Payments recorded in this cycle appear here." /> : <CategoryBars rows={outflow} max={12} />}
        </section>
        <section className="card reveal" style={{ '--i': 6 } as React.CSSProperties}>
          <SectionHead icon="chart" color="var(--s1)" title="Budget vs actual" hint="Spendable budget and what was spent, cycle by cycle." />
          <Legend items={[['var(--s3)', 'Spendable budget'], ['var(--accent)', 'Spent']]} />
          <MonthlyChart rows={recent.map((r) => ({ label: r.label, spendable: Math.max(0, r.spendable), spent: Math.max(0, r.spent) }))} />
        </section>
      </div>

      <section className="card reveal" style={{ '--i': 7 } as React.CSSProperties}>
        <SectionHead icon="calendar" color="var(--s7)" title="Cycle by cycle" hint="Closing balance = opening + money in − set aside − spending. Transfers are ignored; refunds reduce spending." />
        <table className="t cards">
          <thead><tr><th>Cycle</th><th className="r">Opening</th><th className="r">In</th><th className="r">Set aside</th><th className="r">Spent</th><th className="r">Closing</th></tr></thead>
          <tbody>
            {[...rows].reverse().map((r) => (
              <tr key={r.cy.start}>
                <td data-label="Cycle">{r.cy.label ?? cycleLabel(r.cy.start, r.cy.end)}</td>
                <td className="r num" data-label="Opening">{formatMoney(r.cy.openingCarryPaise)}</td>
                <td className="r num" data-label="Money in">{formatMoney(r.credits)}</td>
                <td className="r num" data-label="Set aside">{formatMoney(r.allocated)}</td>
                <td className="r num" data-label="Spent">{formatMoney(r.spent)}</td>
                <td className="r num" data-label="Closing"><b>{formatMoney(r.closing)}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
