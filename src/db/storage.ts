import Dexie, { type Table } from 'dexie'
import type { Cycle, Plan, PlannedItem, Transaction } from '../engine/types'
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
}

interface RecordRow {
  k: string
  t: string
  d?: unknown
  iv?: string
  ct?: string
}

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
  }
}

const registry = () => new RegistryDB()
const uid = () => crypto.randomUUID()
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
    return this.key ? { k, t: table, ...(await seal(this.key, value)) } : { k, t: table, d: value }
  }

  async load(): Promise<ProfileData> {
    const rows = await this.db.records.toArray()
    const data = emptyData()
    for (const row of rows) {
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
    await this.db.records.delete(`${table}:${id}`)
  }

  /** Delete every record (keeps the profile itself). */
  async wipe(): Promise<void> {
    await this.db.records.clear()
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
      await reg.profiles.put(meta)
    } finally {
      reg.close()
    }
    this.meta = meta
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
