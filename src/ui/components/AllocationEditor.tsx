import { getCurrency } from '../../engine/currency'
import { useEffect, useState } from 'react'
import { parseAmount } from '../../engine/money'
import type { Allocation, AllocationKind, ExpectedBill, Paise } from '../../engine/types'
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

export function AllocationEditor({ items, onChange, showDue = false, onConvert }: {
  items: Allocation[]; onChange: (a: Allocation[]) => void; showDue?: boolean
  /** When given, fixed items get buttons to move them to expected bills / spending (only for saved items). */
  onConvert?: (a: Allocation, to: 'spending' | 'expected') => void
}) {
  const update = (id: string, patch: Partial<Allocation>) => onChange(items.map((a) => (a.id === id ? { ...a, ...patch } : a)))
  return (
    <div className="stack">
      {items.length === 0 && <p className="muted">Nothing here yet. Add rent, EMIs, SIPs, savings… anything you want protected before you spend.{showDue ? ' Give monthly bills a due day so they are set aside only in the pay period that contains it.' : ''}</p>}
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
            <label className="lbl" htmlFor={'a' + a.id}>{showDue ? 'Amount' : 'Per cycle'} ({getCurrency().symbol})</label>
            <MoneyInput id={'a' + a.id} label={`${a.name} amount`} value={a.amountPaise} onChange={(p) => p !== null && update(a.id, { amountPaise: p })} />
          </div>
          {showDue && (
            <div className="field" style={{ flex: '0 1 110px' }}>
              <label className="lbl" htmlFor={'d' + a.id}>Due day</label>
              <input id={'d' + a.id} className="input num" inputMode="numeric" placeholder="every cycle" value={a.dueDay ?? ''}
                onChange={(e) => { const n = Number(e.target.value.replace(/\D/g, '').slice(0, 2)); update(a.id, { dueDay: n >= 1 && n <= 31 ? n : undefined }) }} />
            </div>
          )}
          {onConvert && a.kind === 'fixed' && a.name.trim() && (
            <div className="row" style={{ gap: 4 }}>
              <button type="button" className="btn sm" title="The amount changes every month (electricity, recharge…): reserve an estimate until you pay it" onClick={() => onConvert(a, 'expected')}>Varies monthly</button>
              <button type="button" className="btn ghost sm" title="Treat it as ordinary spending" onClick={() => onConvert(a, 'spending')}>Treat as spending</button>
            </div>
          )}
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

/** Bills that come every cycle with a changing amount. The estimate is reserved until you pay the real amount. */
export function ExpectedBillsEditor({ items, onChange }: { items: ExpectedBill[]; onChange: (b: ExpectedBill[]) => void }) {
  const update = (id: string, patch: Partial<ExpectedBill>) => onChange(items.map((b) => (b.id === id ? { ...b, ...patch } : b)))
  return (
    <div className="stack">
      {items.length === 0 && <p className="muted">None yet. Add bills like electricity or mobile recharge: you enter the real amount when you pay.</p>}
      {items.map((b) => (
        <div key={b.id} className="row" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: '2 1 160px' }}>
            <label className="lbl" htmlFor={'bn' + b.id}>Bill</label>
            <input id={'bn' + b.id} className="input" value={b.name} onChange={(e) => update(b.id, { name: e.target.value, category: b.category === b.name || !b.category ? e.target.value : b.category })} />
          </div>
          <div className="field" style={{ flex: '1 1 130px' }}>
            <label className="lbl" htmlFor={'be' + b.id}>Usual amount ({getCurrency().symbol})</label>
            <MoneyInput id={'be' + b.id} label={`${b.name} usual amount`} value={b.estimatePaise} onChange={(p) => p !== null && update(b.id, { estimatePaise: p })} />
          </div>
          <div className="field" style={{ flex: '0 1 110px' }}>
            <label className="lbl" htmlFor={'bd' + b.id}>Due day</label>
            <input id={'bd' + b.id} className="input num" inputMode="numeric" placeholder="any" value={b.dueDay ?? ''}
              onChange={(e) => { const n = Number(e.target.value.replace(/\D/g, '').slice(0, 2)); update(b.id, { dueDay: n >= 1 && n <= 31 ? n : undefined }) }} />
          </div>
          <button type="button" className="btn ghost danger" aria-label={`Remove ${b.name}`} onClick={() => onChange(items.filter((x) => x.id !== b.id))}><Icon name="trash" size={18} /></button>
        </div>
      ))}
      <div>
        <button type="button" className="btn" onClick={() => onChange([...items, { id: crypto.randomUUID(), name: '', estimatePaise: 0, category: '' }])}><Icon name="plus" size={18} /> Add expected bill</button>
      </div>
    </div>
  )
}
