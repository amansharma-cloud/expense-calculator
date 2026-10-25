import { useState } from 'react'
import { makeBackup, parseBackup } from '../../db/backup'
import { useStore } from '../../state/store'
import { Alert, Confirm, download, Field, Icon, Modal, Seg, useToast } from '../components/common'
import { ImportWizard } from '../components/ImportWizard'

export function Settings() {
  const { active, profiles, plan, savePlan, renameActive, setPin, lock, switchAway, removeProfile, wipe, replaceAll, exportData } = useStore()
  const toast = useToast()
  const [name, setName] = useState(active?.name ?? '')
  const [pinModal, setPinModal] = useState<'set' | 'remove' | null>(null)
  const [pin, setPinText] = useState('')
  const [dlg, setDlg] = useState<'delete' | 'reset' | 'restore' | null>(null)
  const [restoreText, setRestoreText] = useState<string | null>(null)
  const [restoreErr, setRestoreErr] = useState('')
  const [importing, setImporting] = useState(false)
  const [typed, setTyped] = useState('')
  if (!active) return null

  const backup = () => {
    const stamp = new Date().toISOString().slice(0, 10)
    download(`backup-${active.name.replace(/\W+/g, '-').toLowerCase()}-${stamp}.json`, makeBackup(active.name, exportData()), 'application/json')
    toast('Backup downloaded')
  }
  const onRestoreFile = async (f?: File) => {
    setRestoreErr('')
    if (!f) return
    try { parseBackup(await f.text()); setRestoreText(await f.text()); setDlg('restore') } catch (e) { setRestoreErr(e instanceof Error ? e.message : 'Invalid file') }
  }

  return (
    <div className="stack">
      <div className="page-head"><h1>Settings &amp; Profiles</h1></div>

      <section className="card stack">
        <h2>Profile</h2>
        <form className="row" onSubmit={async (e) => { e.preventDefault(); await renameActive(name); toast('Renamed') }}>
          <input className="input" style={{ flex: 1, minWidth: 160 }} aria-label="Profile name" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn" disabled={!name.trim() || name === active.name}>Rename</button>
        </form>
        <div className="row">
          <button className="btn" onClick={switchAway}><Icon name="swap" size={18} /> Switch profile</button>
          {active.locked && <button className="btn" onClick={lock}><Icon name="lock" size={18} /> Lock now</button>}
        </div>
        <p className="hint">{profiles.length} profile{profiles.length === 1 ? '' : 's'} on this device. Each has its own salary, budget, categories and transactions; they are never mixed.</p>
      </section>

      <section className="card stack">
        <h2>PIN &amp; privacy</h2>
        {active.locked
          ? <Alert kind="good">This profile is encrypted with your PIN (AES-256-GCM). It locks after 5 minutes in the background.</Alert>
          : <Alert kind="warn">No PIN: this profile is <b>not</b> encrypted. Anyone using this browser on this device can open it from the profile list.</Alert>}
        <div className="row">
          <button className="btn" onClick={() => { setPinText(''); setPinModal('set') }}>{active.locked ? 'Change PIN' : 'Set a PIN'}</button>
          {active.locked && <button className="btn" onClick={() => setPinModal('remove')}>Remove PIN</button>}
        </div>
        <p className="hint">A forgotten PIN cannot be recovered; only a backup file can restore the data. Backup files are <b>not</b> encrypted, so store them privately.</p>
      </section>

      <section className="card stack">
        <h2>Appearance</h2>
        <Seg label="Theme" value={plan.theme} onChange={(theme) => { void savePlan({ ...plan, theme }) }} options={[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]} />
      </section>

      <section className="card stack">
        <h2>Backup &amp; restore</h2>
        <p className="ink2">Your data lives only in this browser. Clearing site data, uninstalling the browser, or a private/incognito window can erase it. <b>Download a backup regularly</b> and keep it somewhere safe.</p>
        <div className="row">
          <button className="btn primary" onClick={backup}><Icon name="download" size={18} /> Download backup</button>
          <label className="btn" style={{ cursor: 'pointer' }}><Icon name="upload" size={18} /> Restore from file
            <input hidden type="file" accept=".json,application/json" onChange={(e) => { void onRestoreFile(e.target.files?.[0]); e.target.value = '' }} />
          </label>
        </div>
        {restoreErr && <Alert kind="bad">{restoreErr}</Alert>}
        <p className="hint">Restoring replaces everything in this profile. To keep this profile, restore into a new one from the profile picker instead.</p>
      </section>

      <section className="card stack">
        <h2>Import from Excel</h2>
        {!importing ? <button className="btn" onClick={() => setImporting(true)}><Icon name="upload" size={18} /> Import old tracker (.xlsx)</button> : <ImportWizard onDone={() => setImporting(false)} />}
      </section>

      <section className="card stack">
        <h2>About your data</h2>
        <ul className="ink2" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Everything is stored in this browser (IndexedDB) on this device. Nothing is sent to any server; there is no account, analytics or tracking.</li>
          <li>The app works offline once loaded (after installing it as an app, or after its first load). It cannot sync between devices.</li>
          <li>Profiles keep family members’ records separate. Without a PIN that is organisation, not privacy.</li>
          <li>It cannot read bank accounts, UPI apps, SMS or notifications; add expenses by hand, quick entry, or file import.</li>
        </ul>
      </section>

      <section className="card stack">
        <h2>Danger zone</h2>
        <div className="row">
          <button className="btn danger" onClick={() => { setTyped(''); setDlg('reset') }}>Erase this profile’s data</button>
          <button className="btn danger" onClick={() => { setTyped(''); setDlg('delete') }}>Delete this profile</button>
        </div>
      </section>

      {pinModal && (
        <Modal title={pinModal === 'set' ? (active.locked ? 'Change PIN' : 'Set a PIN') : 'Remove PIN'} onClose={() => setPinModal(null)}>
          <form className="stack" onSubmit={async (e) => {
            e.preventDefault()
            if (pinModal === 'set') { if (pin.length < 4) return; await setPin(pin); toast('PIN set; data encrypted') }
            else { await setPin(null); toast('PIN removed; data is no longer encrypted') }
            setPinModal(null)
          }}>
            {pinModal === 'set' ? (
              <Field label="New PIN" hint="At least 4 characters. Write it down somewhere safe: it cannot be recovered."><input className="input" type="password" autoComplete="new-password" value={pin} onChange={(e) => setPinText(e.target.value)} /></Field>
            ) : <p className="ink2">The profile will be stored unencrypted again.</p>}
            <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn" onClick={() => setPinModal(null)}>Cancel</button><button className="btn primary" disabled={pinModal === 'set' && pin.length < 4}>Confirm</button></div>
          </form>
        </Modal>
      )}
      {dlg === 'restore' && restoreText && (
        <Confirm title="Replace this profile’s data?" confirmLabel="Restore" body="Everything currently in this profile will be replaced with the contents of the backup file."
          onCancel={() => setDlg(null)} onConfirm={async () => { await replaceAll(parseBackup(restoreText).data); setDlg(null); setRestoreText(null); toast('Backup restored') }} />
      )}
      {(dlg === 'reset' || dlg === 'delete') && (
        <Modal title={dlg === 'reset' ? 'Erase all data in this profile?' : `Delete profile “${active.name}”?`} onClose={() => setDlg(null)}>
          <div className="stack">
            <p className="ink2">{dlg === 'reset' ? 'All transactions, cycles and settings in this profile will be permanently erased. The profile itself stays.' : 'The profile and everything in it will be permanently erased from this device.'} Download a backup first if you might need it.</p>
            <Field label={`Type “${active.name}” to confirm`}><input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} /></Field>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setDlg(null)}>Cancel</button>
              <button className="btn danger solid" disabled={typed.trim() !== active.name} onClick={async () => {
                if (dlg === 'reset') { await wipe(); toast('Profile erased') } else { await removeProfile(active.id) }
                setDlg(null)
              }}>{dlg === 'reset' ? 'Erase everything' : 'Delete profile'}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
