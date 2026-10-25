import Dexie, { type Table } from 'dexie'

/**
 * Optional automatic backup to a folder the user picks (File System Access API: Chrome/Edge on desktop & Android).
 * The folder handle is stored in this browser; the app can only write there after the user grants permission,
 * and the browser may ask again after a restart. Backup files are plain JSON (not encrypted).
 */

interface FolderRow {
  id: string
  dir: unknown
}
class HandlesDB extends Dexie {
  handles!: Table<FolderRow, string>
  constructor() {
    super('ds-handles')
    this.version(1).stores({ handles: 'id' })
  }
}

type Perm = 'granted' | 'denied' | 'prompt'
interface DirHandle {
  name: string
  queryPermission(o: { mode: 'readwrite' }): Promise<Perm>
  requestPermission(o: { mode: 'readwrite' }): Promise<Perm>
  getFileHandle(name: string, o: { create: boolean }): Promise<{ createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }> }>
}

export const folderBackupSupported = (): boolean => typeof window !== 'undefined' && 'showDirectoryPicker' in window

async function withDb<T>(fn: (db: HandlesDB) => Promise<T>): Promise<T> {
  const db = new HandlesDB()
  try {
    return await fn(db)
  } finally {
    db.close()
  }
}

export async function chooseBackupFolder(profileId: string): Promise<string | null> {
  const picker = (window as unknown as { showDirectoryPicker(o: { mode: 'readwrite' }): Promise<DirHandle> }).showDirectoryPicker
  try {
    const dir = await picker.call(window, { mode: 'readwrite' })
    await withDb((db) => db.handles.put({ id: profileId, dir }))
    return dir.name
  } catch {
    return null // picker cancelled
  }
}

export async function backupFolderName(profileId: string): Promise<string | null> {
  const row = await withDb((db) => db.handles.get(profileId)).catch(() => undefined)
  return row ? (row.dir as DirHandle).name : null
}

export async function clearBackupFolder(profileId: string): Promise<void> {
  await withDb((db) => db.handles.delete(profileId))
}

export type AutoBackupResult = 'saved' | 'no-folder' | 'needs-permission' | 'failed'

/** Write one backup file into the chosen folder. Pass `askPermission` only from a click. */
export async function writeBackupToFolder(profileId: string, fileName: string, json: string, askPermission = false): Promise<AutoBackupResult> {
  try {
    const row = await withDb((db) => db.handles.get(profileId))
    if (!row) return 'no-folder'
    const dir = row.dir as DirHandle
    let perm = await dir.queryPermission({ mode: 'readwrite' })
    if (perm !== 'granted' && askPermission) perm = await dir.requestPermission({ mode: 'readwrite' })
    if (perm !== 'granted') return 'needs-permission'
    const file = await dir.getFileHandle(fileName, { create: true })
    const w = await file.createWritable()
    await w.write(json)
    await w.close()
    return 'saved'
  } catch {
    return 'failed'
  }
}
