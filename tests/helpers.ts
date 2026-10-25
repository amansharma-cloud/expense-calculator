import Dexie from 'dexie'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { handleApi } from '../worker/api'
import type { MemoryStore } from '../worker/store'
import { SyncError, type SyncApi } from '../src/sync/types'

/** Each "device" gets its own IndexedDB, like two different browsers. */
export function device() {
  const idb = new IDBFactory()
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    const prev = { i: Dexie.dependencies.indexedDB, k: Dexie.dependencies.IDBKeyRange }
    Dexie.dependencies.indexedDB = idb
    Dexie.dependencies.IDBKeyRange = IDBKeyRange as unknown as typeof globalThis.IDBKeyRange
    try {
      return await fn()
    } finally {
      Dexie.dependencies.indexedDB = prev.i
      Dexie.dependencies.IDBKeyRange = prev.k
    }
  }
}

/** The real API handler, called in-process (no network), for one signed-in user. */
export function loopback(store: MemoryStore, user: string, clock: () => number = () => Date.now()): SyncApi {
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await handleApi(new Request('https://app.example' + path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), user, store, clock())
    const data = await res.json()
    if (!res.ok) throw new SyncError((data as { error: string }).error)
    return data
  }
  return {
    me: async () => ({ email: user }),
    listProfiles: async () => (await call('GET', '/api/profiles')).profiles,
    putProfile: async (p) => { await call('PUT', `/api/profiles/${p.id}`, { name: p.name, salt: p.salt, check: { iv: p.checkIv, ct: p.checkCt } }) },
    pull: (id, since) => call('GET', `/api/profiles/${id}/rows?since=${since}`),
    push: (id, rows) => call('POST', `/api/profiles/${id}/rows`, { rows }),
    deleteProfile: async (id) => { await call('DELETE', `/api/profiles/${id}`) },
    listSnapshots: async (id) => (await call('GET', `/api/profiles/${id}/snapshots`)).snapshots,
    pullSnapshot: (id, day, after) => call('GET', `/api/profiles/${id}/snapshots/${day}?after=${encodeURIComponent(after)}`),
  }
}

