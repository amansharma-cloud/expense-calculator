import { useMemo, useState } from 'react'
import { exportWorkbook, transactionsToCSV } from '../../db/backup'
import { findDuplicates, outflowByCategory } from '../../engine/budget'
import { addDays, cycleLabel, shortDate } from '../../engine/dates'
import { formatMoney } from '../../engine/money'
import { matchAllocation } from '../../engine/commitments'
import type { Transaction } from '../../engine/types'
import { useStore } from '../../state/store'
import { Confirm, download, Icon, Modal, useToast } from '../components/common'
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

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Transactions</h1>
        <div className="row">
          <button className="btn sm" disabled={!filtered.length} onClick={() => { download('transactions.csv', transactionsToCSV(filtered), 'text/csv;charset=utf-8'); toast('CSV downloaded') }}><Icon name="download" size={16} /> CSV</button>
          <button className="btn sm" disabled={!filtered.length} onClick={() => { download('daily-spend.xlsx', exportWorkbook({ ...data, transactions: filtered }), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); toast('Excel file downloaded') }}><Icon name="download" size={16} /> Excel</button>
        </div>
      </div>

      <div className="card stack">
        <div className="form-grid two">
          <div className="field"><label className="lbl" htmlFor="q">Search</label><input id="q" className="input" type="search" placeholder="Description, category, note or amount" value={q} onChange={(e) => { setQ(e.target.value); setLimit(100) }} /></div>
          <div className="field"><label className="lbl" htmlFor="per">Period</label>
            <select id="per" className="input" value={period} onChange={(e) => { setPeriod(e.target.value as Period); setLimit(100) }}>
              <option value="cycle">Salary cycle</option><option value="today">Today</option><option value="week">This week</option><option value="month">This month</option><option value="custom">Custom dates</option><option value="all">Everything</option>
            </select>
          </div>
        </div>
        <div className="form-grid two">
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
      </div>

      <div className="grid stats">
        <div className="card stat"><div className="label">Entries</div><div className="value num">{filtered.length}</div></div>
        <div className="card stat"><div className="label">Expenses</div><div className="value num">{formatMoney(spent)}</div></div>
        <div className="card stat"><div className="label">Refunds</div><div className="value num">{formatMoney(back)}</div></div>
        <div className="card stat"><div className="label">Net</div><div className="value num">{formatMoney(spent - back)}</div></div>
      </div>
      {catSummary.length > 0 && <div className="chips" aria-label="Top categories in this view">{catSummary.map((c) => <span className="chip" key={c.category}>{c.category} · {formatMoney(c.paise)}</span>)}</div>}

      {filtered.length === 0 ? (
        <div className="card"><p className="muted">No transactions match. {data.transactions.length === 0 ? 'Add your first expense with the + button.' : 'Try a different period or clear the search.'}</p></div>
      ) : (
        <div className="stack">
          {[...groups.entries()].map(([date, list]) => (
            <section className="card" key={date} aria-label={shortDate(date)}>
              <div className="row between"><b>{shortDate(date)}{date === today ? ' · Today' : ''}</b><span className="muted small num">{formatMoney(list.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amountPaise, 0))}</span></div>
              <ul className="list">
                {list.map((t) => (
                  <li key={t.id}>
                    <div className="grow">
                      <div className="title">{t.merchant || t.category}</div>
                      <div className="small muted">
                        {t.category} · {t.method}{t.type !== 'expense' ? ` · ${t.type}` : ''}{t.allocationId ? ' · set-aside' : ''}{t.source === 'import' ? ' · imported' : ''}
                        {dupIds.has(t.id) && <span className="chip warn" style={{ marginLeft: 6 }}>possible duplicate</span>}
                      </div>
                    </div>
                    <span className={`amt num ${t.type === 'refund' || t.type === 'income' ? 'in' : ''}`}>{t.type === 'refund' || t.type === 'income' ? '+' : ''}{formatMoney(t.amountPaise)}</span>
                    {(() => {
                      if (t.type !== 'expense' || t.allocationId) return null
                      const cyc = data.cycles.find((c) => t.date >= c.start && t.date < c.end)
                      const m = cyc && matchAllocation(t.merchant, t.category, t.amountPaise, cyc.allocations)
                      return m?.confident ? <button className="btn sm" title="Count this as the set-aside payment instead of spending" onClick={async () => { await updateTx({ ...t, allocationId: m.allocation.id }); toast(`Counted as ${m.allocation.name}, not spending`) }}>Count as {m.allocation.name}</button> : null
                    })()}
                    <button className="btn ghost sm" aria-label={`Edit ${t.merchant || t.category}`} onClick={() => setEditing(t)}><Icon name="edit" size={16} /></button>
                    <button className="btn ghost sm" aria-label={`Delete ${t.merchant || t.category}`} onClick={() => setDeleting(t)}><Icon name="trash" size={16} /></button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {filtered.length > limit && <button className="btn" onClick={() => setLimit(limit + 100)}>Show more ({filtered.length - limit} left)</button>}
        </div>
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
