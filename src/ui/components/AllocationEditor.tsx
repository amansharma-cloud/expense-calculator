import { getCurrency } from '../../engine/currency'
import { useEffect, useState } from 'react'
import { parseAmount } from '../../engine/money'
import type { Allocation, AllocationKind, Paise } from '../../engine/types'
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

export function AllocationEditor({ items, onChange }: { items: Allocation[]; onChange: (a: Allocation[]) => void }) {
  const update = (id: string, patch: Partial<Allocation>) => onChange(items.map((a) => (a.id === id ? { ...a, ...patch } : a)))
  return (
    <div className="stack">
      {items.length === 0 && <p className="muted">Nothing here yet. Add rent, EMIs, SIPs, savings… anything you want protected before you spend.</p>}
      {items.map((a) => (
        <div key={a.id} className="row" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: '2 1 160px' }}>
            <label className="lbl" htmlFor={'n' + a.id}>Name</label>
            <input id={'n' + a.id} className="input" value={a.name} onChange={(e) => update(a.id, { name: e.target.value })} />
          </div>
          <div className="field" style={{ flex: '1 1 150px' }}>
            <label className="lbl" htmlFor={'k' + a.id}>Type</label>
            <select id={'k' + a.id} className="input" value={a.kind} onChange={(e) => update(a.id, { kind: e.target.value as AllocationKind })}>
              {(Object.keys(KIND_LABEL) as AllocationKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 120px' }}>
            <label className="lbl" htmlFor={'a' + a.id}>Per cycle ({getCurrency().symbol})</label>
            <MoneyInput id={'a' + a.id} label={`${a.name} amount`} value={a.amountPaise} onChange={(p) => p !== null && update(a.id, { amountPaise: p })} />
          </div>
          <button type="button" className="btn ghost danger" aria-label={`Remove ${a.name}`} onClick={() => onChange(items.filter((x) => x.id !== a.id))}><Icon name="trash" size={18} /></button>
        </div>
      ))}
      <div>
        <button type="button" className="btn" onClick={() => onChange([...items, { id: crypto.randomUUID(), name: '', kind: 'fixed', amountPaise: 0 }])}>
          <Icon name="plus" size={18} /> Add item
        </button>
      </div>
    </div>
  )
}
