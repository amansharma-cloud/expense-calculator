import { useEffect, useState } from 'react'
import { cycleLabel } from '../../engine/dates'
import { formatINR } from '../../engine/money'
import type { Plan } from '../../engine/types'
import { useStore } from '../../state/store'
import { AllocationEditor, MoneyInput } from '../components/AllocationEditor'
import { Alert, Field, useToast } from '../components/common'

export function Budget() {
  const { plan, savePlan, cycle, budget, updateCycle } = useStore()
  const toast = useToast()
  const [draft, setDraft] = useState<Plan>(plan)
  const [catText, setCatText] = useState('')
  useEffect(() => setDraft(plan), [plan])

  const dirty = JSON.stringify(draft) !== JSON.stringify(plan)
  const total = draft.allocations.reduce((s, a) => s + a.amountPaise, 0)
  const spendable = draft.takeHomePaise + Math.min(draft.releasedCarryPaise, cycle?.openingCarryPaise ?? 0) + (cycle?.extraCreditsPaise ?? 0) - total
  const bad = draft.allocations.some((a) => !a.name.trim()) || draft.salaryDay < 1 || draft.salaryDay > 31

  return (
    <div className="stack">
      <div className="page-head"><h1>Budget &amp; Allocations</h1></div>
      <Alert kind="info">
        Changes apply to the <b>current cycle and future cycles</b>. Past cycles keep the numbers they were created with, so history never changes.
        {cycle && <> Current cycle: {cycleLabel(cycle.start, cycle.end)}.</>}
      </Alert>

      <section className="card stack">
        <h2>Salary</h2>
        <div className="form-grid two">
          <Field label="Monthly take-home salary (₹)"><MoneyInput label="Monthly take-home salary" value={draft.takeHomePaise} onChange={(p) => p !== null && setDraft({ ...draft, takeHomePaise: p })} /></Field>
          <Field label="Salary credit day" hint="Cycles run from this day to the day before the next one. 31 means “last day” in shorter months.">
            <input className="input num" type="number" min={1} max={31} value={draft.salaryDay} onChange={(e) => setDraft({ ...draft, salaryDay: Number(e.target.value) })} />
          </Field>
        </div>
        {cycle && (
          <div className="form-grid two">
            <Field label="Other credits this cycle (₹)" hint="Interest, refunds to your account, payouts from others.">
              <MoneyInput label="Other credits" value={cycle.extraCreditsPaise} onChange={(p) => p !== null && updateCycle({ ...cycle, extraCreditsPaise: p })} />
            </Field>
            <Field label={`Release from carry-over (₹) – reserve is ${formatINR(cycle.openingCarryPaise)}`} hint="Only this amount is added to your spendable budget. The rest stays untouched.">
              <MoneyInput label="Release from carry-over" value={draft.releasedCarryPaise} onChange={(p) => p !== null && setDraft({ ...draft, releasedCarryPaise: p })} />
            </Field>
          </div>
        )}
      </section>

      <section className="card stack">
        <div><h2>Set aside every cycle</h2><p className="hint">Rent, EMIs, subscriptions, SIPs, savings, emergency fund, goals. These come out of your income first and are never offered as daily spending.</p></div>
        <AllocationEditor items={draft.allocations} onChange={(allocations) => setDraft({ ...draft, allocations })} />
      </section>

      <section className="card">
        <h2>What this means</h2>
        <table className="explain"><tbody>
          <tr><td className="sign">+</td><td>Take-home salary &amp; credits</td><td className="num">{formatINR(draft.takeHomePaise + (cycle?.extraCreditsPaise ?? 0))}</td></tr>
          <tr><td className="sign">+</td><td>Released from carry-over</td><td className="num">{formatINR(Math.min(draft.releasedCarryPaise, cycle?.openingCarryPaise ?? draft.releasedCarryPaise))}</td></tr>
          <tr><td className="sign">−</td><td>Set aside</td><td className="num">{formatINR(total)}</td></tr>
          <tr className="eq"><td className="sign">=</td><td>Spendable budget</td><td className="num">{formatINR(spendable)}</td></tr>
        </tbody></table>
        {spendable <= 0 && <div style={{ marginTop: 10 }}><Alert kind="bad">Set-asides are at least as large as your income. There is nothing left to spend.</Alert></div>}
        {budget && !dirty && <p className="hint" style={{ marginTop: 8 }}>Today’s limit: {formatINR(budget.todayLimitPaise)} · {budget.daysLeft} days left.</p>}
      </section>

      <section className="card stack">
        <h2>Spending categories</h2>
        <div className="chips">{draft.categories.map((c) => (
          <span className="chip" key={c}>{c}<button className="btn ghost sm" style={{ minHeight: 0, padding: '0 4px' }} aria-label={`Remove category ${c}`} onClick={() => setDraft({ ...draft, categories: draft.categories.filter((x) => x !== c) })}>✕</button></span>
        ))}</div>
        <form className="row" onSubmit={(e) => { e.preventDefault(); const v = catText.trim(); if (v && !draft.categories.includes(v)) setDraft({ ...draft, categories: [...draft.categories, v] }); setCatText('') }}>
          <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder="Add a category" aria-label="New category" value={catText} onChange={(e) => setCatText(e.target.value)} />
          <button className="btn">Add</button>
        </form>
        <p className="hint">Removing a category here never changes existing transactions.</p>
      </section>

      <div className="row" style={{ position: 'sticky', bottom: 80, justifyContent: 'flex-end' }}>
        <button className="btn" disabled={!dirty} onClick={() => setDraft(plan)}>Discard</button>
        <button className="btn primary" disabled={!dirty || bad} onClick={async () => { await savePlan({ ...draft, allocations: draft.allocations.map((a) => ({ ...a, name: a.name.trim() })) }); toast('Budget saved') }}>Save changes</button>
      </div>
    </div>
  )
}
