import { useCallback, useEffect, useRef, useState } from 'react'
import { backupFileName, backupStatus, makeBackup } from '../../db/backup'
import { backupFolderName, chooseBackupFolder, clearBackupFolder, folderBackupSupported, writeBackupToFolder } from '../../db/autobackup'
import { DB_SCHEMA_VERSION, requestPersistence, storageStatus } from '../../db/storage'
import { useStore } from '../../state/store'
import { Alert, download, Icon, useToast } from './common'

const mb = (n: number | null) => (n === null ? '–' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

/** Dashboard nudge when there is data worth losing and no recent backup. */
export function BackupReminder() {
  const { data, active } = useStore()
  const { due, daysSince, synced } = backupStatus(active, new Date(), data.transactions.length > 0)
  if (!due || !active) return null
  return (
    <Alert kind="info">
      {daysSince === null ? 'You have not backed up this profile yet.' : `Your last backup was ${daysSince} days ago.`}{' '}
      {synced ? 'Your cloud copy is not up to date. Open Settings to check sync, or download a file backup.' : 'Browser data can be erased by clearing site data or switching devices.'}{' '}
      <a href="#/settings">Back up now</a>
    </Alert>
  )
}

/** Runs the optional folder auto-backup: at most once every 12 hours, shortly after data changes. */
export function AutoBackupRunner() {
  const { data, active, exportData, markBackedUp } = useStore()
  const last = useRef(0)
  useEffect(() => {
    if (!active || !folderBackupSupported() || data.transactions.length === 0) return
    const id = active.id
    const t = setTimeout(async () => {
      if (Date.now() - last.current < 12 * 3600_000) return
      const r = await writeBackupToFolder(id, backupFileName(active.name), makeBackup(active.name, exportData()))
      if (r === 'saved') { last.current = Date.now(); await markBackedUp() }
    }, 8000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, active?.id])
  return null
}

export function DataHealth() {
  const { active, data, exportData, markBackedUp } = useStore()
  const toast = useToast()
  const [st, setSt] = useState<Awaited<ReturnType<typeof storageStatus>> | null>(null)
  const [folder, setFolder] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    setSt(await storageStatus())
    if (active) setFolder(await backupFolderName(active.id))
  }, [active])
  useEffect(() => { void refresh() }, [refresh])
  if (!active) return null

  const { due, daysSince } = backupStatus(active, new Date(), data.transactions.length > 0)
  const json = () => makeBackup(active.name, exportData())
  const canShare = typeof navigator !== 'undefined' && !!navigator.canShare && navigator.canShare({ files: [new File(['{}'], 'x.json', { type: 'application/json' })] })

  return (
    <section className="card stack">
      <h2>Data health</h2>
      <table className="explain"><tbody>
        <tr><td>Storage protected from automatic cleanup</td><td>{st?.persisted === null ? 'Unknown' : st?.persisted ? 'Yes' : 'Not guaranteed'}</td></tr>
        <tr><td>Space used by this site</td><td className="num">{mb(st?.usageBytes ?? null)}</td></tr>
        <tr><td>Records in this profile</td><td className="num">{data.transactions.length} transactions · {data.cycles.length} cycles</td></tr>
        <tr><td>Last backup</td><td>{active.lastBackupAt ? `${new Date(active.lastBackupAt).toLocaleString()}${daysSince !== null ? ` (${daysSince} d ago)` : ''}` : 'Never'}</td></tr>
        <tr><td>Storage format</td><td className="num">v{DB_SCHEMA_VERSION}</td></tr>
      </tbody></table>
      {due && <Alert kind="warn">Back up soon: this profile’s only copy is in this browser.</Alert>}
      {st?.persisted === false && (
        <div className="row"><button className="btn" onClick={async () => { toast((await requestPersistence()) ? 'Storage protected' : 'The browser declined; keep backups'); void refresh() }}>Ask the browser to protect my data</button></div>
      )}
      <div className="row">
        <button className="btn primary" onClick={() => { download(backupFileName(active.name), json(), 'application/json'); void markBackedUp(); toast('Backup downloaded') }}>
          <Icon name="download" size={18} /> Download backup
        </button>
        {canShare && (
          <button className="btn" onClick={async () => {
            try { await navigator.share({ files: [new File([json()], backupFileName(active.name), { type: 'application/json' })], title: 'Expense calculator backup' }); await markBackedUp() } catch { /* cancelled */ }
          }}>Share backup (Drive, email…)</button>
        )}
      </div>

      {folderBackupSupported() ? (
        <div className="stack">
          <h3>Automatic backup to a folder</h3>
          <p className="hint">Pick a folder (for example one synced by Google Drive or iCloud). The app saves a fresh backup there about once a day while it is open. Files are <b>not encrypted</b>.</p>
          <div className="row">
            {folder ? <span className="chip good">Folder: {folder}</span> : <span className="chip">No folder chosen</span>}
            <button className="btn sm" onClick={async () => { const n = await chooseBackupFolder(active.id); if (n) { setFolder(n); toast('Folder saved') } }}>{folder ? 'Change folder' : 'Choose folder'}</button>
            {folder && (<>
              <button className="btn sm" onClick={async () => {
                const r = await writeBackupToFolder(active.id, backupFileName(active.name), json(), true)
                if (r === 'saved') { await markBackedUp(); toast('Backup saved to folder') } else toast(r === 'needs-permission' ? 'Permission needed: allow access to the folder' : 'Could not write to the folder')
              }}>Back up now</button>
              <button className="btn ghost sm" onClick={async () => { await clearBackupFolder(active.id); setFolder(null) }}>Stop</button>
            </>)}
          </div>
        </div>
      ) : <p className="hint">Automatic folder backup needs Chrome or Edge. On other browsers, use Download or Share backup.</p>}
    </section>
  )
}
