import { CURRENCIES, getCurrency } from '../../engine/currency'
import { payOf, validatePay } from '../../engine/pay'
import { useEffect, useState } from 'react'
import { cycleLabel } from '../../engine/dates'
import { formatMoney } from '../../engine/money'
import type { Allocation, Plan } from '../../engine/types'
import { useStore } from '../../state/store'
import { AllocationEditor, ExpectedBillsEditor, MoneyInput } from '../components/AllocationEditor'
import { PayFields } from '../components/PayFields'
import { Alert, Field, Modal, useToast } from '../components/common'

export function Budget() {
  const { plan, savePlan, cycle, budget, updateCycle, today, convertFixed } = useStore()
  const [move, setMove] = useState<{ a: Allocation; to: 'spending' | 'expected' } | null>(null)
  const [pastToo, setPastToo] = useState(true)
  const toast = useToast()
  const [draft, setDraft] = useState<Plan>(plan)
  const [catText, setCatText] = useState('')
  useEffect(() => setDraft(plan), [plan])

  const dirty = JSON.stringify(draft) !== JSON.stringify(plan)
  const total = draft.allocations.reduce((s, a) => s + a.amountPaise, 0)
  const spendable = draft.takeHomePaise + Math.min(draft.releasedCarryPaise, cycle?.openingCarryPaise ?? 0) + (cycle?.extraCreditsPaise ?? 0) - total
  const bad = draft.allocations.some((a) => !a.name.trim()) || !!validatePay(payOf(draft))

  return (
    <div className="stack">
      <div className="page-head"><h1>Budget &amp; Allocations</h1></div>
      <Alert kind="info">
        Changes apply to the <b>current cycle and future cycles</b>. Past cycles keep the numbers they were created with, so history never changes.
        {cycle && <> Current cycle: {cycleLabel(cycle.start, cycle.end)}.</>}
      </Alert>

      <section className="card stack">
        <h2>Pay &amp; currency</h2>
        <Field label="Currency" hint="Changing the currency only changes how amounts are written. Existing numbers are not converted.">
          <select className="input" value={draft.currency ?? 'INR'} onChange={(e) => setDraft({ ...draft, currency: e.target.value })}>
            {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name} ({c.symbol.trim()})</option>)}
          </select>
        </Field>
        <PayFields pay={payOf(draft)} today={today} onChange={(pay) => setDraft({ ...draft, pay: pay.kind === 'monthly' ? undefined : pay, salaryDay: pay.kind === 'monthly' ? pay.day : draft.salaryDay })} />
        <p className="hint">A new pay frequency starts with your next cycle; the current one keeps its dates.</p>
        <Field label={payOf(draft).kind === 'monthly' ? `Monthly take-home salary (${getCurrency().symbol})` : `Take-home pay each pay period (${getCurrency().symbol})`}>
          <MoneyInput label="Take-home pay" value={draft.takeHomePaise} onChange={(p) => p !== null && setDraft({ ...draft, takeHomePaise: p })} />
        </Field>
        {cycle && (
          <div className="form-grid two">
            <Field label={`Other credits this cycle (${getCurrency().symbol})`} hint="Interest, refunds to your account, payouts from others.">
              <MoneyInput label="Other credits" value={cycle.extraCreditsPaise} onChange={(p) => p !== null && updateCycle({ ...cycle, extraCreditsPaise: p })} />
            </Field>
            <Field label={`Release from carry-over (${getCurrency().symbol}) – reserve is ${formatMoney(cycle.openingCarryPaise)}`} hint="Only this amount is added to your spendable budget. The rest stays untouched.">
              <MoneyInput label="Release from carry-over" value={draft.releasedCarryPaise} onChange={(p) => p !== null && setDraft({ ...draft, releasedCarryPaise: p })} />
            </Field>
          </div>
        )}
      </section>

      <section className="card stack">
        <div><h2>Set aside every cycle</h2><p className="hint">Rent, EMIs, subscriptions, SIPs, savings, emergency fund, goals. These come out of your income first and are never offered as daily spending.{payOf(draft).kind !== 'monthly' ? ' Give a monthly bill a due day and it is set aside only in the pay period that contains that day.' : ''}</p></div>
        <AllocationEditor items={draft.allocations} onChange={(allocations) => setDraft({ ...draft, allocations })} showDue={payOf(draft).kind !== 'monthly'}
          onConvert={dirty ? undefined : (a, to) => setMove({ a, to })} />
        {dirty && <p className="hint">Save your changes to see the “Amount varies” and “Make spending” options for each item.</p>}
      </section>

      <section className="card stack">
        <div><h2>Expected bills (amount varies)</h2><p className="hint">Electricity, mobile recharge… bills that come every cycle but cost something different each time. The usual amount is <b>reserved</b> from your daily limit until you mark the bill paid and enter the real amount; the difference then goes into your spending.</p></div>
        <ExpectedBillsEditor items={draft.expectedBills ?? []} onChange={(expectedBills) => setDraft({ ...draft, expectedBills })} />
      </section>

      <section className="card">
        <h2>What this means</h2>
        <table className="explain"><tbody>
          <tr><td className="sign">+</td><td>Take-home salary &amp; credits</td><td className="num">{formatMoney(draft.takeHomePaise + (cycle?.extraCreditsPaise ?? 0))}</td></tr>
          <tr><td className="sign">+</td><td>Released from carry-over</td><td className="num">{formatMoney(Math.min(draft.releasedCarryPaise, cycle?.openingCarryPaise ?? draft.releasedCarryPaise))}</td></tr>
          <tr><td className="sign">−</td><td>Set aside</td><td className="num">{formatMoney(total)}</td></tr>
          <tr className="eq"><td className="sign">=</td><td>Spendable budget</td><td className="num">{formatMoney(spendable)}</td></tr>
        </tbody></table>
        {spendable <= 0 && <div style={{ marginTop: 10 }}><Alert kind="bad">Set-asides are at least as large as your income. There is nothing left to spend.</Alert></div>}
        {budget && !dirty && <p className="hint" style={{ marginTop: 8 }}>Today’s limit: {formatMoney(budget.todayLimitPaise)} · {budget.daysLeft} days left.</p>}
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

      {move && (
        <Modal title={move.to === 'expected' ? `“${move.a.name}” varies every month` : `Treat “${move.a.name}” as spending`} onClose={() => setMove(null)}>
          <div className="stack">
            <p className="ink2">
              {move.to === 'expected'
                ? `It will no longer be set aside as a fixed amount. Each cycle ${formatMoney(move.a.amountPaise)} is reserved as an estimate, and when you pay the bill you enter the real amount.`
                : 'It will no longer be set aside. Payments simply count as spending when you record them.'}
            </p>
            <label className="row"><input type="checkbox" checked={pastToo} onChange={(e) => setPastToo(e.target.checked)} /> Also change past cycles (their balances stay exactly the same; the bill just counts as spending there)</label>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setMove(null)}>Cancel</button>
              <button className="btn primary" onClick={async () => { const m = move; setMove(null); const n = await convertFixed(m.a.name, m.to, pastToo); toast(`Updated ${n} cycle${n === 1 ? '' : 's'}`) }}>Apply</button>
            </div>
          </div>
        </Modal>
      )}

      <div className="row" style={{ position: 'sticky', bottom: 80, justifyContent: 'flex-end' }}>
        <button className="btn" disabled={!dirty} onClick={() => setDraft(plan)}>Discard</button>
        <button className="btn primary" disabled={!dirty || bad} onClick={async () => { await savePlan({ ...draft, allocations: draft.allocations.map((a) => ({ ...a, name: a.name.trim() })) }); toast('Budget saved') }}>Save changes</button>
      </div>
    </div>
  )
}
