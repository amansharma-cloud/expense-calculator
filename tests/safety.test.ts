import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { backupDue, backupFileName } from '../src/db/backup'
import { createProfile, deleteProfile, listProfiles, openProfile, setLastBackup } from '../src/db/storage'
import type { Transaction } from '../src/engine/types'

const tx = (id: string): Transaction => ({
  id, date: '2026-10-01', time: '10:00', amountPaise: 1000, type: 'expense', category: 'Food', merchant: 'm',
  method: 'upi', note: '', source: 'manual', createdAt: '',
})

describe('storage upgrade v1 → v2', () => {
  it('keeps every old record and stamps an update time', async () => {
    const meta = await createProfile('Old')
    const old = new Dexie('ds-profile-' + meta.id)
    old.version(1).stores({ records: 'k,t' })
    await old.table('records').bulkPut([
      { k: 'transactions:a', t: 'transactions', d: tx('a') },
      { k: 'transactions:b', t: 'transactions', d: tx('b') },
    ])
    old.close()

    const s = await openProfile(meta)
    expect((await s.load()).transactions.map((t) => t.id).sort()).toEqual(['a', 'b'])
    const rows = await s.rawRows()
    expect(rows.every((r) => typeof r.u === 'number' && r.u > 0)).toBe(true)
    s.close()
    await deleteProfile(meta.id)
  })
})

describe('deleted records leave tombstones', () => {
  it('hides the record but keeps a marker with a newer time', async () => {
    const meta = await createProfile('Tomb')
    const s = await openProfile(meta)
    await s.put('transactions', 'a', tx('a'))
    const before = (await s.rawRows())[0].u
    await new Promise((r) => setTimeout(r, 5))
    await s.remove('transactions', 'a')
    expect((await s.load()).transactions).toHaveLength(0)
    const rows = await s.rawRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].x).toBe(1)
    expect(rows[0].u).toBeGreaterThan(before)
    expect(rows[0].d).toBeUndefined()
    s.close()
    await deleteProfile(meta.id)
  })

  it('a record written again after deletion comes back', async () => {
    const meta = await createProfile('Again')
    const s = await openProfile(meta)
    await s.put('transactions', 'a', tx('a'))
    await s.remove('transactions', 'a')
    await s.put('transactions', 'a', tx('a'))
    expect((await s.load()).transactions).toHaveLength(1)
    s.close()
    await deleteProfile(meta.id)
  })
})

describe('backup reminders', () => {
  const now = new Date('2026-10-30T10:00:00Z')
  it('does not nag when there is nothing to lose', () => {
    expect(backupDue(undefined, now, false).due).toBe(false)
  })
  it('asks when never backed up', () => {
    expect(backupDue(undefined, now, true)).toEqual({ due: true, daysSince: null })
  })
  it('asks after 14 days but not before', () => {
    expect(backupDue('2026-10-20T10:00:00Z', now, true)).toEqual({ due: false, daysSince: 10 })
    expect(backupDue('2026-10-16T10:00:00Z', now, true)).toEqual({ due: true, daysSince: 14 })
  })
  it('treats a corrupt timestamp as never backed up', () => {
    expect(backupDue('garbage', now, true).due).toBe(true)
  })
  it('builds safe file names', () => {
    expect(backupFileName('Aman S.', now)).toBe('expense-calculator-aman-s-2026-10-30.json')
  })
})

describe('registry', () => {
  it('remembers the last backup and keeps it when a PIN is added', async () => {
    const meta = await createProfile('Bk')
    await setLastBackup(meta.id, '2026-10-01T00:00:00.000Z')
    const fresh = (await listProfiles()).find((p) => p.id === meta.id)!
    expect(fresh.lastBackupAt).toBe('2026-10-01T00:00:00.000Z')
    const s = await openProfile(meta) // stale copy without lastBackupAt
    await s.setPin('1234')
    s.close()
    const after = (await listProfiles()).find((p) => p.id === meta.id)!
    expect(after.locked).toBe(true)
    expect(after.lastBackupAt).toBe('2026-10-01T00:00:00.000Z')
    await deleteProfile(meta.id)
  })
})
