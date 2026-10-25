/**
 * Shapes shared by the browser and the Worker.
 *
 * Zero-knowledge rule: the server only ever receives and stores `iv` + `ct` (AES-GCM ciphertext made on the
 * device with the profile PIN). It never gets plaintext records, the PIN or the key. A `RemoteRow` with a
 * plaintext payload is rejected by the API.
 */
export type Table = 'plan' | 'cycles' | 'transactions' | 'planned'

export interface RemoteRow {
  /** "<table>:<id>" */
  k: string
  t: Table
  /** Last change on the device that wrote it (ms). Higher wins. */
  u: number
  /** 1 = deleted (tombstone: no iv/ct) */
  x?: 1
  iv?: string
  ct?: string
}

/** A row as returned by the server: also carries `r`, the server's strictly increasing change counter. */
export interface ServerRow extends RemoteRow {
  r: number
}

export interface RemoteProfile {
  id: string
  name: string
  /** PBKDF2 salt and an encrypted check value, so another device can verify the PIN. Not secret. */
  salt: string
  checkIv: string
  checkCt: string
  created: number
  updated: number
  rows: number
}

export type ProfileUpload = Pick<RemoteProfile, 'id' | 'name' | 'salt' | 'checkIv' | 'checkCt'>

export interface PullResult {
  rows: ServerRow[]
  /** Cursor for the next page, or null when the end was reached. */
  next: number | null
  /** Highest `r` currently on the server for this profile (so a client with nothing new can still advance). */
  head: number
}

export interface SnapshotInfo {
  /** UTC day, YYYY-MM-DD */
  day: string
  rows: number
}

export interface SyncApi {
  me(): Promise<{ email: string }>
  listProfiles(): Promise<RemoteProfile[]>
  putProfile(p: ProfileUpload): Promise<void>
  pull(profileId: string, since: number): Promise<PullResult>
  push(profileId: string, rows: RemoteRow[]): Promise<{ accepted: number }>
  deleteProfile(profileId: string): Promise<void>
  listSnapshots(profileId: string): Promise<SnapshotInfo[]>
  /** One page of a restore point (ciphertext rows). `next` is the cursor for the following page, or null. */
  pullSnapshot(profileId: string, day: string, after: string): Promise<{ rows: RemoteRow[]; next: string | null }>
}

export const LIMITS = {
  maxBodyBytes: 1_000_000,
  maxRowsPerPush: 400,
  maxRowsPerPull: 1000,
  maxRowsPerProfile: 20_000,
  maxProfilesPerUser: 5,
  maxCipherChars: 100_000,
  maxClockSkewMs: 24 * 3600_000,
  snapshotDaysKept: 14,
  maxRowsPerSnapshotPage: 1000,
} as const

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'error' | 'needs-login' | 'unavailable' | 'offline'

export class SyncAuthError extends Error {
  constructor() {
    super('Sign-in required')
  }
}
export class SyncUnavailableError extends Error {
  constructor() {
    super('Sync is not available on this site')
  }
}
export class SyncError extends Error {}
