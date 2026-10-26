import { getCurrency } from '../../engine/currency'
import { useRef, useState } from 'react'
import { cycleTransactions, dailySeries, spendByCategory } from '../../engine/budget'
import { isValidDate, shortDate } from '../../engine/dates'
import { compareWithPrevious, smartTips, upcomingItems } from '../../engine/insights'
import { formatMoney, parseAmount, validateAmount } from '../../engine/money'
import type { Allocation, PayMethod, PlannedItem, TxType } from '../../engine/types'
import { useStore } from '../../state/store'
import { ordinal } from '../components/DayPicker'
import { MoneyInput } from '../components/AllocationEditor'
import { BackupReminder } from '../components/DataHealth'
import { BalanceCard } from '../components/BalanceCard'
import { CatIcon } from '../components/CatIcon'
import { Hero } from '../components/Hero'
import { KpiTile, QuickActions, SmartTipCard } from '../components/Tiles'
import { greeting } from '../motion'
import { Alert, Confirm, Field, Icon, Modal, Seg, useToast } from '../components/common'
import { DailySpendChart, Legend, RemainingChart, SpendDonut } from '../components/charts'

/** Limits are shown in whole units, rounded down, so the app never nudges you to overspend. */
const whole = (paise: number) => Math.floor(paise / 100) * 100
const rs = (paise: number) => formatMoney(whole(paise))

const dueChip = (n: number) => (n < 0 ? { t: `${-n}d overdue`, c: 'bad' } : n === 0 ? { t: 'Due today', c: 'warn' } : n <= 3 ? { t: `In ${n} day${n === 1 ? '' : 's'}`, c: 'warn' } : { t: `In ${n} days`, c: '' })

export function Dashboard({ onAdd }: { onAdd: (type?: TxType) => void }) {
  const { cycle, budget, data, today, payPlanned, deletePlanned, addPlanned, addTx, active } = useStore()
  const toast = useToast()
  const asideRef = useRef<HTMLElement>(null)
  const [planning, setPlanning] = useState(false)
  const [delPlan, setDelPlan] = useState<string | null>(null)
  const [paying, setPaying] = useState<PlannedItem | null>(null)
  const [payingAlloc, setPayingAlloc] = useState<Allocation | null>(null)
  const [showAllBills, setShowAllBills] = useState(false)
  if (!cycle || !budget) return null
  const b = budget
  const txs = cycleTransactions(cycle, data.transactions)
  const series = dailySeries(cycle, data.transactions, today)
  const cats = spendByCategory(txs)
  const over = b.todayRemainingPaise < 0
  const cmp = compareWithPrevious(cycle, data.cycles, data.transactions, today)
  const subs = (data.plan?.expectedBills ?? []).filter((x) => x.subscription).map((bill) => {
    const item = data.planned.find((p) => p.id === `exp-${bill.id}-${cycle.start}`)
    const paidPaise = item?.done ? data.transactions.filter((t) => t.plannedId === item.id).reduce((n, t) => n + t.amountPaise, 0) : 0
    return { bill, item, paidPaise }
  })
  const subsPaid = subs.reduce((n, r) => n + r.paidPaise, 0)
  const subsLeft = subs.reduce((n, r) => n + (r.item && !r.item.done ? r.bill.estimatePaise : 0), 0)
  const upcoming = upcomingItems(cycle, data.planned, b.allocationPaid, today)
  // bills grouped by due date (soonest first), so a day with several payments is one row
  const billGroups = Object.values(upcoming.reduce<Record<string, { date: string; daysUntil: number; items: typeof upcoming; total: number }>>((acc, u) => {
    const g = (acc[u.date] ??= { date: u.date, daysUntil: u.daysUntil, items: [], total: 0 })
    g.items.push(u); g.total += u.amountPaise
    return acc
  }, {})).sort((x, y) => x.date.localeCompare(y.date))
  const dueSoon = upcoming.filter((u) => u.daysUntil <= 7).reduce((s2, u) => s2 + u.amountPaise, 0)
  const tips = smartTips({ budget: b, upcoming, comparison: cmp, cycle, txs: data.transactions, today })
  const recent = [...txs].sort((a, b2) => (b2.date + b2.time).localeCompare(a.date + a.time)).slice(0, 6)
  const kinds = [['fixed', 'Fixed bills & EMIs'], ['investment', 'Investments & savings'], ['reserved', 'Reserved']] as const
  const barCls = b.utilizationPct >= 100 ? 'bad' : b.utilizationPct >= 80 ? 'warn' : ''
  const trend = cmp && cmp.deltaPct !== null ? { text: `${Math.abs(cmp.deltaPct)}% vs last cycle`, tone: (cmp.deltaPct <= 0 ? 'good' : 'warn') as 'good' | 'warn', down: cmp.deltaPct <= 0 } : undefined

  const payUpcoming = (u: (typeof upcoming)[number]) => {
    if (u.kind === 'planned') setPaying(data.planned.find((p) => p.id === u.id) ?? null)
    else setPayingAlloc(cycle.allocations.find((a) => a.id === u.id) ?? null)
  }

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

      <Hero b={b} cycle={cycle} over={over} onAdd={() => onAdd()} />

      <QuickActions onAdd={() => onAdd()} onPay={() => asideRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />

      <BalanceCard />

      <section className="grid stats" aria-label="Key numbers">
        <KpiTile index={0} label="Original daily budget" value={b.originalDailyPaise} format={(n) => rs(n)} icon="calendar" color="var(--s1)" sub="at cycle start" />
        <KpiTile index={1} label="Today’s recommended" value={b.todayLimitPaise} format={(n) => rs(n)} icon="spark" color="var(--s3)" sub={b.todayLimitPaise >= b.originalDailyPaise ? 'at or above original' : 'below original'} />
        <KpiTile index={2} label="Spent today" value={Math.max(0, b.todaySpentPaise)} format={(n) => rs(n)} icon="bag" color="var(--s2)" sub={`${rs(Math.max(0, b.todayRemainingPaise))} left today`} />
        <KpiTile index={3} label="Daily average" value={b.dailyAveragePaise} format={(n) => rs(n)} icon="gauge" color="var(--s4)" sub="this cycle" />
        <KpiTile index={4} label="Available this cycle" value={b.poolPaise} format={(n) => formatMoney(Math.round(n))} icon="cash" color="var(--s6)" sub={`${formatMoney(b.protectedPaise)} set aside`} />
        <KpiTile index={5} label="Spendable budget" value={b.spendablePaise} format={(n) => formatMoney(Math.round(n))} icon="home" color="var(--s7)" sub="after set-asides" />
        <KpiTile index={6} label="Spent this cycle" value={b.variableSpentPaise} format={(n) => formatMoney(Math.round(n))} icon="trend" color="var(--s5)" sub={b.plannedUnpaidPaise > 0 ? `+ ${formatMoney(b.plannedUnpaidPaise)} planned` : 'regular spending'} trend={trend} />
        <KpiTile index={7} label="Budget used" value={b.utilizationPct} format={(n) => `${Math.round(n)}%`} icon="gauge" color="var(--s8)" bar={{ pct: b.utilizationPct, cls: barCls }} sub={b.utilizationPct >= 80 ? 'getting close to the limit' : 'within budget'} />
      </section>

      <SmartTipCard tips={tips} />

      <div className="grid cols-2">
        <section className="card" aria-label="Where the money goes">
          <h2>Where the money goes</h2>
          <p className="hint">Regular spending this cycle, by category.</p>
          <SpendDonut rows={cats} />
        </section>
        <section className="card" aria-label="Upcoming bills">
          <div className="row between">
            <div>
              <h2>Upcoming bills</h2>
              <p className="hint" style={{ margin: 0 }}>{dueSoon > 0 ? <>{formatMoney(dueSoon)} due in the next 7 days</> : 'Nothing due in the next 7 days'}</p>
            </div>
            <button className="btn sm" onClick={() => setPlanning(true)}><Icon name="plus" size={16} /> Add</button>
          </div>
          {upcoming.length === 0 ? <p className="muted" style={{ marginTop: 10 }}>Nothing due. Bills with a due day, expected bills and planned purchases show up here.</p> : (
            <div className="bill-groups">
              {(showAllBills ? billGroups : billGroups.slice(0, 3)).map((g, gi) => {
                const chip = dueChip(g.daysUntil)
                const names = g.items.slice(0, 2).map((i) => i.title).join(', ') + (g.items.length > 2 ? ` +${g.items.length - 2} more` : '')
                const d = new Date(g.date + 'T00:00:00')
                return (
                  <details key={g.date} className={`bill-group ${g.daysUntil < 0 ? 'late' : ''}`} open={gi === 0 && g.items.length <= 3}>
                    <summary>
                      <span className="date-tile"><b>{d.getDate()}</b><span>{d.toLocaleString('en', { month: 'short' }).toUpperCase()}</span></span>
                      <span className="bg-main">
                        <span className="bg-names">{names}</span>
                        <span className={`chip small ${chip.c}`}>{chip.t}</span>
                      </span>
                      <span className="bg-total num">{formatMoney(g.total)}</span>
                      <Icon name="down" size={16} />
                    </summary>
                    <ul className="bg-items">
                      {g.items.map((u) => (
                        <li key={u.key}>
                          <CatIcon name={u.title} size={30} />
                          <span className="grow"><span className="nm">{u.title}</span>{u.expected && <span className="muted small"> · expected</span>}</span>
                          <b className="num">{formatMoney(u.amountPaise)}</b>
                          <button className="btn sm" aria-label={`Mark ${u.title} paid`} onClick={() => payUpcoming(u)}>Paid</button>
                          {u.kind === 'planned' && !u.expected && <button className="btn ghost sm" aria-label={`Remove ${u.title}`} onClick={() => setDelPlan(u.id)}><Icon name="trash" size={16} /></button>}
                        </li>
                      ))}
                    </ul>
                  </details>
                )
              })}
              {billGroups.length > 3 && <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setShowAllBills(!showAllBills)}>{showAllBills ? 'Show fewer' : `Show ${billGroups.length - 3} more date${billGroups.length - 3 === 1 ? '' : 's'}`}</button>}
            </div>
          )}
        </section>
      </div>

      <div className="grid cols-2">
        <section className="card" aria-label="Daily spending">
          <h2>Daily spending</h2>
          <Legend items={[['var(--accent)', 'Spent'], ['var(--s2)', 'Today’s limit']]} />
          <DailySpendChart series={series} limit={b.todayLimitPaise} />
        </section>
        <section className="card" aria-label="Remaining budget">
          <h2>Remaining budget</h2>
          <Legend items={[['var(--accent)', 'Remaining'], ['var(--muted)', 'Even pace']]} />
          <RemainingChart series={series} />
        </section>
      </div>

      <section className="card" aria-label="Set aside" id="set-aside" ref={asideRef}>
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
                        <CatIcon name={a.name} size={34} />
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

      {subs.length > 0 && (
        <section className="card" aria-label="Subscriptions">
          <div className="row between">
            <div>
              <h2>Subscriptions</h2>
              <p className="hint" style={{ margin: 0 }}>{subsPaid > 0 ? `${formatMoney(subsPaid)} paid this cycle` : 'Nothing deducted yet this cycle'}{subsLeft > 0 ? ` · ${formatMoney(subsLeft)} still expected` : ''}</p>
            </div>
            <a href="#/budget" className="small">Manage</a>
          </div>
          <ul className="sub-list">
            {subs.map((r) => (
              <li key={r.bill.id}>
                <CatIcon name={r.bill.name} size={34} />
                <span className="grow nm">{r.bill.name}</span>
                {r.item?.done
                  ? <><b className="num">{formatMoney(r.paidPaise)}</b><span className="chip good small"><Icon name="check" size={14} /> Paid</span></>
                  : <>{r.bill.renewMonth && !r.item
                    ? <span className="muted small">Renews {new Date(2000, r.bill.renewMonth - 1, 1).toLocaleString('en', { month: 'short' })} · {formatMoney(r.bill.estimatePaise)}/yr</span>
                    : r.bill.estimatePaise > 0 && <span className="num muted">~{formatMoney(r.bill.estimatePaise)}</span>}{r.item && <button className="btn sm" aria-label={`Mark ${r.bill.name} paid`} onClick={() => setPaying(r.item!)}>Paid</button>}</>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid cols-2">
        <section className="card" aria-label="Recent">
          <div className="row between"><h2>Recent activity</h2><a href="#/transactions" className="small">See all</a></div>
          {recent.length === 0 ? <p className="muted">Nothing recorded yet this cycle. If you spend today, add it so the limit stays accurate.</p> : (
            <ul className="list">
              {recent.map((t) => {
                const plus = t.type === 'refund' || t.type === 'income'
                return (
                  <li key={t.id}>
                    <CatIcon name={t.category || t.merchant} />
                    <div className="grow"><div className="title">{t.merchant || t.category}</div><div className="small muted">{t.category} · {shortDate(t.date)}</div></div>
                    <span className={`amt num ${plus ? 'in' : ''}`}>{plus ? '+' : '-'}{formatMoney(t.amountPaise)}</span>
                  </li>
                )
              })}
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
              Carry-over of {formatMoney(cycle.openingCarryPaise)} is kept as a reserve; only the released part is included. Recorded spending is what you entered: if entries are missing, the limit is too generous.
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
