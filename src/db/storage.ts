import Dexie, { type Table } from 'dexie'
import type { Cycle, Plan, PlannedItem, Transaction } from '../engine/types'
import type { RemoteProfile, RemoteRow } from '../sync/types'
import { deriveKey, newSalt, open, seal, type Sealed } from './crypto'

/**
 * Local storage layout
 *   IndexedDB "ds-registry"          : one row per profile (name, whether it has a PIN, salt, PIN check value)
 *   IndexedDB "ds-profile-<id>"      : one database PER profile, a single `records` table
 *
 * A record is { k: "<table>:<id>", t: "<table>", d: <plain JSON> }  (no PIN)
 *            or { k, t, iv, ct }                                      (PIN: payload is AES-GCM encrypted)
 * Profiles never share a database, so one profile can never read another's rows by accident.
 * Nothing here talks to the network.
 */

export type TableName = 'plan' | 'cycles' | 'transactions' | 'planned'

export interface ProfileData {
  plan: Plan | null
  cycles: Cycle[]
  transactions: Transaction[]
  planned: PlannedItem[]
}

export const emptyData = (): ProfileData => ({ plan: null, cycles: [], transactions: [], planned: [] })

export interface ProfileMeta {
  id: string
  name: string
  createdAt: string
  locked: boolean
  salt?: string
  check?: Sealed
  /** ISO time of the last backup (download, share or auto-backup folder). Not sensitive, so kept unencrypted. */
  lastBackupAt?: string
  /** Present only while cloud sync is on for this profile. Cursors only; no financial data. */
  sync?: SyncMeta
}

export interface SyncMeta {
  enabled: true
  /** Server change counter of the last row received */
  lastPullR: number
  /** Newest local change time already uploaded */
  lastPushU: number
  lastSyncAt?: string
}

/**
 * `u` = last-change time (ms). `x` = 1 marks a deleted record (a tombstone is kept instead of
 * erasing the row, so a future sync can tell "deleted" from "never existed").
 */
export interface RecordRow {
  k: string
  t: string
  u: number
  x?: 1
  d?: unknown
  iv?: string
  ct?: string
}

/** Bump when the stored layout changes. Migrations must be additive and never discard data. */
export const DB_SCHEMA_VERSION = 2

class RegistryDB extends Dexie {
  profiles!: Table<ProfileMeta, string>
  constructor() {
    super('ds-registry')
    this.version(1).stores({ profiles: 'id' })
  }
}
class ProfileDB extends Dexie {
  records!: Table<RecordRow, string>
  constructor(id: string) {
    super('ds-profile-' + id)
    this.version(1).stores({ records: 'k,t' })
    // v2: every row carries an update time `u` (needed for sync/merge). Existing rows are stamped, nothing is removed.
    this.version(DB_SCHEMA_VERSION).stores({ records: 'k,t,u' }).upgrade((tx) =>
      tx.table('records').toCollection().modify((r: Partial<RecordRow>) => {
        if (typeof r.u !== 'number') r.u = Date.now()
      }),
    )
  }
}

const registry = () => new RegistryDB()
const uid = () => crypto.randomUUID()

/** Strictly increasing change time, so a delete followed by a re-save in the same millisecond still orders correctly. */
let lastU = 0
const nextU = () => (lastU = Math.max(Date.now(), lastU + 1))
const seenU = (u: number) => { if (u > lastU) lastU = u }
const CHECK_TEXT = 'daily-spend-ok'

export class WrongPinError extends Error {
  constructor() {
    super('Wrong PIN')
  }
}

export async function listProfiles(): Promise<ProfileMeta[]> {
  const r = registry()
  try {
    return (await r.profiles.toArray()).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  } finally {
    r.close()
  }
}

export async function createProfile(name: string, pin?: string): Promise<ProfileMeta> {
  const meta: ProfileMeta = { id: uid(), name: name.trim() || 'Me', createdAt: new Date().toISOString(), locked: false }
  if (pin) {
    meta.locked = true
    meta.salt = newSalt()
    meta.check = await seal(await deriveKey(pin, meta.salt), CHECK_TEXT)
  }
  const r = registry()
  try {
    await r.profiles.put(meta)
  } finally {
    r.close()
  }
  return meta
}

export async function setLastBackup(id: string, iso: string): Promise<void> {
  const r = registry()
  try {
    await r.profiles.update(id, { lastBackupAt: iso })
  } finally {
    r.close()
  }
}

export async function renameProfile(id: string, name: string): Promise<void> {
  const r = registry()
  try {
    await r.profiles.update(id, { name: name.trim() || 'Me' })
  } finally {
    r.close()
  }
}

export async function deleteProfile(id: string): Promise<void> {
  const r = registry()
  try {
    await r.profiles.delete(id)
  } finally {
    r.close()
  }
  await Dexie.delete('ds-profile-' + id)
}

export class Session {
  constructor(
    public meta: ProfileMeta,
    private db: ProfileDB,
    private key: CryptoKey | null,
  ) {}

  get locked() {
    return this.key !== null
  }

  private async pack(table: string, id: string, value: unknown): Promise<RecordRow> {
    const k = `${table}:${id}`
    const u = nextU()
    return this.key ? { k, t: table, u, ...(await seal(this.key, value)) } : { k, t: table, u, d: value }
  }

  /** Raw rows including tombstones, exactly as stored (ciphertext stays ciphertext). Used by backup/sync. */
  async rawRows(): Promise<RecordRow[]> {
    return this.db.records.toArray()
  }

  async load(): Promise<ProfileData> {
    const rows = await this.db.records.toArray()
    const data = emptyData()
    for (const row of rows) {
      if (row.x) continue
      const value = row.ct && row.iv ? await open(this.key!, { iv: row.iv, ct: row.ct }) : row.d
      switch (row.t as TableName) {
        case 'plan': data.plan = value as Plan; break
        case 'cycles': data.cycles.push(value as Cycle); break
        case 'transactions': data.transactions.push(value as Transaction); break
        case 'planned': data.planned.push(value as PlannedItem); break
      }
    }
    return data
  }

  async put(table: TableName, id: string, value: unknown): Promise<void> {
    await this.db.records.put(await this.pack(table, id, value))
  }

  async putMany(table: TableName, items: { id: string; value: unknown }[]): Promise<void> {
    const rows = await Promise.all(items.map((i) => this.pack(table, i.id, i.value)))
    await this.db.records.bulkPut(rows)
  }

  async remove(table: TableName, id: string): Promise<void> {
    await this.db.records.put({ k: `${table}:${id}`, t: table, u: nextU(), x: 1 })
  }

  /** Delete every record (keeps the profile itself). */
  async wipe(): Promise<void> {
    const live = (await this.db.records.toArray()).filter((r) => !r.x)
    await this.db.records.bulkPut(live.map((r) => ({ k: r.k, t: r.t, u: nextU(), x: 1 as const })))
  }

  get encrypted() {
    return this.key !== null
  }

  /**
   * Apply rows received from the cloud exactly as they are (still ciphertext). A row is only written if it is
   * newer than what this device has. Returns how many rows changed locally.
   */
  async applyRemote(rows: RemoteRow[]): Promise<number> {
    if (!rows.length) return 0
    const local = await this.db.records.bulkGet(rows.map((r) => r.k))
    const write: RecordRow[] = []
    rows.forEach((r, i) => {
      seenU(r.u)
      const cur = local[i]
      if (cur && cur.u >= r.u) return
      write.push(r.x ? { k: r.k, t: r.t, u: r.u, x: 1 } : { k: r.k, t: r.t, u: r.u, iv: r.iv, ct: r.ct })
    })
    if (write.length) await this.db.records.bulkPut(write)
    return write.length
  }

  /** Update (or clear) this profile's cloud-sync cursors. */
  async setSync(sync: SyncMeta | undefined): Promise<void> {
    const reg = registry()
    try {
      const cur = (await reg.profiles.get(this.meta.id)) ?? this.meta
      const next: ProfileMeta = { ...cur }
      if (sync) next.sync = sync
      else delete next.sync
      await reg.profiles.put(next)
      this.meta = next
    } finally {
      reg.close()
    }
  }

  /** Add, change or remove the PIN, re-encrypting every record. */
  async setPin(newPin: string | null): Promise<void> {
    const data = await this.load()
    const rows: { table: TableName; id: string; value: unknown }[] = [
      ...(data.plan ? [{ table: 'plan' as const, id: 'plan', value: data.plan }] : []),
      ...data.cycles.map((c) => ({ table: 'cycles' as const, id: c.start, value: c })),
      ...data.transactions.map((t) => ({ table: 'transactions' as const, id: t.id, value: t })),
      ...data.planned.map((p) => ({ table: 'planned' as const, id: p.id, value: p })),
    ]
    const meta: ProfileMeta = { ...this.meta }
    if (newPin) {
      meta.salt = newSalt()
      this.key = await deriveKey(newPin, meta.salt)
      meta.check = await seal(this.key, CHECK_TEXT)
      meta.locked = true
    } else {
      this.key = null
      meta.locked = false
      delete meta.salt
      delete meta.check
    }
    const packed = await Promise.all(rows.map((r) => this.pack(r.table, r.id, r.value)))
    await this.db.transaction('rw', this.db.records, async () => {
      await this.db.records.clear()
      await this.db.records.bulkPut(packed)
    })
    const reg = registry()
    try {
      // merge into the stored row so fields set elsewhere (e.g. lastBackupAt) are not overwritten by this stale copy
      const current = (await reg.profiles.get(meta.id)) ?? meta
      const merged: ProfileMeta = { ...current, locked: meta.locked, salt: meta.salt, check: meta.check }
      if (!meta.locked) { delete merged.salt; delete merged.check }
      await reg.profiles.put(merged)
      this.meta = merged
    } finally {
      reg.close()
    }
  }

  close() {
    this.db.close()
    this.key = null
  }
}

/** Open a profile. For PIN-protected profiles the PIN is required and verified before any data is read. */
export async function openProfile(meta: ProfileMeta, pin?: string): Promise<Session> {
  let key: CryptoKey | null = null
  if (meta.locked) {
    if (!pin || !meta.salt || !meta.check) throw new WrongPinError()
    key = await deriveKey(pin, meta.salt)
    try {
      if ((await open<string>(key, meta.check)) !== CHECK_TEXT) throw new WrongPinError()
    } catch {
      throw new WrongPinError()
    }
  }
  return new Session(meta, new ProfileDB(meta.id), key)
}

/** Remembering which profile was open last is a UI convenience only; it holds no financial data. */
const LAST_KEY = 'daily-spend:last-profile'
export const rememberProfile = (id: string | null) => {
  try {
    if (id) localStorage.setItem(LAST_KEY, id)
    else localStorage.removeItem(LAST_KEY)
  } catch { /* storage may be blocked */ }
}
export const lastProfileId = (): string | null => {
  try {
    return localStorage.getItem(LAST_KEY)
  } catch {
    return null
  }
}

/** Ask the browser not to evict this site's storage under pressure. Safe to call repeatedly; may be refused. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false
    return (await navigator.storage.persisted?.()) || (await navigator.storage.persist())
  } catch {
    return false
  }
}

export async function storageStatus(): Promise<{ persisted: boolean | null; usageBytes: number | null; quotaBytes: number | null }> {
  try {
    const est = await navigator.storage?.estimate?.()
    return {
      persisted: (await navigator.storage?.persisted?.()) ?? null,
      usageBytes: est?.usage ?? null,
      quotaBytes: est?.quota ?? null,
    }
  } catch {
    return { persisted: null, usageBytes: null, quotaBytes: null }
  }
}

/** Create the local copy of a profile that exists in the cloud (the PIN is verified when it is opened). */
export async function createProfileFromRemote(remote: RemoteProfile): Promise<ProfileMeta> {
  const r = registry()
  try {
    if (await r.profiles.get(remote.id)) throw new Error('This profile is already on this device.')
    const meta: ProfileMeta = {
      id: remote.id, name: remote.name, createdAt: new Date().toISOString(), locked: true,
      salt: remote.salt, check: { iv: remote.checkIv, ct: remote.checkCt },
      sync: { enabled: true, lastPullR: 0, lastPushU: 0 },
    }
    await r.profiles.put(meta)
    return meta
  } finally {
    r.close()
  }
}
