import { CURRENCIES, getCurrency, setActiveCurrency } from '../../engine/currency'
import { useRef, useState } from 'react'
import { parseBackup } from '../../db/backup'
import { createProfile, openProfile, WrongPinError } from '../../db/storage'
import { cycleBounds, cycleLabel } from '../../engine/dates'
import { formatMoney } from '../../engine/money'
import type { Allocation, Paise } from '../../engine/types'
import { defaultPlan, useStore } from '../../state/store'
import { AllocationEditor, MoneyInput } from '../components/AllocationEditor'
import { Alert, Field, Icon } from '../components/common'
import { CloudRestore } from '../components/CloudSync'
import { ImportWizard } from '../components/ImportWizard'

const initial = (n: string) => (n.trim()[0] ?? '?').toUpperCase()

export function ProfilePicker() {
  const { profiles, selectProfile, addProfile, locked } = useStore()
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [pinOn, setPinOn] = useState(false)
  const [err, setErr] = useState('')
  const [unlockPin, setUnlockPin] = useState('')
  const [adding, setAdding] = useState(profiles.length === 0)
  const [cloud, setCloud] = useState(false)
  const file = useRef<HTMLInputElement>(null)

  if (locked) {
    return (
      <div className="gate"><form className="card stack" onSubmit={async (e) => {
        e.preventDefault()
        try { await selectProfile(locked.id, unlockPin); setUnlockPin('') } catch (x) { setErr(x instanceof WrongPinError ? 'Wrong PIN. Try again.' : 'Could not open this profile.') }
      }}>
        <div className="row"><span className="avatar"><Icon name="lock" size={16} /></span><h1>{locked.name}</h1></div>
        <p className="ink2">This profile is protected with a PIN. Its data is encrypted on this device.</p>
        <Field label="PIN" error={err}>
          <input className="input" type="password" inputMode="numeric" autoFocus autoComplete="off" value={unlockPin} onChange={(e) => { setUnlockPin(e.target.value); setErr('') }} />
        </Field>
        <button className="btn primary">Unlock</button>
        <button type="button" className="btn ghost" onClick={() => window.location.reload()}>Choose another profile</button>
        <p className="hint">Forgot the PIN? It cannot be recovered. Restore from a backup file into a new profile instead.</p>
      </form></div>
    )
  }

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setErr('Enter a name')
    if (pinOn && pin.length < 4) return setErr('Use at least 4 characters for the PIN')
    try { await addProfile(name, pinOn ? pin : undefined) } catch { setErr('Could not create the profile') }
  }

  const restore = async (f?: File) => {
    if (!f) return
    try {
      const { profileName, data } = parseBackup(await f.text())
      const meta = await createProfile(profileName)
      const s = await openProfile(meta)
      if (data.plan) await s.put('plan', 'plan', data.plan)
      await s.putMany('cycles', data.cycles.map((c) => ({ id: c.start, value: c })))
      await s.putMany('transactions', data.transactions.map((t) => ({ id: t.id, value: t })))
      await s.putMany('planned', data.planned.map((p) => ({ id: p.id, value: p })))
      s.close()
      await selectProfile(meta.id)
    } catch (x) { setErr(x instanceof Error ? x.message : 'Could not restore this file') }
  }

  return (
    <div className="gate">
      <div className="card stack">
        <div className="row"><img src="./favicon.svg" width="36" height="36" alt="" /><h1>Daily Spend</h1></div>
        <p className="ink2">Know what you can safely spend today. Everything stays on this device. Each person gets their own private profile.</p>
        {profiles.length > 0 && (
          <div className="stack" role="list" aria-label="Profiles">
            {profiles.map((p) => (
              <button key={p.id} className="profile-btn" role="listitem" onClick={() => selectProfile(p.id)}>
                <span className="avatar">{initial(p.name)}</span>
                <span style={{ flex: 1 }}><b>{p.name}</b></span>
                {p.locked && <span className="chip"><Icon name="lock" size={14} /> PIN</span>}
              </button>
            ))}
          </div>
        )}
        {!adding && <button className="btn" onClick={() => setAdding(true)}><Icon name="plus" size={18} /> New profile</button>}
        {adding && (
          <form className="stack" onSubmit={create}>
            <Field label="Who is this profile for?" error={err}>
              <input className="input" value={name} onChange={(e) => { setName(e.target.value); setErr('') }} placeholder="e.g. Aman" autoFocus={profiles.length === 0} />
            </Field>
            <label className="row"><input type="checkbox" checked={pinOn} onChange={(e) => setPinOn(e.target.checked)} /> Protect with a PIN (encrypts this profile’s data)</label>
            {pinOn && (
              <Field label="PIN" hint="At least 4 characters. If you forget it, the data can only be recovered from a backup file.">
                <input className="input" type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="new-password" />
              </Field>
            )}
            <button className="btn primary">Create profile</button>
          </form>
        )}
        <input ref={file} hidden type="file" accept=".json,application/json" onChange={(e) => restore(e.target.files?.[0])} />
        <button className="btn ghost" onClick={() => file.current?.click()}><Icon name="upload" size={18} /> Restore from a backup file</button>
        <button className="btn ghost" onClick={() => setCloud(true)}><Icon name="swap" size={18} /> Restore from the cloud (invited accounts)</button>
        {cloud && <CloudRestore onClose={() => setCloud(false)} />}
        <p className="hint">Profiles separate people’s records on this device. Without a PIN they are not private from someone using the same browser.</p>
      </div>
    </div>
  )
}

/** First-run setup for an empty profile: salary, salary day, commitments — or import the old Excel tracker. */
export function Setup() {
  const { plan, startCycle, active, today } = useStore()
  const [step, setStep] = useState(0)
  const [mode, setMode] = useState<'manual' | 'excel'>('manual')
  const [salary, setSalary] = useState<Paise>(0)
  const [day, setDay] = useState(25)
  const [items, setItems] = useState<Allocation[]>([])
  const [carry, setCarry] = useState<Paise>(0)
  const [err, setErr] = useState('')
  const [cur, setCur] = useState<string>(getCurrency().code)
  setActiveCurrency(cur) // labels on this screen follow the chosen currency

  const total = items.reduce((s, a) => s + a.amountPaise, 0)
  const next = () => {
    if (step === 0 && (salary <= 0 || day < 1 || day > 31)) return setErr('Enter your monthly take-home salary and the day it is credited (1–31).')
    if (step === 1 && items.some((a) => !a.name.trim())) return setErr('Give every item a name, or remove it.')
    setErr('')
    setStep(step + 1)
  }
  const finish = async () => {
    const clean = items.filter((a) => a.amountPaise > 0 && a.name.trim())
    const next = { ...defaultPlan(), ...plan, currency: cur, salaryDay: day, takeHomePaise: salary, allocations: clean }
    await startCycle({ takeHomePaise: salary, extraCreditsPaise: 0, openingCarryPaise: carry, releasedCarryPaise: 0 }, next)
  }
  const bounds = cycleBounds(today, day)

  if (mode === 'excel') {
    return (
      <div className="gate"><div className="card stack" style={{ maxWidth: 760 }}>
        <h1>Import your Excel tracker</h1>
        <ImportWizard />
        <button className="btn ghost" onClick={() => setMode('manual')}>← Set up by hand instead</button>
      </div></div>
    )
  }
  return (
    <div className="gate"><div className="card stack" style={{ maxWidth: 640 }}>
      <div className="steps" aria-hidden="true">{[0, 1, 2].map((i) => <i key={i} className={i <= step ? 'on' : ''} />)}</div>
      <h1>Welcome{active ? `, ${active.name}` : ''}</h1>
      {step === 0 && (
        <>
          <p className="ink2">Two numbers get you started.</p>
          <Field label="Currency" hint="Used for every amount in this profile. You can change it later (it relabels amounts; it does not convert them).">
            <select className="input" value={cur} onChange={(e) => setCur(e.target.value)}>
              {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name} ({c.symbol.trim()})</option>)}
            </select>
          </Field>
          <Field label={`Monthly take-home salary (${getCurrency().symbol})`}><MoneyInput label="Monthly take-home salary" value={salary} onChange={(p) => setSalary(p ?? 0)} /></Field>
          <Field label="Salary credit day of the month" hint="Your cycle runs from one salary day to the day before the next. Days like 31 use the last day of shorter months.">
            <input className="input num" type="number" min={1} max={31} value={day} onChange={(e) => setDay(Number(e.target.value))} />
          </Field>
          <Field label={`Money already in your account / carry-over (${getCurrency().symbol}, optional)`} hint="Stays as a reserve. It is not added to your daily limit unless you release part of it later.">
            <MoneyInput label="Carry-over" value={carry} onChange={(p) => setCarry(p ?? 0)} />
          </Field>
          <button className="btn" onClick={() => setMode('excel')}><Icon name="upload" size={18} /> I have an Excel tracker – import it instead</button>
        </>
      )}
      {step === 1 && (
        <>
          <p className="ink2">What is already spoken for each month? These are set aside first and never offered as daily spending.</p>
          <AllocationEditor items={items} onChange={setItems} />
        </>
      )}
      {step === 2 && (
        <>
          <p className="ink2">Here is your first cycle: <b>{cycleLabel(bounds.start, bounds.end)}</b>.</p>
          <div className="card" style={{ background: 'var(--surface-2)' }}>
            <div className="row between"><span>Take-home salary</span><b className="num">{formatMoney(salary)}</b></div>
            <div className="row between"><span>Set aside (bills, investments, savings)</span><b className="num">−{formatMoney(total)}</b></div>
            <div className="row between"><span>Spendable</span><b className="num">{formatMoney(salary - total)}</b></div>
          </div>
          {salary - total <= 0 && <Alert kind="bad">Your commitments are at least as large as your salary, so there is nothing left to spend. Go back and check the amounts.</Alert>}
        </>
      )}
      {err && <Alert kind="bad">{err}</Alert>}
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button className="btn ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</button>
        {step < 2 ? <button className="btn primary" onClick={next}>Continue</button> : <button className="btn primary" onClick={finish}>Start tracking</button>}
      </div>
    </div></div>
  )
}

/** Shown when no cycle covers today (e.g. salary day just passed, or after importing history). */
export function NewCycle() {
  const { plan, today, suggestedOpeningCarry, startCycle, data } = useStore()
  const { start, end } = cycleBounds(today, plan.salaryDay)
  const [salary, setSalary] = useState<Paise>(plan.takeHomePaise)
  const [extra, setExtra] = useState<Paise>(0)
  const [carry, setCarry] = useState<Paise>(suggestedOpeningCarry)
  const [release, setRelease] = useState<Paise>(plan.releasedCarryPaise)
  const spendable = salary + extra + Math.min(release, carry) - plan.allocations.reduce((s, a) => s + a.amountPaise, 0)
  const prev = data.cycles.filter((c) => c.end <= start).sort((a, b) => b.start.localeCompare(a.start))[0]

  return (
    <div className="gate"><div className="card stack" style={{ maxWidth: 640 }}>
      <h1>Start your new salary cycle</h1>
      <p className="ink2"><b>{cycleLabel(start, end)}</b></p>
      {prev && <Alert kind="info">Last cycle ({prev.label ?? cycleLabel(prev.start, prev.end)}) closed with <b className="num">{formatMoney(suggestedOpeningCarry, { decimals: true })}</b>. It is filled in as the carry-over; change it if your bank balance differs.</Alert>}
      <div className="form-grid two">
        <Field label={`Salary credited (${getCurrency().symbol})`}><MoneyInput label="Salary credited" value={salary} onChange={(p) => setSalary(p ?? 0)} /></Field>
        <Field label={`Other credits (${getCurrency().symbol})`} hint="Interest, refunds, payouts…"><MoneyInput label="Other credits" value={extra} onChange={(p) => setExtra(p ?? 0)} /></Field>
        <Field label={`Carry-over from last cycle (${getCurrency().symbol})`}><MoneyInput label="Carry-over" value={carry} onChange={(p) => setCarry(p ?? 0)} /></Field>
        <Field label={`Release from carry-over for spending (${getCurrency().symbol})`} hint="Only this amount is added to your daily limit. The rest stays a reserve."><MoneyInput label="Release from carry-over" value={release} onChange={(p) => setRelease(p ?? 0)} /></Field>
      </div>
      <div className="card" style={{ background: 'var(--surface-2)' }}>
        <div className="row between"><span>Spendable this cycle</span><b className="num">{formatMoney(spendable)}</b></div>
        <div className="row between"><span>Roughly per day</span><b className="num">{formatMoney(Math.max(0, Math.floor(spendable / Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / 86400000)))))}</b></div>
      </div>
      <button className="btn primary" onClick={() => startCycle({ takeHomePaise: salary, extraCreditsPaise: extra, openingCarryPaise: carry, releasedCarryPaise: release })}>Start cycle</button>
    </div></div>
  )
}
