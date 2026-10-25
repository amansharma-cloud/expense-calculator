import { describe, expect, it } from 'vitest'
import { MemoryStore } from '../worker/store'
import { createProfile, createProfileFromRemote, listProfiles, openProfile, WrongPinError, type ProfileMeta, type Session } from '../src/db/storage'
import type { Transaction } from '../src/engine/types'
import { syncProfile } from '../src/sync/engine'
import { SyncError, type SyncApi } from '../src/sync/types'
import { device, loopback } from './helpers'

const tx = (id: string, merchant = 'secret-merchant', amountPaise = 1234): Transaction => ({
  id, date: '2026-10-01', time: '10:00', amountPaise, type: 'expense', category: 'Food', merchant,
  method: 'upi', note: '', source: 'manual', createdAt: '',
})
const ids = async (s: Session) => (await s.load()).transactions.map((t) => t.id).sort()
const wait = () => new Promise((r) => setTimeout(r, 3))

async function enableSync(s: Session, api: SyncApi) {
  const m = s.meta
  await api.putProfile({ id: m.id, name: m.name, salt: m.salt!, checkIv: m.check!.iv, checkCt: m.check!.ct })
  await s.setSync({ enabled: true, lastPullR: 0, lastPushU: 0 })
}

describe('encrypted sync between two devices', () => {
  it('moves data both ways, never sends plaintext, and keeps users apart', async () => {
    const cloud = new MemoryStore()
    const A = device()
    const B = device()
    const apiA = loopback(cloud, 'aman@example.com')

    // --- device A: PIN-protected profile with data, turn sync on
    const { sA, metaId } = await A(async () => {
      const meta = await createProfile('Aman', '4321')
      const s = await openProfile(meta, '4321')
      await s.put('transactions', 't1', tx('t1'))
      await s.put('transactions', 't2', tx('t2'))
      await enableSync(s, apiA)
      const r = await syncProfile(s, apiA)
      expect(r.pushed).toBe(2)
      return { sA: s, metaId: meta.id }
    })

    // the server only holds ciphertext
    const stored = JSON.stringify([...cloud.rows.values()])
    expect(stored).not.toContain('secret-merchant')
    expect(stored).not.toContain('1234')
    expect(stored).toContain('"ct"')

    // --- device B: restore from cloud with the PIN
    const apiB = loopback(cloud, 'aman@example.com')
    const sB = await B(async () => {
      const remote = (await apiB.listProfiles()).find((p) => p.id === metaId)!
      const meta = await createProfileFromRemote(remote)
      await expect(openProfile(meta, '0000')).rejects.toBeInstanceOf(WrongPinError)
      const s = await openProfile(meta, '4321')
      const r = await syncProfile(s, apiB)
      expect(r.pulled).toBe(2)
      expect(r.changedLocal).toBe(true)
      return s
    })
    expect(await B(() => ids(sB))).toEqual(['t1', 't2'])
    expect((await B(() => sB.load())).transactions[0].merchant).toBe('secret-merchant') // decrypted locally with the PIN

    // --- edit on A, add + delete on B, sync both ways
    await wait()
    await A(() => sA.put('transactions', 't1', tx('t1', 'edited-on-A', 9999)))
    await wait()
    await B(async () => {
      await sB.put('transactions', 't3', tx('t3'))
      await sB.remove('transactions', 't2')
      await syncProfile(sB, apiB)
    })
    await A(() => syncProfile(sA, apiA))
    await B(() => syncProfile(sB, apiB))
    expect(await A(() => ids(sA))).toEqual(['t1', 't3'])
    expect(await B(() => ids(sB))).toEqual(['t1', 't3'])
    expect((await B(() => sB.load())).transactions.find((t) => t.id === 't1')!.merchant).toBe('edited-on-A')

    // --- the newer change wins when both devices edit the same record
    await wait()
    await A(() => sA.put('transactions', 't3', tx('t3', 'A-edit')))
    await wait()
    await B(() => sB.put('transactions', 't3', tx('t3', 'B-edit-later')))
    await A(() => syncProfile(sA, apiA))
    await B(() => syncProfile(sB, apiB))
    await A(() => syncProfile(sA, apiA))
    expect((await A(() => sA.load())).transactions.find((t) => t.id === 't3')!.merchant).toBe('B-edit-later')
    expect((await B(() => sB.load())).transactions.find((t) => t.id === 't3')!.merchant).toBe('B-edit-later')

    // --- erasing a profile on one device is a (synced) delete of every record
    await wait()
    await A(async () => { await sA.wipe(); await syncProfile(sA, apiA) })
    await B(() => syncProfile(sB, apiB))
    expect(await B(() => ids(sB))).toEqual([])

    // --- another user sees nothing of this
    const eve = loopback(cloud, 'eve@example.com')
    expect(await eve.listProfiles()).toEqual([])
    await expect(eve.pull(metaId, 0)).rejects.toBeInstanceOf(SyncError)

    // once both are caught up, another round moves nothing
    await A(() => syncProfile(sA, apiA))
    await B(() => syncProfile(sB, apiB))
    await A(() => syncProfile(sA, apiA))
    const r = await A(() => syncProfile(sA, apiA))
    expect(r.pulled).toBe(0)
    expect(r.pushed).toBe(0)
    await A(async () => { sA.close() })
    await B(async () => { sB.close() })
  })

  it('refuses to sync a profile without a PIN or with sync off', async () => {
    const D = device()
    await D(async () => {
      const meta = await createProfile('Plain')
      const s = await openProfile(meta)
      await expect(syncProfile(s, loopback(new MemoryStore(), 'a@x.com'))).rejects.toThrow(/not turned on/)
      await s.setSync({ enabled: true, lastPullR: 0, lastPushU: 0 })
      await expect(syncProfile(s, loopback(new MemoryStore(), 'a@x.com'))).rejects.toThrow(/PIN/)
      s.close()
    })
  })

  it('cannot restore a cloud profile that already exists on this device', async () => {
    const D = device()
    await D(async () => {
      const meta: ProfileMeta = await createProfile('X', '1234')
      await expect(createProfileFromRemote({ id: meta.id, name: 'X', salt: 's', checkIv: 'i', checkCt: 'c', created: 1, updated: 1, rows: 0 })).rejects.toThrow(/already/)
      expect((await listProfiles()).length).toBe(1)
    })
  })
})
