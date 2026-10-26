import { getCurrency } from '../../engine/currency'
import { useEffect, useState } from 'react'
import { parseAmount } from '../../engine/money'
import { CatIcon } from './CatIcon'
import type { Allocation, AllocationKind, ExpectedBill, Paise } from '../../engine/types'
import { DayPicker } from './DayPicker'
import { Icon } from './common'

/** Text input that edits an amount in rupees but reports integer paise (or null while invalid). */
export function MoneyInput({ value, onChange, id, label, allowZero = true, invalid }: {
  value: Paise; onChange: (p: Paise | null) => void; id?: string; label: string; allowZero?: boolean; invalid?: boolean
}) {
  const [text, setText] = useState(value ? String(value / 100) : '')
  useEffect(() => {
    // follow external changes (e.g. reset) but never fight the user's typing
    if (parseAmount(text) !== value && !(text === '' && value === 0)) setText(value ? String(value / 100) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  const bad = text !== '' && (parseAmount(text) === null || (!allowZero && parseAmount(text) === 0))
  return (
    <input
      id={id} aria-label={label} inputMode="decimal" className={`input num ${bad || invalid ? 'err' : ''}`} value={text} placeholder="0"
      onChange={(e) => { setText(e.target.value); onChange(e.target.value === '' ? 0 : parseAmount(e.target.value)) }}
    />
  )
}

const KIND_LABEL: Record<AllocationKind, string> = { fixed: 'Fixed bill / EMI', investment: 'Investment / saving', reserved: 'Reserved / goal' }
const MORE = { '': 'More…', expected: 'Varies monthly (expected bill)', spending: 'Treat as spending' } as const

export function AllocationEditor({ items, onChange, onConvert }: {
  items: Allocation[]; onChange: (a: Allocation[]) => void
  /** When given, saved fixed items get a "More…" menu to move them to expected bills / spending. */
  onConvert?: (a: Allocation, to: 'spending' | 'expected') => void
}) {
  const update = (id: string, patch: Partial<Allocation>) => onChange(items.map((a) => (a.id === id ? { ...a, ...patch } : a)))
  return (
    <div className="stack">
      {items.length === 0 && <p className="muted">Nothing here yet. Add rent, EMIs, SIPs, savings… anything you want protected before you spend.</p>}
      {items.length > 0 && (
        <div className="rows" role="list" aria-label="Set-asides">
          <div className="rows-head" aria-hidden="true"><span>Name</span><span>Type</span><span>Amount ({getCurrency().symbol})</span><span>Due day</span><span /></div>
          {items.map((a) => (
            <div key={a.id} className="row-card" role="listitem">
              <div className="field c-name">
                <label className="lbl m-only" htmlFor={'n' + a.id}>Name</label>
                <input id={'n' + a.id} className="input" value={a.name} aria-label="Name" onChange={(e) => update(a.id, { name: e.target.value })} />
              </div>
              <div className="field c-type">
                <label className="lbl m-only" htmlFor={'k' + a.id}>Type</label>
                <select id={'k' + a.id} className="input" aria-label="Type" value={a.kind} onChange={(e) => update(a.id, { kind: e.target.value as AllocationKind })}>
                  {(Object.keys(KIND_LABEL) as AllocationKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                </select>
              </div>
              <div className="field c-amt">
                <label className="lbl m-only" htmlFor={'a' + a.id}>Amount ({getCurrency().symbol})</label>
                <MoneyInput id={'a' + a.id} label={`${a.name || 'Item'} amount`} value={a.amountPaise} onChange={(p) => p !== null && update(a.id, { amountPaise: p })} />
              </div>
              <div className="field c-due">
                <span className="lbl m-only">Due day</span>
                <DayPicker label={`Due day for ${a.name || 'item'}`} value={a.dueDay} optional emptyText="No due day" onChange={(d) => update(a.id, { dueDay: d })} />
              </div>
              <div className="c-act">
                {onConvert && a.kind === 'fixed' && a.name.trim() && (
                  <select className="input more" aria-label={`More options for ${a.name}`} value="" onChange={(e) => { const v = e.target.value; if (v === 'expected' || v === 'spending') onConvert(a, v) }}>
                    {(Object.entries(MORE) as [string, string][]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                )}
                <button type="button" className="btn ghost danger" aria-label={`Remove ${a.name}`} onClick={() => onChange(items.filter((x) => x.id !== a.id))}><Icon name="trash" size={18} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div>
        <button type="button" className="btn" onClick={() => onChange([...items, { id: crypto.randomUUID(), name: '', kind: 'fixed', amountPaise: 0 }])}>
          <Icon name="plus" size={18} /> Add item
        </button>
      </div>
    </div>
  )
}

/** Bills that come every cycle with a changing amount. The estimate is reserved until you pay the real amount. */
export const DEFAULT_SUBSCRIPTIONS = ['Netflix', 'Amazon Prime', 'Hotstar', 'Sony Liv', 'YouTube', 'KodeKloud']

/** Expected bills; with `subscriptions` it edits the subscription entries instead (the two lists share one array). */
export function ExpectedBillsEditor({ all, onChange, subscriptions = false }: { all: ExpectedBill[]; onChange: (b: ExpectedBill[]) => void; subscriptions?: boolean }) {
  const mine = (b: ExpectedBill) => !!b.subscription === subscriptions
  const items = all.filter(mine)
  const change = (next: ExpectedBill[]) => onChange([...all.filter((b) => !mine(b)), ...next])
  const blank = (name = ''): ExpectedBill => ({ id: crypto.randomUUID(), name, estimatePaise: 0, category: name, ...(subscriptions ? { subscription: true } : {}) })
  const missing = subscriptions ? DEFAULT_SUBSCRIPTIONS.filter((n) => !items.some((b) => b.name.trim().toLowerCase() === n.toLowerCase())) : []
  const update = (id: string, patch: Partial<ExpectedBill>) => change(items.map((b) => (b.id === id ? { ...b, ...patch } : b)))
  return (
    <div className="stack">
      {items.length === 0 && <p className="muted">{subscriptions ? 'None yet. Tap a service below to add it.' : 'None yet. Add bills like electricity or mobile recharge: you enter the real amount when you pay.'}</p>}
      {items.length > 0 && (
        <div className="rows bills" role="list" aria-label={subscriptions ? 'Subscriptions' : 'Expected bills'}>
          <div className="rows-head" aria-hidden="true"><span>{subscriptions ? 'Subscription' : 'Bill'}</span><span>Usual amount ({getCurrency().symbol})</span><span>Due day</span><span /></div>
          {items.map((b) => (
            <div key={b.id} className="row-card" role="listitem">
              <div className="field c-name">
                <label className="lbl m-only" htmlFor={'bn' + b.id}>{subscriptions ? 'Subscription' : 'Bill'}</label>
                {subscriptions && <CatIcon name={b.name} size={34} />}
                <input id={'bn' + b.id} className="input" aria-label={subscriptions ? 'Subscription' : 'Bill'} value={b.name} onChange={(e) => update(b.id, { name: e.target.value, category: b.category === b.name || !b.category ? e.target.value : b.category })} />
              </div>
              <div className="field c-amt">
                <label className="lbl m-only" htmlFor={'be' + b.id}>Usual amount ({getCurrency().symbol})</label>
                <MoneyInput id={'be' + b.id} label={`${b.name || 'Bill'} usual amount`} value={b.estimatePaise} onChange={(p) => p !== null && update(b.id, { estimatePaise: p })} />
              </div>
              <div className="field c-due">
                <span className="lbl m-only">Due day</span>
                <DayPicker label={`Due day for ${b.name || 'bill'}`} value={b.dueDay} optional emptyText="Any day" onChange={(d) => update(b.id, { dueDay: d })} />
              </div>
              <div className="c-act">
                <button type="button" className="btn ghost danger" aria-label={`Remove ${b.name}`} onClick={() => change(items.filter((x) => x.id !== b.id))}><Icon name="trash" size={18} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      {missing.length > 0 && (
        <div className="chip-row" role="group" aria-label="Add a common subscription">
          {missing.map((n) => <button key={n} type="button" className="chip-btn" onClick={() => change([...items, blank(n)])}><CatIcon name={n} size={22} /> {n}</button>)}
        </div>
      )}
      <div>
        <button type="button" className="btn" onClick={() => change([...items, blank()])}><Icon name="plus" size={18} /> {subscriptions ? 'Add another subscription' : 'Add expected bill'}</button>
      </div>
    </div>
  )
}
