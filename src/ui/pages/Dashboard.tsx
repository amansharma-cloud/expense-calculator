import { getCurrency } from '../../engine/currency'
import { useState } from 'react'
import { cycleTransactions, dailySeries, spendByCategory } from '../../engine/budget'
import { cycleLabel, isValidDate, shortDate } from '../../engine/dates'
import { formatMoney, parseAmount, validateAmount } from '../../engine/money'
import type { PayMethod, PlannedItem } from '../../engine/types'
import { useStore } from '../../state/store'

/** Limits are shown in whole rupees, rounded down, so the app never nudges you to overspend. */
const rs = (paise: number) => formatMoney(Math.floor(paise / 100) * 100)
import { MoneyInput } from '../components/AllocationEditor'
import { BackupReminder } from '../components/DataHealth'
import { Alert, Confirm, Field, Icon, Modal, Seg, StatusChip, useToast } from '../components/common'
import { CategoryBars, DailySpendChart, Legend, RemainingChart } from '../components/charts'

function Ring({ spent, limit, over }: { spent: number; limit: number; over: boolean }) {
  const r = 62, c = 2 * Math.PI * r
  const pct = limit > 0 ? Math.min(1, Math.max(0, spent) / limit) : spent > 0 ? 1 : 0
  return (
    <svg viewBox="0 0 148 148" aria-hidden="true">
      <circle cx="74" cy="74" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="14" />
      <circle cx="74" cy="74" r={r} fill="none" stroke={over ? 'var(--bad)' : pct > 0.8 ? 'var(--warn)' : 'var(--accent)'} strokeWidth="14" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} />
    </svg>
  )
}

export function Dashboard({ onAdd }: { onAdd: () => void }) {
  const { cycle, budget, data, today, payPlanned, deletePlanned, addPlanned } = useStore()
  const toast = useToast()
  const [planning, setPlanning] = useState(false)
  const [delPlan, setDelPlan] = useState<string | null>(null)
  const [paying, setPaying] = useState<PlannedItem | null>(null)
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
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <span className="muted small">{cycle.label ?? 'Pay cycle'} · {cycleLabel(cycle.start, cycle.end)} · day {b.dayNumber} of {b.cycleDays}</span>
        </div>
        <StatusChip status={b.status} />
      </div>

      <BackupReminder />
      {b.warnings.map((w, i) => <Alert key={i} kind={b.status === 'over' || b.status === 'exhausted' ? 'bad' : 'warn'}>{w}</Alert>)}

      <section className="card hero" aria-label="Today">
        <div className="hero-main">
          <div className="ring">
            <Ring spent={b.todaySpentPaise} limit={b.todayLimitPaise} over={over} />
            <div className="center"><b className="num">{b.todayLimitPaise > 0 ? Math.round((Math.max(0, b.todaySpentPaise) / b.todayLimitPaise) * 100) : 0}%</b><span className="small muted">of today</span></div>
          </div>
          <div className="hero-text">
            <div className="kicker">{over ? 'You are over today’s limit by' : 'You can still spend today'}</div>
            <div className="big num">{rs(Math.abs(b.todayRemainingPaise))}</div>
            <div className="kicker" style={{ marginTop: 6 }}>Today’s limit {rs(b.todayLimitPaise)} · spent {rs(Math.max(0, b.todaySpentPaise))}</div>
            <button className="btn primary" style={{ marginTop: 12 }} onClick={onAdd}><Icon name="plus" size={18} /> Add expense</button>
          </div>
        </div>
        <div className="hero-meta">
          <div><div className="label">Left this cycle</div><div className="v num">{formatMoney(b.remainingPaise)}</div></div>
          <div><div className="label">Days to next pay</div><div className="v num">{b.daysLeft}</div></div>
          <div><div className="label">Next payday</div><div className="v num">{shortDate(cycle.end)}</div></div>
        </div>
      </section>

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
        <section className="card" aria-label="Where the money goes">
          <h2>Where the money goes</h2>
          <p className="hint">Regular spending this cycle, by category.</p>
          <CategoryBars rows={cats} />
        </section>
        <section className="card" aria-label="Set aside">
          <h2>Set aside this cycle</h2>
          <p className="hint">Protected before spending. Paid = recorded against the item.</p>
          {cycle.allocations.length === 0 && <p className="muted">Nothing set aside. Add bills and investments under Budget.</p>}
          {kinds.map(([k, title]) => {
            const items = cycle.allocations.filter((a) => a.kind === k && a.amountPaise > 0)
            if (!items.length) return null
            const planned = items.reduce((s, a) => s + a.amountPaise, 0)
            const paid = items.reduce((s, a) => s + Math.min(a.amountPaise, b.allocationPaid[a.id] ?? 0), 0)
            return (
              <div key={k} style={{ margin: '10px 0' }}>
                <div className="row between"><b>{title}</b><span className="num small">{formatMoney(paid)} of {formatMoney(planned)}</span></div>
                <div className="bar" role="progressbar" aria-valuenow={Math.round((paid / planned) * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`${title} paid`}><i style={{ width: `${(paid / planned) * 100}%`, background: 'var(--s3)' }} /></div>
              </div>
            )
          })}
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
      </div>

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

      {paying && (
        <PayDialog item={paying} today={today} onClose={() => setPaying(null)} onPay={async (amountPaise, date, method) => {
          await payPlanned(paying, { date, time: new Date().toTimeString().slice(0, 5), amountPaise, type: 'expense', category: paying.category || 'Other', merchant: paying.title, method, note: paying.id.startsWith('exp-') ? 'Expected bill paid' : 'Planned item paid', source: 'manual' })
          setPaying(null)
          toast(`Recorded ${formatMoney(amountPaise)} for ${paying.title}`)
        }} />
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
function PayDialog({ item, today, onClose, onPay }: { item: PlannedItem; today: string; onClose: () => void; onPay: (amountPaise: number, date: string, method: PayMethod) => void }) {
  const [amt, setAmt] = useState(item.amountPaise)
  const [date, setDate] = useState(today)
  const [method, setMethod] = useState<PayMethod>('upi')
  const [sub, setSub] = useState(false)
  const err = amt > 0 ? null : 'Enter the amount you paid'
  const diff = amt - item.amountPaise
  return (
    <Modal title={`Paid: ${item.title}`} onClose={onClose}>
      <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); setSub(true); if (err || !isValidDate(date)) return; onPay(amt, date, method) }}>
        <Field label={`Amount you paid (${getCurrency().symbol})`} error={sub ? err : null} hint={`Estimate was ${formatMoney(item.amountPaise)}.`}>
          <MoneyInput label="Amount paid" value={amt} onChange={(p) => setAmt(p ?? 0)} />
        </Field>
        {amt > 0 && diff !== 0 && <p className="hint">{diff > 0 ? `${formatMoney(diff)} more than the estimate: it comes out of your remaining budget.` : `${formatMoney(-diff)} less than the estimate: it goes back to your remaining budget.`}</p>}
        <Field label="Date" error={sub && !isValidDate(date) ? 'Enter a valid date' : null}><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Paid with"><Seg label="Payment method" value={method} onChange={setMethod} options={[['upi', 'UPI'], ['card', 'Card'], ['cash', 'Cash'], ['bank', 'Bank'], ['other', 'Other']]} /></Field>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Record payment</button></div>
      </form>
    </Modal>
  )
}
