import { describePay, validatePay } from '../../engine/pay'
import type { ISODate, PayCycle } from '../../engine/types'
import { Field, Seg } from './common'
import { DayPicker } from './DayPicker'

type Key = 'monthly' | 'semimonthly' | 'biweekly' | 'weekly'
const keyOf = (p: PayCycle): Key => (p.kind === 'interval' ? (p.everyDays === 14 ? 'biweekly' : 'weekly') : p.kind)

/** Choose how often you are paid and on which day(s). */
export function PayFields({ pay, onChange, today }: { pay: PayCycle; onChange: (p: PayCycle) => void; today: ISODate }) {
  const set = (k: Key) => {
    if (k === keyOf(pay)) return
    const anchor = pay.kind === 'interval' ? pay.anchor : today
    if (k === 'monthly') onChange({ kind: 'monthly', day: pay.kind === 'monthly' ? pay.day : 25 })
    else if (k === 'semimonthly') onChange({ kind: 'semimonthly', days: pay.kind === 'semimonthly' ? pay.days : [1, 15] })
    else onChange({ kind: 'interval', everyDays: k === 'biweekly' ? 14 : 7, anchor })
  }
  const err = validatePay(pay)
  return (
    <div className="stack">
      <Field label="How often are you paid?">
        <Seg<Key> label="Pay frequency" value={keyOf(pay)} onChange={set}
          options={[['monthly', 'Monthly'], ['semimonthly', 'Twice a month'], ['biweekly', 'Every 2 weeks'], ['weekly', 'Weekly']]} />
      </Field>
      {pay.kind === 'monthly' && (
        <Field label="Pay day of the month" error={err} hint="Day 29–31 uses the last day of shorter months.">
          <DayPicker label="Pay day of the month" value={pay.day} onChange={(d) => d && onChange({ kind: 'monthly', day: d })} />
        </Field>
      )}
      {pay.kind === 'semimonthly' && (
        <Field label="Pay days of the month" error={err} hint="For example 1 and 15, or 15 and 31 (the last day).">
          <div className="row">
            <div style={{ flex: '1 1 150px' }}><DayPicker label="First pay day" value={pay.days[0]} onChange={(d) => d && onChange({ kind: 'semimonthly', days: [d, pay.days[1]] })} /></div>
            <span>and</span>
            <div style={{ flex: '1 1 150px' }}><DayPicker label="Second pay day" value={pay.days[1]} onChange={(d) => d && onChange({ kind: 'semimonthly', days: [pay.days[0], d] })} /></div>
          </div>
        </Field>
      )}
      {pay.kind === 'interval' && (
        <Field label="A recent payday (or your next one)" error={err} hint="The app counts every 2 weeks (or week) from this date.">
          <input className="input" type="date" value={pay.anchor} onChange={(e) => onChange({ ...pay, anchor: e.target.value })} />
        </Field>
      )}
      <p className="hint">Paid {describePay(pay)}. Each pay period is one budget cycle.</p>
    </div>
  )
}
