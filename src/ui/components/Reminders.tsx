import { useEffect, useRef, useState } from 'react'
import { buildReminders, reminderDays } from '../../engine/reminders'
import { disableReminders, enableReminders, isSubscribed, loadDevice, pushSupported, saveDevice, sendTest, serverConfig, uploadSchedule, type DeviceReminders } from '../../push/client'
import { useStore } from '../../state/store'
import { Alert, Field, useToast } from './common'
import { SectionHead } from './Section'

/** Keeps the server's list of reminder times in step with your bills (dates and counts only). Renders nothing. */
export function ReminderSync() {
  const { active, plan, cycle, data, budget, today } = useStore()
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const paid = budget?.allocationPaid
  useEffect(() => {
    if (!active || !cycle) return
    const dev = loadDevice()
    if (!dev.on || !pushSupported() || Notification.permission !== 'granted') return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const days = reminderDays({ plan, cycle, planned: data.planned, allocationPaid: paid ?? {}, txs: data.transactions, today })
      void uploadSchedule(active.id, buildReminders(days, dev.prefs, Date.now()))
    }, 4000)
    return () => clearTimeout(timer.current)
  }, [active, plan, cycle, data.planned, data.transactions, paid, today])
  return null
}

const HOURS = Array.from({ length: 24 }, (_, h) => h)
const hourText = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? 'am' : 'pm'}`

/** Settings card: turn bill reminders on or off for this phone or computer. */
export function RemindersSettings() {
  const { active, plan, cycle, data, budget, today } = useStore()
  const toast = useToast()
  const [dev, setDev] = useState<DeviceReminders>(() => loadDevice())
  const [subbed, setSubbed] = useState(false)
  const [cfg, setCfg] = useState<{ enabled: boolean } | null | undefined>(undefined)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { void serverConfig().then(setCfg); void isSubscribed().then(setSubbed) }, [])
  if (!active) return null

  const push = (next: DeviceReminders) => {
    saveDevice(next); setDev(next)
    if (next.on && cycle) {
      const days = reminderDays({ plan, cycle, planned: data.planned, allocationPaid: budget?.allocationPaid ?? {}, txs: data.transactions, today })
      void uploadSchedule(active.id, buildReminders(days, next.prefs, Date.now()))
    }
  }
  const turnOn = async () => {
    setBusy(true); setMsg('')
    const r = await enableReminders()
    setBusy(false)
    if (r === 'ok') { setSubbed(true); push({ ...dev, on: true }); toast('Reminders are on') }
    else setMsg({ denied: 'Notifications are blocked for this site. Allow them in your browser or phone settings, then try again.', unsupported: 'This browser cannot receive push reminders. On iPhone, add the app to your Home Screen first (iOS 16.4 or later).', unavailable: 'Reminders are not set up on this site yet.', signin: 'Your sign-in expired. Sign in again under Cloud sync, then retry.', ok: '' }[r])
  }
  const turnOff = async () => {
    setBusy(true)
    await disableReminders(active.id)
    setBusy(false); setSubbed(false); saveDevice({ ...dev, on: false }); setDev({ ...dev, on: false }); toast('Reminders are off')
  }
  const test = async () => {
    const r = await sendTest()
    toast(r === 'sent' ? 'Test sent. It should arrive in a few seconds.' : r === 'none' ? 'Turn reminders on first.' : 'Could not send the test. Check your connection.')
  }

  const on = dev.on && subbed
  return (
    <section className="card stack">
      <SectionHead icon="bell" color="var(--s4)" title="Bill reminders" hint="A phone notification before a bill or EMI is due." />
      {cfg === null || (cfg && !cfg.enabled) ? <Alert kind="info">Reminders are not switched on for this site yet. See docs/PUSH-SETUP.md.</Alert> : !pushSupported()
        ? <Alert kind="info">This browser cannot receive push reminders. On an iPhone, add the app to your Home Screen first (iOS 16.4 or later).</Alert>
        : (
          <>
            <div className="row wrap">
              {on ? <button className="btn" disabled={busy} onClick={turnOff}>Turn off on this device</button> : <button className="btn primary" disabled={busy || cfg === undefined} onClick={turnOn}>Turn on reminders</button>}
              {on && <button className="btn" onClick={test}>Send a test</button>}
            </div>
            {msg && <Alert kind="warn">{msg}</Alert>}
            {on && (
              <div className="stack">
                <label className="check"><input type="checkbox" checked={dev.prefs.dayBefore} onChange={(e) => push({ ...dev, prefs: { ...dev.prefs, dayBefore: e.target.checked } })} /> The day before it is due</label>
                <label className="check"><input type="checkbox" checked={dev.prefs.onDay} onChange={(e) => push({ ...dev, prefs: { ...dev.prefs, onDay: e.target.checked } })} /> On the day it is due (and anything overdue)</label>
                <Field label="Time of day">
                  <select className="input" value={dev.prefs.hour} onChange={(e) => push({ ...dev, prefs: { ...dev.prefs, hour: Number(e.target.value) } })} aria-label="Reminder time">
                    {HOURS.map((h) => <option key={h} value={h}>{hourText(h)}</option>)}
                  </select>
                </Field>
              </div>
            )}
          </>
        )}
      <p className="hint">Private by design: the server only gets the send time and a line like “2 bills due tomorrow”. It never sees bill names or amounts; those appear when you open the app.</p>
    </section>
  )
}
