import { useState } from 'react'
import { Modal } from './common'

export const ordinal = (n: number): string => {
  const v = n % 100
  if (v >= 11 && v <= 13) return `${n}th`
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`
}

/**
 * Pick a day of the month from a small calendar of 1–31 (a recurring day, not a date).
 * Days 29–31 mean "the last day" in shorter months.
 */
export function DayPicker({ value, onChange, label, optional = false, emptyText = 'Any day' }: {
  value: number | undefined
  onChange: (d: number | undefined) => void
  label: string
  optional?: boolean
  emptyText?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="input daybtn" aria-label={`${label}: ${value ? ordinal(value) + ' of every month' : emptyText}. Change`} onClick={() => setOpen(true)}>
        <span>{value ? `${ordinal(value)} of the month` : emptyText}</span>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
      </button>
      {open && (
        <Modal title={label} onClose={() => setOpen(false)}>
          <div className="stack">
            <p className="hint">Pick the day of the month. It repeats every month; 29, 30 and 31 use the last day in shorter months.</p>
            <div className="daygrid" role="group" aria-label="Day of the month">
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <button key={d} type="button" aria-pressed={value === d} onClick={() => { onChange(d); setOpen(false) }}>{d}</button>
              ))}
            </div>
            {optional && <button type="button" className="btn" onClick={() => { onChange(undefined); setOpen(false) }}>{emptyText}</button>}
          </div>
        </Modal>
      )}
    </>
  )
}
