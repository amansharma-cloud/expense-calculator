import { getCurrency } from '../../engine/currency'
import { useState } from 'react'
import { cycleTransactions, dailySeries, spendByCategory } from '../../engine/budget'
import { isValidDate, shortDate } from '../../engine/dates'
import { formatMoney, parseAmount, validateAmount } from '../../engine/money'
import type { Allocation, PayMethod, PlannedItem } from '../../engine/types'
import { useStore } from '../../state/store'
import { ordinal } from '../components/DayPicker'

/** Limits are shown in whole rupees, rounded down, so the app never nudges you to overspend. */
const rs = (paise: number) => formatMoney(Math.floor(paise / 100) * 100)
import { MoneyInput } from '../components/AllocationEditor'
import { BackupReminder } from '../components/DataHealth'
import { BalanceCard } from '../components/BalanceCard'
import { Hero } from '../components/Hero'
import { greeting } from '../motion'
import { Alert, Confirm, Field, Icon, Modal, Seg, useToast } from '../components/common'
import { CategoryBars, DailySpendChart, Legend, RemainingChart } from '../components/charts'

export function Dashboard({ onAdd }: { onAdd: () => void }) {
  const { cycle, budget, data, today, payPlanned, deletePlanned, addPlanned, addTx, active } = useStore()
  const toast = useToast()
  const [planning, setPlanning] = useState(false)
  const [delPlan, setDelPlan] = useState<string | null>(null)
  const [paying, setPaying] = useState<PlannedItem | null>(null)
  const [payingAlloc, setPayingAlloc] = useState<Allocation | null>(null)
  if (!cycle || !budget) return null
  const b = budget
  const txs = cycleTransactions(cycle, data.transactions)
  const series = dailySeries(cycle, data.transactions, today)
  const cats = spendByCategory(txs)
  const over = b.todayRemainingPaise < 0
  const upcoming = data.planned.filter((p) => !p.done && p.dueDate >= cycle.start && p.dueDate < cycle.end).sort((a, b2) => a.dueDate.localeCompare(b2.dueDate))
  const recent = [...txs].sort((a, b2) => (b2.date + b2.time).localeCompare(a.date + a.time)).slice(0, 5)
  const kinds = [['fixed', 'Fixed bills & EMIs'], ['investment', 'Investments & savings'], ['reserved', 'Reserved']] as const
  const barCls = b.utilizationPct >= 100 ? 'bad' : b.utilizationPct >= 80 ? 'warn' : ''

  return (
    <div className="stack">
      <div className="page-head reveal">
        <div>
          <h1>{greeting()}, {active?.name ?? ''}</h1>
          <span className="muted small">Here is where your money stands today.</span>
        </div>
      </div>

      <BackupReminder />
      {b.warnings.map((w, i) => <Alert key={i} kind={b.status === 'over' || b.status === 'exhausted' ? 'bad' : 'warn'}>{w}</Alert>)}

      <Hero b={b} cycle={cycle} over={over} onAdd={onAdd} />

      <BalanceCard />

      <section className="grid stats" aria-label="Key numbers">
        <div className="card stat"><div className="label">Original daily budget</div><div className="value num">{rs(b.originalDailyPaise)}</div><div className="sub">at cycle start</div></div>
        <div className="card stat"><div className="label">Today’s recommended</div><div className="value num">{rs(b.todayLimitPaise)}</div><div className="sub">{b.todayLimitPaise >= b.originalDailyPaise ? 'at or above original' : 'below original'}</div></div>
        <div className="card stat"><div className="label">Spent today</div><div className="value num">{rs(Math.max(0, b.todaySpentPaise))}</div><div className="sub">{rs(Math.max(0, b.todayRemainingPaise))} left</div></div>
        <div className="card stat"><div className="label">Daily average</div><div className="value num">{rs(b.dailyAveragePaise)}</div><div className="sub">this cycle</div></div>
        <div className="card stat"><div className="label">Available this cycle</div><div className="value num">{formatMoney(b.poolPaise)}</div><div className="sub">{formatMoney(b.protectedPaise)} set aside</div></div>
        <div className="card stat"><div className="label">Spendable budget</div><div className="value num">{formatMoney(b.spendablePaise)}</div><div className="sub">after set-asides</div></div>
        <div className="card stat"><div className="label">Spent this cycle</div><div className="value num">{formatMoney(b.variableSpentPaise)}</div><div className="sub">{b.plannedUnpaidPaise > 0 ? `+ ${formatMoney(b.plannedUnpaidPaise)} planned` : 'regular spending'}</div></div>
        <div className="card stat">
          <div className="label">Budget used</div><div className="value num">{b.utilizationPct}%</div>
          <div className={`bar ${barCls}`} role="progressbar" aria-valuenow={Math.min(100, b.utilizationPct)} aria-valuemin={0} aria-valuemax={100} aria-label="Budget used"><i style={{ width: `${Math.min(100, b.utilizationPct)}%` }} /></div>
        </div>
      </section>

      <div className="grid cols-2">
        <section className="card" aria-label="Daily spending">
          <h2>Daily spending</h2>
          <Legend items={[['var(--s1)', 'Spent'], ['var(--s2)', 'Today’s limit']]} />
          <DailySpendChart series={series} limit={b.todayLimitPaise} />
        </section>
        <section className="card" aria-label="Remaining budget">
          <h2>Remaining budget</h2>
          <Legend items={[['var(--s1)', 'Remaining'], ['var(--muted)', 'Even pace']]} />
          <RemainingChart series={series} />
        </section>
      </div>

      <div className="grid cols-2">
        <section className="card" aria-label="Upcoming bills">
          <div className="row between"><h2>Upcoming &amp; planned</h2><button className="btn sm" onClick={() => setPlanning(true)}><Icon name="plus" size={16} /> Add</button></div>
          <p className="hint">Reserved from your daily limit until paid.</p>
          {upcoming.length === 0 ? <p className="muted">No upcoming bills or planned purchases.</p> : (
            <ul className="list">
              {upcoming.map((p) => (
                <li key={p.id}>
                  <div className="grow"><div className="title">{p.title}</div><div className="small muted">{p.id.startsWith('exp-') ? 'expected · estimate · ' : ''}due {shortDate(p.dueDate)}{p.dueDate < today ? ' · overdue' : ''}</div></div>
                  <span className="amt num">{formatMoney(p.amountPaise)}</span>
                  <button className="btn sm" onClick={() => setPaying(p)}>Paid</button>
                  <button className="btn ghost sm" aria-label={`Remove ${p.title}`} onClick={() => setDelPlan(p.id)}><Icon name="trash" size={16} /></button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card" aria-label="Where the money goes">
          <h2>Where the money goes</h2>
          <p className="hint">Regular spending this cycle, by category.</p>
          <CategoryBars rows={cats} />
        </section>
      </div>

      <section className="card" aria-label="Set aside">
        <h2>Set aside this cycle</h2>
        <p className="hint">Already taken out of your spendable budget. Tap <b>Paid</b> when you pay one: it is ticked off here and not counted as spending.</p>
        {cycle.allocations.filter((a) => a.amountPaise > 0).length === 0 && <p className="muted">Nothing set aside. Add bills and investments under Budget.</p>}
        <div className="grid cols-2" style={{ marginTop: 8 }}>
          {kinds.map(([k, title]) => {
            const items = cycle.allocations.filter((a) => a.kind === k && a.amountPaise > 0)
            if (!items.length) return null
            const planned = items.reduce((s, a) => s + a.amountPaise, 0)
            const paid = items.reduce((s, a) => s + Math.min(a.amountPaise, b.allocationPaid[a.id] ?? 0), 0)
            return (
              <div key={k}>
                <div className="grp-head"><b>{title}</b><span className="num small muted">{formatMoney(paid)} of {formatMoney(planned)}</span></div>
                <div className="bar" style={{ marginTop: 6 }} role="progressbar" aria-valuenow={Math.round((paid / planned) * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`${title} paid`}><i style={{ width: `${(paid / planned) * 100}%`, background: 'var(--s3)' }} /></div>
                <ul className="mini">
                  {items.map((a) => {
                    const done = b.allocationPaid[a.id] ?? 0
                    const full = done >= a.amountPaise
                    return (
                      <li key={a.id}>
                        <div className="grow">
                          <span className="nm">{a.name}</span>
                          <div className="sub num">{full ? formatMoney(done) : `${formatMoney(Math.max(0, done))} of ${formatMoney(a.amountPaise)}`}{a.dueDay ? ` · due ${ordinal(a.dueDay)}` : ''}</div>
                        </div>
                        {full ? <span className="chip good small"><Icon name="check" size={14} /> Paid</span> : <button className="btn sm" aria-label={`Mark ${a.name} paid`} onClick={() => setPayingAlloc(a)}>Paid</button>}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </div>
      </section>

      <div className="grid cols-2">
        <section className="card" aria-label="Recent">
          <div className="row between"><h2>Recent</h2><a href="#/transactions" className="small">See all</a></div>
          {recent.length === 0 ? <p className="muted">Nothing recorded yet this cycle. If you spend today, add it so the limit stays accurate.</p> : (
            <ul className="list">
              {recent.map((t) => (
                <li key={t.id}>
                  <div className="grow"><div className="title">{t.merchant || t.category}</div><div className="small muted">{t.category} · {shortDate(t.date)}</div></div>
                  <span className={`amt num ${t.type === 'refund' || t.type === 'income' ? 'in' : ''}`}>{t.type === 'refund' || t.type === 'income' ? '+' : ''}{formatMoney(t.amountPaise)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
        <details>
          <summary>How is today’s limit calculated?</summary>
          <table className="explain" style={{ marginTop: 8 }}>
            <tbody>
              {b.explain.map((l, i) => (
                <tr key={i} className={l.sign === '=' ? 'eq' : ''}>
                  <td className="sign">{l.sign === '=' ? '=' : l.sign === '-' ? '−' : '+'}</td>
                  <td>{l.label}{l.note && <span className="muted small"> ({l.note})</span>}</td>
                  <td className="num">{formatMoney(l.paise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint" style={{ marginTop: 8 }}>
            Carry-over of {formatMoney(cycle.openingCarryPaise)} is kept as a reserve; only the released part is included. Recorded spending is what you entered — if entries are missing, the limit is too generous.
            At your current pace you would end the cycle with about {formatMoney(b.projectedCarryPaise)} to carry over.
          </p>
        </details>
      </section>
      </div>

      {paying && (
        <PayDialog item={paying} today={today} onClose={() => setPaying(null)} onPay={async (amountPaise, date, method) => {
          await payPlanned(paying, { date, time: new Date().toTimeString().slice(0, 5), amountPaise, type: 'expense', category: paying.category || 'Other', merchant: paying.title, method, note: paying.id.startsWith('exp-') ? 'Expected bill paid' : 'Planned item paid', source: 'manual' })
          setPaying(null)
          toast(`Recorded ${formatMoney(amountPaise)} for ${paying.title}`)
        }} />
      )}
      {payingAlloc && (
        <PayDialog
          item={{ id: payingAlloc.id, title: payingAlloc.name, amountPaise: Math.max(0, payingAlloc.amountPaise - (b.allocationPaid[payingAlloc.id] ?? 0)), dueDate: today, done: false }}
          noun="Set aside" today={today} onClose={() => setPayingAlloc(null)}
          onPay={async (amountPaise, date, method) => {
            const a = payingAlloc
            await addTx({ date, time: new Date().toTimeString().slice(0, 5), amountPaise, type: 'expense', category: a.name, merchant: a.name, method, note: 'Set-aside paid', allocationId: a.id, source: 'manual' })
            setPayingAlloc(null)
            toast(`${a.name}: ${formatMoney(amountPaise)} marked paid (not counted as spending)`)
          }}
        />
      )}
      {planning && <PlannedForm onClose={() => setPlanning(false)} onSave={async (p) => { await addPlanned(p); setPlanning(false) }} defaultDate={today} />}
      {delPlan && <Confirm title="Remove planned item?" body="It will no longer be reserved from your daily limit." confirmLabel="Remove" onCancel={() => setDelPlan(null)} onConfirm={async () => { await deletePlanned(delPlan); setDelPlan(null) }} />}
    </div>
  )
}

function PlannedForm({ onClose, onSave, defaultDate }: { onClose: () => void; onSave: (p: { title: string; amountPaise: number; dueDate: string }) => void; defaultDate: string }) {
  const [title, setTitle] = useState('')
  const [amt, setAmt] = useState(0)
  const [text, setText] = useState('')
  const [due, setDue] = useState(defaultDate)
  const [sub, setSub] = useState(false)
  const err = validateAmount(text || String(amt / 100))
  return (
    <Modal title="Planned bill or purchase" onClose={onClose}>
      <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); setSub(true); if (!title.trim() || err || !isValidDate(due)) return; onSave({ title: title.trim(), amountPaise: parseAmount(text)!, dueDate: due }) }}>
        <Field label="What is it?" error={sub && !title.trim() ? 'Enter a name' : null}><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Insurance premium, new phone…" /></Field>
        <Field label={`Amount (${getCurrency().symbol})`} error={sub ? err : null}><MoneyInput label="Amount" value={amt} onChange={(p) => { setAmt(p ?? 0); setText(p === null ? 'x' : String((p ?? 0) / 100)) }} /></Field>
        <Field label="Due date" error={sub && !isValidDate(due) ? 'Enter a valid date' : null}><input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Reserve it</button></div>
      </form>
    </Modal>
  )
}

/** Record what a planned or expected bill really cost. The estimate was reserved; the real amount replaces it. */
function PayDialog({ item, today, noun = 'Estimate', onClose, onPay }: { item: PlannedItem; today: string; noun?: string; onClose: () => void; onPay: (amountPaise: number, date: string, method: PayMethod) => void }) {
  const [amt, setAmt] = useState(item.amountPaise)
  const [date, setDate] = useState(today)
  const [method, setMethod] = useState<PayMethod>('upi')
  const [sub, setSub] = useState(false)
  const err = amt > 0 ? null : 'Enter the amount you paid'
  const diff = amt - item.amountPaise
  return (
    <Modal title={`Paid: ${item.title}`} onClose={onClose}>
      <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); setSub(true); if (err || !isValidDate(date)) return; onPay(amt, date, method) }}>
        <Field label={`Amount you paid (${getCurrency().symbol})`} error={sub ? err : null} hint={`${noun} was ${formatMoney(item.amountPaise)}.`}>
          <MoneyInput label="Amount paid" value={amt} onChange={(p) => setAmt(p ?? 0)} />
        </Field>
        {amt > 0 && diff !== 0 && <p className="hint">{noun === 'Set aside' ? (diff > 0 ? `${formatMoney(diff)} more than set aside: the extra comes out of your remaining budget.` : `${formatMoney(-diff)} less than set aside: it is a part payment.`) : diff > 0 ? `${formatMoney(diff)} more than the estimate: it comes out of your remaining budget.` : `${formatMoney(-diff)} less than the estimate: it goes back to your remaining budget.`}</p>}
        <Field label="Date" error={sub && !isValidDate(date) ? 'Enter a valid date' : null}><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Paid with"><Seg label="Payment method" value={method} onChange={setMethod} options={[['upi', 'UPI'], ['card', 'Card'], ['cash', 'Cash'], ['bank', 'Bank'], ['other', 'Other']]} /></Field>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Record payment</button></div>
      </form>
    </Modal>
  )
}
