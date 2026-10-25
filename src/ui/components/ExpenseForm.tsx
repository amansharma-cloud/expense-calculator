import { useMemo, useState } from 'react'
import { nowHM, isValidDate } from '../../engine/dates'
import { formatINR, parseAmount, validateAmount } from '../../engine/money'
import { parseQuickEntry, suggestCategory } from '../../engine/quick'
import type { PayMethod, Transaction, TxType } from '../../engine/types'
import { useStore } from '../../state/store'
import { Field, Seg } from './common'

type Draft = Omit<Transaction, 'id' | 'createdAt'>

const METHODS: [PayMethod, string][] = [['upi', 'UPI'], ['card', 'Card'], ['cash', 'Cash'], ['bank', 'Bank'], ['other', 'Other']]

/**
 * One form for add + edit. The quick line ("Spent 350 on groceries today") fills the fields below it;
 * every suggestion stays editable before saving.
 */
export function ExpenseForm({ initial, onSaved, onCancel }: { initial?: Transaction; onSaved: (t: Draft, isNew: boolean) => void; onCancel?: () => void }) {
  const { today, categories, data, cycle } = useStore()
  const [quick, setQuick] = useState('')
  const [amount, setAmount] = useState(initial ? String(initial.amountPaise / 100) : '')
  const [merchant, setMerchant] = useState(initial?.merchant ?? '')
  const [category, setCategory] = useState(initial?.category ?? '')
  const [catTouched, setCatTouched] = useState(!!initial)
  const [date, setDate] = useState(initial?.date ?? today)
  const [time, setTime] = useState(initial?.time ?? nowHM())
  const [method, setMethod] = useState<PayMethod>(initial?.method ?? 'upi')
  const [type, setType] = useState<TxType>(initial?.type ?? 'expense')
  const [note, setNote] = useState(initial?.note ?? '')
  const [allocationId, setAllocationId] = useState(initial?.allocationId ?? '')
  const [submitted, setSubmitted] = useState(false)

  const suggestion = useMemo(() => suggestCategory(merchant, categories, data.transactions), [merchant, categories, data.transactions])
  const shownCategory = catTouched ? category : suggestion ?? category

  const amountErr = validateAmount(amount)
  const dateErr = isValidDate(date) ? null : 'Enter a valid date'
  const catErr = shownCategory.trim() ? null : 'Pick or type a category'
  const missingHint = quick && parseQuickEntry(quick, today).missing.length ? parseQuickEntry(quick, today).missing : []

  const applyQuick = (text: string) => {
    setQuick(text)
    const p = parseQuickEntry(text, today)
    if (p.amountPaise) setAmount(String(p.amountPaise / 100))
    setDate(p.date)
    if (p.description) setMerchant(p.description.charAt(0).toUpperCase() + p.description.slice(1))
  }

  const topCats = useMemo(() => {
    const freq = new Map<string, number>()
    for (const t of data.transactions.slice(-300)) freq.set(t.category, (freq.get(t.category) ?? 0) + 1)
    const fromHistory = [...freq.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0]).filter((c) => categories.includes(c))
    return [...new Set([...fromHistory, ...categories])].slice(0, 12)
  }, [data.transactions, categories])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    if (amountErr || dateErr || catErr) return
    onSaved({
      date, time, amountPaise: parseAmount(amount)!, type, category: shownCategory.trim(), merchant: merchant.trim(), method,
      card: initial?.card, note: note.trim(), allocationId: allocationId || undefined, plannedId: initial?.plannedId,
      source: initial?.source ?? (quick ? 'quick' : 'manual'), importHash: initial?.importHash,
    }, !initial)
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      {!initial && (
        <Field label="Quick entry" hint="Type it the way you say it, e.g. “Uber 250 yesterday”. Fields below fill in; check them before saving.">
          <input className="input" autoFocus value={quick} onChange={(e) => applyQuick(e.target.value)} placeholder="Spent ₹350 on groceries today" autoComplete="off" />
          {missingHint.length > 0 && <span className="err-text">I still need the {missingHint.join(' and ')}.</span>}
        </Field>
      )}
      <Seg label="Type" value={type} onChange={setType} options={[['expense', 'Expense'], ['refund', 'Refund'], ['income', 'Income'], ['transfer', 'Transfer']]} />
      <div className="form-grid two">
        <Field label="Amount (₹)" htmlFor="amt" error={submitted ? amountErr : null}>
          <input id="amt" className={`input amount-input num ${submitted && amountErr ? 'err' : ''}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" autoComplete="off" />
        </Field>
        <Field label={type === 'income' ? 'Source' : 'Description / merchant'} htmlFor="mer">
          <input id="mer" className="input" value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="e.g. Zomato" autoComplete="off" />
        </Field>
      </div>
      <Field label="Category" error={submitted ? catErr : null} hint={!catTouched && suggestion ? `Suggested from the description: ${suggestion}` : undefined}>
        <div className="chips" role="group" aria-label="Category">
          {topCats.map((c) => (
            <button type="button" key={c} aria-pressed={shownCategory === c} onClick={() => { setCategory(c); setCatTouched(true) }}>{c}</button>
          ))}
        </div>
        <input className="input" list="cats" value={shownCategory} onChange={(e) => { setCategory(e.target.value); setCatTouched(true) }} placeholder="Or type another category" aria-label="Category name" />
        <datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      </Field>
      <div className="form-grid two">
        <Field label="Date" error={submitted ? dateErr : null} htmlFor="date">
          <input id="date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Time" htmlFor="time">
          <input id="time" type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
      </div>
      <Field label="Paid with">
        <Seg label="Payment method" value={method} onChange={setMethod} options={METHODS} />
      </Field>
      {(type === 'expense' || type === 'refund') && cycle && cycle.allocations.length > 0 && (
        <Field label="Settles a commitment? (optional)" hint="Choose one for rent, EMI, SIPs… so it isn’t counted again as spending.">
          <select className="input" value={allocationId} onChange={(e) => setAllocationId(e.target.value)}>
            <option value="">No – this is regular spending</option>
            {cycle.allocations.map((a) => <option key={a.id} value={a.id}>{a.name} ({formatINR(a.amountPaise)} planned)</option>)}
          </select>
        </Field>
      )}
      {type === 'transfer' && <p className="hint">Transfers (own-account moves, credit-card bill payments) are recorded but never counted as spending.</p>}
      <Field label="Note (optional)" htmlFor="note">
        <textarea id="note" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Cancel</button>}
        <button type="submit" className="btn primary">{initial ? 'Save changes' : 'Save'}</button>
      </div>
    </form>
  )
}
