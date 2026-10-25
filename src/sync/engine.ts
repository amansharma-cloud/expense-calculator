import type { Session } from '../db/storage'
import { LIMITS, SyncError, type RemoteRow, type SyncApi } from './types'

export interface SyncResult {
  pulled: number
  pushed: number
  /** True if rows on this device changed, so the screen must be reloaded from storage. */
  changedLocal: boolean
}

/**
 * One sync round for a profile: pull everything new from the cloud, then push everything new from this device.
 * Rows move as ciphertext in both directions; this code never decrypts anything.
 * Conflict rule: per record, the newer change (`u`) wins; a delete is a change like any other.
 */
export async function syncProfile(session: Session, api: SyncApi, now: () => Date = () => new Date()): Promise<SyncResult> {
  const sync = session.meta.sync
  if (!sync?.enabled) throw new SyncError('Sync is not turned on for this profile.')
  if (!session.encrypted) throw new SyncError('Only PIN-protected profiles can sync.')

  let { lastPullR, lastPushU } = sync
  let pulled = 0
  let changedLocal = false

  // 1. pull
  for (;;) {
    const page = await api.pull(session.meta.id, lastPullR)
    if (page.rows.length) {
      if ((await session.applyRemote(page.rows)) > 0) changedLocal = true
      pulled += page.rows.length
      lastPullR = page.rows[page.rows.length - 1].r
    }
    if (page.next === null) break
    lastPullR = Math.max(lastPullR, page.next)
  }

  // 2. push
  const pending = (await session.rawRows())
    .filter((r) => r.u > lastPushU && (r.x || (r.iv && r.ct)))
    .sort((a, b) => a.u - b.u)
  let pushed = 0
  for (let i = 0; i < pending.length; i += LIMITS.maxRowsPerPush) {
    const chunk = pending.slice(i, i + LIMITS.maxRowsPerPush)
    const rows: RemoteRow[] = chunk.map((r) => (r.x ? { k: r.k, t: r.t as RemoteRow['t'], u: r.u, x: 1 } : { k: r.k, t: r.t as RemoteRow['t'], u: r.u, iv: r.iv, ct: r.ct }))
    const res = await api.push(session.meta.id, rows)
    pushed += res.accepted
    lastPushU = Math.max(lastPushU, chunk[chunk.length - 1].u)
  }

  await session.setSync({ enabled: true, lastPullR, lastPushU, lastSyncAt: now().toISOString() })
  return { pulled, pushed, changedLocal }
}
