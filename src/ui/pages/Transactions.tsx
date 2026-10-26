import { useMemo, useState } from 'react'
import { exportWorkbook, transactionsToCSV } from '../../db/backup'
import { findDuplicates, outflowByCategory } from '../../engine/budget'
import { addDays, cycleLabel, shortDate } from '../../engine/dates'
import { formatMoney } from '../../engine/money'
import { matchAllocation } from '../../engine/commitments'
import type { Transaction } from '../../engine/types'
import { useStore } from '../../state/store'
import { CatIcon } from '../components/CatIcon'
import { Confirm, download, Icon, Modal, Seg, useToast } from '../components/common'
import { EmptyState } from '../components/Section'
import { KpiTile } from '../components/Tiles'
import { ExpenseForm } from '../components/ExpenseForm'

type Period = 'cycle' | 'today' | 'week' | 'month' | 'all' | 'custom'

export function Transactions() {
  const { data, today, cycle, deleteTx, updateTx } = useStore()
  const toast = useToast()
  const [q, setQ] = useState('')
  const [period, setPeriod] = useState<Period>('cycle')
  const [cycleStart, setCycleStart] = useState(cycle?.start ?? '')
  const [from, setFrom] = useState(addDays(today, -30))
  const [to, setTo] = useState(today)
  const [cat, setCat] = useState('')
  const [type, setType] = useState('')
  const [limit, setLimit] = useState(100)
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [deleting, setDeleting] = useState<Transaction | null>(null)
  const [open, setOpen] = useState<Transaction | null>(null)

  const cycles = useMemo(() => [...data.cycles].sort((a, b) => b.start.localeCompare(a.start)), [data.cycles])
  const range = useMemo((): [string, string] => {
    const d = new Date(today + 'T00:00:00')
    const dow = (d.getDay() + 6) % 7 // Monday-based week
    switch (period) {
      case 'today': return [today, today]
      case 'week': return [addDays(today, -dow), today]
      case 'month': return [today.slice(0, 8) + '01', today]
      case 'all': return ['0000-01-01', '9999-12-31']
      case 'custom': return [from, to]
      default: {
        const c = data.cycles.find((x) => x.start === cycleStart) ?? cycle
        return c ? [c.start, addDays(c.end, -1)] : ['0000-01-01', '9999-12-31']
      }
    }
  }, [period, today, from, to, cycleStart, data.cycles, cycle])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return data.transactions
      .filter((t) => t.date >= range[0] && t.date <= range[1])
      .filter((t) => !cat || t.category === cat)
      .filter((t) => !type || t.type === type)
      .filter((t) => !needle || `${t.merchant} ${t.category} ${t.note}`.toLowerCase().includes(needle) || formatMoney(t.amountPaise).includes(needle))
      .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time))
  }, [data.transactions, range, cat, type, q])

  const dupIds = useMemo(() => new Set(findDuplicates(data.transactions).flat().map((t) => t.id)), [data.transactions])
  const allCats = useMemo(() => [...new Set(data.transactions.map((t) => t.category))].sort(), [data.transactions])
  const spent = filtered.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amountPaise, 0)
  const back = filtered.filter((t) => t.type === 'refund').reduce((s, t) => s + t.amountPaise, 0)
  const shown = filtered.slice(0, limit)
  const groups = new Map<string, Transaction[]>()
  for (const t of shown) groups.set(t.date, [...(groups.get(t.date) ?? []), t])
  const catSummary = outflowByCategory(filtered).slice(0, 5)
  const dayLabel = (d: string) => {
    if (d === today) return 'Today'
    if (d === addDays(today, -1)) return 'Yesterday'
    return new Date(d + 'T00:00:00').toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' })
  }
  const linkFor = (t: Transaction) => {
    if (t.type !== 'expense' || t.allocationId) return null
    const cyc = data.cycles.find((c) => t.date >= c.start && t.date < c.end)
    const m = cyc && matchAllocation(t.merchant, t.category, t.amountPaise, cyc.allocations)
    return m?.confident ? m.allocation : null
  }

  return (
    <div className="stack">
      <div className="page-head reveal">
        <div>
          <h1>History</h1>
          <span className="muted small">{filtered.length} entr{filtered.length === 1 ? 'y' : 'ies'} · {formatMoney(spent - back)} net spent</span>
        </div>
        <div className="row">
          <button className="btn sm" disabled={!filtered.length} onClick={() => { download('transactions.csv', transactionsToCSV(filtered), 'text/csv;charset=utf-8'); toast('CSV downloaded') }}><Icon name="download" size={16} /> CSV</button>
          <button className="btn sm" disabled={!filtered.length} onClick={async () => { download('daily-spend.xlsx', await exportWorkbook({ ...data, transactions: filtered }), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); toast('Excel file downloaded') }}><Icon name="download" size={16} /> Excel</button>
        </div>
      </div>

      <section data-tour="history" className="card filters reveal" style={{ '--i': 1 } as React.CSSProperties} aria-label="Filters">
        <div className="search">
          <Icon name="list" size={18} />
          <input id="q" className="input" type="search" aria-label="Search transactions" placeholder="Search description, category, note or amount" value={q} onChange={(e) => { setQ(e.target.value); setLimit(100) }} />
        </div>
        <Seg<Period> label="Period" value={period} onChange={(v) => { setPeriod(v); setLimit(100) }}
          options={[['cycle', 'Cycle'], ['today', 'Today'], ['week', 'Week'], ['month', 'Month'], ['custom', 'Custom'], ['all', 'All']]} />
        <div className="filter-row">
          {period === 'cycle' && (
            <div className="field"><label className="lbl" htmlFor="cyc">Cycle</label>
              <select id="cyc" className="input" value={cycleStart} onChange={(e) => setCycleStart(e.target.value)}>
                {cycles.map((c) => <option key={c.start} value={c.start}>{c.label ? c.label + ' · ' : ''}{cycleLabel(c.start, c.end)}</option>)}
              </select>
            </div>
          )}
          {period === 'custom' && (<>
            <div className="field"><label className="lbl" htmlFor="f">From</label><input id="f" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div className="field"><label className="lbl" htmlFor="t">To</label><input id="t" type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          </>)}
          <div className="field"><label className="lbl" htmlFor="c">Category</label>
            <select id="c" className="input" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All categories</option>{allCats.map((c) => <option key={c}>{c}</option>)}</select>
          </div>
          <div className="field"><label className="lbl" htmlFor="ty">Type</label>
            <select id="ty" className="input" value={type} onChange={(e) => setType(e.target.value)}><option value="">All types</option><option value="expense">Expenses</option><option value="refund">Refunds</option><option value="income">Income</option><option value="transfer">Transfers</option></select>
          </div>
        </div>
      </section>

      <div className="grid stats">
        <KpiTile index={0} label="Entries" value={filtered.length} format={(n) => String(Math.round(n))} icon="list" color="var(--s1)" />
        <KpiTile index={1} label="Expenses" value={spent} format={(n) => formatMoney(Math.round(n))} icon="bag" color="var(--s2)" />
        <KpiTile index={2} label="Refunds" value={back} format={(n) => formatMoney(Math.round(n))} icon="down" color="var(--s6)" />
        <KpiTile index={3} label="Net" value={spent - back} format={(n) => formatMoney(Math.round(n))} icon="trend" color="var(--s5)" />
      </div>
      {catSummary.length > 0 && (
        <div className="chips" aria-label="Top categories in this view">
          {catSummary.map((c) => <span className="chip" key={c.category}>{c.category} · {formatMoney(c.paise)}</span>)}
        </div>
      )}

      {filtered.length === 0 ? (
        <section className="card"><EmptyState title="Nothing here" text={data.transactions.length === 0 ? 'Add your first expense with the + button and it will show up here.' : 'No transactions match these filters. Try another period or clear the search.'} /></section>
      ) : (
        <div className="stack">
          {[...groups.entries()].map(([date, list]) => (
            <section key={date} aria-label={dayLabel(date)}>
              <div className="day-head"><b>{dayLabel(date)}</b><span className="num">{formatMoney(list.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amountPaise, 0))} spent</span></div>
              <div className="card tx-list">
                {list.map((t) => {
                  const plus = t.type === 'refund' || t.type === 'income'
                  return (
                    <button key={t.id} className="tx-row" onClick={() => setOpen(t)} aria-label={`${t.merchant || t.category}, ${formatMoney(t.amountPaise)}. Open details`}>
                      <CatIcon name={t.category || t.merchant} />
                      <div className="grow">
                        <div className="title">{t.merchant || t.category}</div>
                        <div className="sub">{t.category} · {t.method}{t.type !== 'expense' ? ` · ${t.type}` : ''}{t.allocationId ? ' · set-aside' : ''}{t.source === 'import' ? ' · imported' : ''}</div>
                        {(dupIds.has(t.id) || linkFor(t)) && (
                          <div className="tx-tags">
                            {dupIds.has(t.id) && <span className="chip warn small">possible duplicate</span>}
                            {linkFor(t) && <span className="chip small">may be {linkFor(t)!.name}</span>}
                          </div>
                        )}
                      </div>
                      <span className={`amt num ${plus ? 'in' : ''}`}>{plus ? '+' : '-'}{formatMoney(t.amountPaise)}</span>
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
          {filtered.length > limit && <button className="btn" onClick={() => setLimit(limit + 100)}>Show more ({filtered.length - limit} left)</button>}
        </div>
      )}

      {open && (
        <Modal title={open.merchant || open.category} onClose={() => setOpen(null)}>
          <dl className="kv">
            <dt>Amount</dt><dd className="num">{open.type === 'refund' || open.type === 'income' ? '+' : '-'}{formatMoney(open.amountPaise)}</dd>
            <dt>Type</dt><dd>{open.type}</dd>
            <dt>Category</dt><dd>{open.category}</dd>
            <dt>When</dt><dd>{shortDate(open.date)} · {open.time}</dd>
            <dt>Paid with</dt><dd>{open.method}</dd>
            {open.allocationId && (<><dt>Counts as</dt><dd>a set-aside payment, not spending</dd></>)}
            {open.note && (<><dt>Note</dt><dd>{open.note}</dd></>)}
          </dl>
          <div className="sheet-actions">
            {linkFor(open) && (
              <button className="btn" onClick={async () => { const a = linkFor(open)!; await updateTx({ ...open, allocationId: a.id }); setOpen(null); toast(`Counted as ${a.name}, not spending`) }}>Count as {linkFor(open)!.name} (set-aside)</button>
            )}
            <button className="btn primary" onClick={() => { setEditing(open); setOpen(null) }}><Icon name="edit" size={16} /> Edit</button>
            <button className="btn danger" onClick={() => { setDeleting(open); setOpen(null) }}><Icon name="trash" size={16} /> Delete</button>
          </div>
        </Modal>
      )}
      {editing && (
        <Modal title="Edit transaction" onClose={() => setEditing(null)}>
          <ExpenseForm initial={editing} onCancel={() => setEditing(null)} onSaved={async (d) => { await updateTx({ ...editing, ...d }); setEditing(null); toast('Saved') }} />
        </Modal>
      )}
      {deleting && (
        <Confirm title="Delete this transaction?" body={<>{deleting.merchant || deleting.category} · {formatMoney(deleting.amountPaise)} on {shortDate(deleting.date)}. Your budget will be recalculated. This can’t be undone.</>}
          onCancel={() => setDeleting(null)} onConfirm={async () => { await deleteTx(deleting.id); setDeleting(null); toast('Deleted') }} />
      )}
    </div>
  )
}
