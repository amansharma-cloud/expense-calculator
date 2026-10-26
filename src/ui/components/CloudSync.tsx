import { useEffect, useState } from 'react'
import { WrongPinError } from '../../db/storage'
import type { RemoteProfile } from '../../sync/types'
import { useStore } from '../../state/store'
import { Alert, Confirm, Field, Modal, useToast } from './common'
import { SectionHead } from './Section'
import type { SnapshotInfo } from '../../sync/types'

type Check = { available: boolean; needsLogin?: boolean; email?: string } | null

const STATUS: Record<string, string> = {
  idle: 'Up to date',
  syncing: 'Syncing…',
  offline: 'Offline: will sync when you are back online',
  'needs-login': 'Sign-in expired',
  unavailable: 'Sync is not available right now',
  error: 'Last sync failed',
  off: 'Off',
}

/** Settings section: sign in, turn sync on/off for the open profile. */
export function SyncSettings() {
  const { active, sync, cloudCheck, enableSync, disableSync, syncNow, signIn, restorePoints, restoreFromPoint } = useStore()
  const toast = useToast()
  const [check, setCheck] = useState<Check>(null)
  const [dlg, setDlg] = useState<'on' | 'off' | 'points' | null>(null)
  const [points, setPoints] = useState<SnapshotInfo[] | null>(null)
  const [pickDay, setPickDay] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { void cloudCheck().then(setCheck) }, [cloudCheck, sync.status === 'needs-login'])
  if (!active) return null
  const enabled = !!active.sync?.enabled

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true); setErr('')
    try { await fn(); toast(ok) } catch (e) { setErr(e instanceof Error ? e.message : 'Something went wrong') } finally { setBusy(false); setDlg(null) }
  }

  return (
    <section className="card stack">
      <SectionHead icon="swap" color="var(--accent-2)" title="Account &amp; cloud sync" hint="Optional encrypted copy so your data follows you to other devices." />
      {check === null && <p className="muted">Checking…</p>}
      {check && !check.available && !enabled && (
        <p className="ink2">Cloud sync is not set up on this site. Everything keeps working locally on this device. (Site owners: see <code>docs/SYNC-SETUP.md</code>.)</p>
      )}
      {check?.needsLogin && (
        <div className="stack">
          <p className="ink2">Sign in with your invited email to keep an <b>encrypted</b> copy of a profile in the cloud and use it on other devices.</p>
          <div><button className="btn primary" onClick={signIn}>Sign in</button></div>
        </div>
      )}
      {check?.email && (
        <p className="ink2">Signed in as <b>{check.email}</b>.</p>
      )}
      {check?.available && !check.needsLogin && !enabled && (
        <div className="stack">
          {!active.locked
            ? <Alert kind="info">Cloud sync needs a PIN, because your data is encrypted on this device before it is uploaded. Set a PIN in “PIN &amp; privacy” above first.</Alert>
            : <button className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={() => setDlg('on')}>Turn on sync for “{active.name}”</button>}
        </div>
      )}
      {enabled && (
        <div className="stack">
          <div className="row">
            <span className={`chip ${sync.status === 'idle' ? 'good' : sync.status === 'error' || sync.status === 'needs-login' ? 'bad' : ''}`}>{STATUS[sync.status] ?? sync.status}</span>
            {active.sync?.lastSyncAt && <span className="muted small">Last sync {new Date(active.sync.lastSyncAt).toLocaleString()}</span>}
          </div>
          {sync.error && <Alert kind="bad">{sync.error}</Alert>}
          {sync.status === 'needs-login' && <Alert kind="warn">Your sign-in has expired, so changes are waiting on this device. <button className="btn sm" onClick={signIn}>Sign in again</button></Alert>}
          <div className="row">
            <button className="btn" disabled={busy || sync.status === 'syncing'} onClick={() => void syncNow()}>Sync now</button>
            <button className="btn" onClick={() => { setPoints(null); setErr(''); setDlg('points'); void restorePoints().then(setPoints).catch(() => { setPoints([]); setErr('Could not load restore points.') }) }}>Restore points…</button>
            <button className="btn danger" onClick={() => setDlg('off')}>Turn off sync…</button>
          </div>
        </div>
      )}
      {err && <Alert kind="bad">{err}</Alert>}
      <ul className="hint" style={{ margin: 0, paddingLeft: 18 }}>
        <li>Only the encrypted copy is uploaded. Without your PIN, nobody (including the site owner) can read it. A forgotten PIN also locks the cloud copy.</li>
        <li>The server can see your email, how many records there are, and when they changed.</li>
        <li>While sync is on, the cloud keeps one encrypted restore point per day for 14 days, so a mistake (which syncs to all your devices) can be undone.</li>
        <li>While sync is on, the PIN can’t be changed; turn sync off first.</li>
      </ul>

      {dlg === 'on' && (
        <Confirm title="Turn on cloud sync?" confirmLabel="Turn on"
          body={<>An encrypted copy of “{active.name}” will be uploaded to your account and kept in step across devices. You can turn this off at any time and delete the cloud copy.</>}
          onCancel={() => setDlg(null)} onConfirm={() => void run(enableSync, 'Sync is on')} />
      )}
      {dlg === 'points' && (
        <Modal title="Restore points" onClose={() => setDlg(null)}>
          <div className="stack">
            <p className="ink2">Each point is the state of “{active.name}” at the start of that day (UTC). Restoring rewinds this profile on <b>all your devices</b>; anything added since is removed. Download a backup first if unsure.</p>
            {points === null && <p className="muted">Loading…</p>}
            {points?.length === 0 && <p className="muted">No restore points yet. The first one is created the first time you sync on a new day.</p>}
            <ul className="list">
              {points?.map((p) => (
                <li key={p.day}>
                  <div className="grow"><div className="title">{new Date(p.day + 'T00:00:00Z').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}</div><div className="small muted">{p.rows} records</div></div>
                  <button className="btn sm" onClick={() => setPickDay(p.day)}>Restore</button>
                </li>
              ))}
            </ul>
            {err && <Alert kind="bad">{err}</Alert>}
          </div>
        </Modal>
      )}
      {pickDay && (
        <Confirm title="Restore this point?" confirmLabel="Restore"
          body={<>“{active.name}” will be rewound to {pickDay} on every device. Newer records will be removed.</>}
          onCancel={() => setPickDay(null)}
          onConfirm={() => { const d = pickDay; setPickDay(null); void run(() => restoreFromPoint(d), 'Restored'); }} />
      )}
      {dlg === 'off' && (
        <Modal title="Turn off sync" onClose={() => setDlg(null)}>
          <div className="stack">
            <p className="ink2">This device keeps its data either way. Choose what happens to the copy in the cloud.</p>
            <button className="btn" disabled={busy} onClick={() => void run(() => disableSync(false), 'Sync is off')}>Turn off, keep the cloud copy</button>
            <button className="btn danger" disabled={busy} onClick={() => void run(() => disableSync(true), 'Sync is off and the cloud copy was deleted')}>Turn off and delete the cloud copy</button>
          </div>
        </Modal>
      )}
    </section>
  )
}

/** Picker screen: bring a profile from the cloud onto this device. */
export function CloudRestore({ onClose }: { onClose: () => void }) {
  const { cloudCheck, cloudProfiles, restoreFromCloud, signIn, profiles } = useStore()
  const [check, setCheck] = useState<Check>(null)
  const [list, setList] = useState<RemoteProfile[] | null>(null)
  const [pick, setPick] = useState<RemoteProfile | null>(null)
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => {
    void (async () => {
      const c = await cloudCheck()
      setCheck(c)
      if (c.available && !c.needsLogin) {
        try { setList(await cloudProfiles()) } catch { setErr('Could not load your cloud profiles.') }
      }
    })()
  }, [cloudCheck, cloudProfiles])

  const local = new Set(profiles.map((p) => p.id))
  return (
    <Modal title="Restore from the cloud" onClose={onClose}>
      <div className="stack">
        {check === null && <p className="muted">Checking…</p>}
        {check && !check.available && <Alert kind="info">Cloud sync is not set up on this site.</Alert>}
        {check?.needsLogin && (<><p className="ink2">Sign in with your invited email to see your cloud profiles.</p><button className="btn primary" onClick={signIn}>Sign in</button></>)}
        {check?.email && <p className="ink2">Signed in as <b>{check.email}</b>.</p>}
        {list && list.length === 0 && <p className="muted">You have no profiles in the cloud yet. Turn on sync from Settings on the device that has your data.</p>}
        {list && !pick && list.map((p) => (
          <button key={p.id} className="profile-btn" disabled={local.has(p.id)} onClick={() => { setPick(p); setErr('') }}>
            <span className="avatar">{p.name[0]?.toUpperCase()}</span>
            <span style={{ flex: 1 }}><b>{p.name}</b><div className="small muted">{local.has(p.id) ? 'Already on this device' : `${p.rows} records · updated ${new Date(p.updated).toLocaleDateString()}`}</div></span>
          </button>
        ))}
        {pick && (
          <form className="stack" onSubmit={async (e) => {
            e.preventDefault()
            try { await restoreFromCloud(pick, pin) } catch (x) { setErr(x instanceof WrongPinError ? 'Wrong PIN for this profile.' : x instanceof Error ? x.message : 'Could not restore') }
          }}>
            <Field label={`PIN for “${pick.name}”`} error={err}><input className="input" type="password" autoFocus autoComplete="off" value={pin} onChange={(e) => { setPin(e.target.value); setErr('') }} /></Field>
            <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn" onClick={() => setPick(null)}>Back</button><button className="btn primary">Restore</button></div>
          </form>
        )}
        {!pick && err && <Alert kind="bad">{err}</Alert>}
      </div>
    </Modal>
  )
}
