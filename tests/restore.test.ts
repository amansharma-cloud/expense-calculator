import { describe, expect, it } from 'vitest'
import { createProfile, createProfileFromRemote, openProfile } from '../src/db/storage'
import type { Transaction } from '../src/engine/types'
import { restoreSnapshot, syncProfile } from '../src/sync/engine'
import { SyncError, type SyncApi } from '../src/sync/types'
import { MemoryStore } from '../worker/store'
import { device, loopback } from './helpers'

const DAY = 24 * 3600_000
const T = Date.parse('2026-11-01T10:00:00Z')

const tx = (id: string, merchant = 'secret-merchant'): Transaction => ({
  id, date: '2026-10-01', time: '10:00', amountPaise: 1234, type: 'expense', category: 'Food', merchant,
  method: 'upi', note: '', source: 'manual', createdAt: '',
})
const ids = async (s: { load(): Promise<{ transactions: Transaction[] }> }) => (await s.load()).transactions.map((t) => t.id).sort()

async function enable(s: Awaited<ReturnType<typeof openProfile>>, api: SyncApi) {
  const m = s.meta
  await api.putProfile({ id: m.id, name: m.name, salt: m.salt!, checkIv: m.check!.iv, checkCt: m.check!.ct })
  await s.setSync({ enabled: true, lastPullR: 0, lastPushU: 0 })
}

describe('daily restore points', () => {
  it('keeps one snapshot per day, taken before that day\'s first change, 14 days at most, ciphertext only', async () => {
    const store = new MemoryStore()
    let now = T
    const api = loopback(store, 'a@x.com', () => now)
    const D = device()
    await D(async () => {
      const meta = await createProfile('Aman', '1234')
      const s = await openProfile(meta, '1234')
      await enable(s, api)
      await s.put('transactions', 'a', tx('a'))
      await syncProfile(s, api) // day 1: nothing to snapshot yet (profile was empty)
      expect(await api.listSnapshots(meta.id)).toEqual([])

      await s.put('transactions', 'b', tx('b'))
      now = T + DAY
      await syncProfile(s, api) // day 2: snapshot = state before today's first push -> only "a"
      let snaps = await api.listSnapshots(meta.id)
      expect(snaps).toHaveLength(1)
      expect(snaps[0].rows).toBeGreaterThan(0)

      await s.put('transactions', 'c', tx('c'))
      await syncProfile(s, api) // same day again: no second snapshot
      expect(await api.listSnapshots(meta.id)).toHaveLength(1)

      for (let d = 2; d < 20; d++) { // many more days
        now = T + d * DAY
        await s.put('transactions', 'x' + d, tx('x' + d))
        await syncProfile(s, api)
      }
      snaps = await api.listSnapshots(meta.id)
      expect(snaps.length).toBe(14)
      expect(snaps[0].day > snaps[snaps.length - 1].day).toBe(true)
      expect(JSON.stringify([...store.snaps.values()].map((m) => [...m.values()]))).not.toContain('secret-merchant')
      s.close()
    })
  })

  it('restores yesterday after a mistake that already synced to the other device', async () => {
    const store = new MemoryStore()
    let now = T
    const apiA = loopback(store, 'a@x.com', () => now)
    const apiB = loopback(store, 'a@x.com', () => now)
    const A = device()
    const B = device()

    const { sA, id } = await A(async () => {
      const meta = await createProfile('Aman', '1234')
      const s = await openProfile(meta, '1234')
      await enable(s, apiA)
      for (const n of ['t1', 't2', 't3']) await s.put('transactions', n, tx(n))
      await syncProfile(s, apiA)
      return { sA: s, id: meta.id }
    })
    const sB = await B(async () => {
      const remote = (await apiB.listProfiles()).find((p) => p.id === id)!
      const s = await openProfile(await createProfileFromRemote(remote), '1234')
      await syncProfile(s, apiB)
      return s
    })

    // next day: the user wipes everything by mistake on device A; it syncs to B
    now = T + DAY
    await A(async () => { await sA.wipe(); await syncProfile(sA, apiA) })
    await B(() => syncProfile(sB, apiB))
    expect(await B(() => ids(sB))).toEqual([])

    // restore yesterday's point on A
    const day = (await apiA.listSnapshots(id))[0].day
    await A(async () => {
      expect(await restoreSnapshot(sA, apiA, day)).toBe(3)
      await syncProfile(sA, apiA)
    })
    expect(await A(() => ids(sA))).toEqual(['t1', 't2', 't3'])
    await B(() => syncProfile(sB, apiB))
    expect(await B(() => ids(sB))).toEqual(['t1', 't2', 't3'])
    expect((await B(() => sB.load())).transactions[0].merchant).toBe('secret-merchant')

    // records added after the restore point are removed by the restore (it is a true rewind)
    now = T + 2 * DAY
    await A(async () => { await sA.put('transactions', 'late', tx('late')); await syncProfile(sA, apiA) })
    const day2 = (await apiA.listSnapshots(id)).find((s) => s.day !== day)!.day
    await A(async () => { await restoreSnapshot(sA, apiA, day); await syncProfile(sA, apiA) })
    await B(() => syncProfile(sB, apiB))
    expect(await B(() => ids(sB))).toEqual(['t1', 't2', 't3'])
    expect(day2).toBeTruthy()
    await A(async () => { sA.close() })
    await B(async () => { sB.close() })
  })

  it('other users cannot list or read a restore point, and unknown days are empty', async () => {
    const store = new MemoryStore()
    const now = T
    const alice = loopback(store, 'alice@x.com', () => now)
    const mallory = loopback(store, 'mallory@x.com', () => now)
    const D = device()
    await D(async () => {
      const meta = await createProfile('Aman', '1234')
      const s = await openProfile(meta, '1234')
      await enable(s, alice)
      await s.put('transactions', 'a', tx('a'))
      await syncProfile(s, alice)
      await s.put('transactions', 'b', tx('b'))
      await syncProfile(s, loopback(store, 'alice@x.com', () => T + DAY))
      expect((await alice.listSnapshots(meta.id)).length).toBe(1)
      await expect(mallory.listSnapshots(meta.id)).rejects.toBeInstanceOf(SyncError)
      await expect(mallory.pullSnapshot(meta.id, (await alice.listSnapshots(meta.id))[0].day, '')).rejects.toBeInstanceOf(SyncError)
      await expect(restoreSnapshot(s, alice, '2000-01-01')).rejects.toThrow(/empty|available/)
      // deleting the cloud copy removes its restore points too
      await alice.deleteProfile(meta.id)
      expect(store.snaps.size).toBe(0)
      s.close()
    })
  })
})
