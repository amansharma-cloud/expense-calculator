import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { createProfile, deleteProfile, listProfiles, openProfile, WrongPinError } from '../src/db/storage'
import type { Transaction } from '../src/engine/types'
import Dexie from 'dexie'

const tx = (id: string, amountPaise: number): Transaction => ({
  id, date: '2026-10-01', time: '10:00', amountPaise, type: 'expense', category: 'Food', merchant: 'secret-merchant',
  method: 'upi', note: '', source: 'manual', createdAt: '',
})

describe('profiles', () => {
  it('keeps each profile’s data completely separate', async () => {
    const a = await createProfile('Aman')
    const b = await createProfile('Partner')
    const sa = await openProfile(a)
    const sb = await openProfile(b)
    await sa.put('transactions', 't1', tx('t1', 11100))
    expect((await sa.load()).transactions).toHaveLength(1)
    expect((await sb.load()).transactions).toHaveLength(0)
    sa.close(); sb.close()
    await deleteProfile(a.id); await deleteProfile(b.id)
  })

  it('encrypts data at rest when a PIN is set, and rejects the wrong PIN', async () => {
    const meta = await createProfile('Locked', '4321')
    const s = await openProfile(meta, '4321')
    await s.put('transactions', 't1', tx('t1', 99900))
    expect((await s.load()).transactions[0].amountPaise).toBe(99900)
    s.close()

    // The raw stored row contains no readable merchant or amount.
    const raw = new Dexie('ds-profile-' + meta.id)
    await raw.open()
    const rows = await raw.table('records').toArray()
    expect(JSON.stringify(rows)).not.toContain('secret-merchant')
    expect(rows[0].ct).toBeTruthy()
    raw.close()

    await expect(openProfile(meta, '0000')).rejects.toBeInstanceOf(WrongPinError)
    await expect(openProfile(meta)).rejects.toBeInstanceOf(WrongPinError)
    const again = await openProfile(meta, '4321')
    expect((await again.load()).transactions).toHaveLength(1)
    again.close()
    await deleteProfile(meta.id)
  })

  it('adds, changes and removes a PIN without losing data', async () => {
    const meta = await createProfile('Convert')
    const s = await openProfile(meta)
    await s.put('transactions', 't1', tx('t1', 500))
    await s.setPin('1111')
    expect(s.meta.locked).toBe(true)
    s.close()
    const listed = (await listProfiles()).find((p) => p.id === meta.id)!
    const s2 = await openProfile(listed, '1111')
    expect((await s2.load()).transactions).toHaveLength(1)
    await s2.setPin(null)
    s2.close()
    const listed2 = (await listProfiles()).find((p) => p.id === meta.id)!
    expect(listed2.locked).toBe(false)
    const s3 = await openProfile(listed2)
    expect((await s3.load()).transactions[0].amountPaise).toBe(500)
    s3.close()
    await deleteProfile(meta.id)
  })

  it('deleting a profile removes its database', async () => {
    const m = await createProfile('Temp')
    const s = await openProfile(m)
    await s.put('transactions', 't', tx('t', 1))
    s.close()
    await deleteProfile(m.id)
    expect((await listProfiles()).some((p) => p.id === m.id)).toBe(false)
    expect(await Dexie.exists('ds-profile-' + m.id)).toBe(false)
  })
})
