import type { ProfileUpload, RemoteProfile, RemoteRow, ServerRow } from '../src/sync/types'

/**
 * Persistence for the sync API. Every method is scoped by `user` (from the verified login), so
 * one user's query can never return another user's rows.
 *
 * `r` is a per-profile counter that strictly increases with every accepted write. Clients pull by `r`,
 * so a row written late by an offline device (with an old `u`) is still seen by everyone else.
 */
export interface SyncStore {
  init(): Promise<void>
  listProfiles(user: string): Promise<RemoteProfile[]>
  getProfile(user: string, id: string): Promise<RemoteProfile | null>
  putProfile(user: string, p: ProfileUpload, now: number): Promise<void>
  deleteProfile(user: string, id: string): Promise<void>
  rowsAfter(user: string, id: string, since: number, limit: number): Promise<ServerRow[]>
  head(user: string, id: string): Promise<number>
  upsertRows(user: string, id: string, rows: RemoteRow[]): Promise<number>
  countRows(user: string, id: string): Promise<number>
}

// ---------- Cloudflare D1 ----------

interface D1Stmt {
  bind(...v: unknown[]): D1Stmt
  all<T = unknown>(): Promise<{ results: T[] }>
  first<T = unknown>(): Promise<T | null>
  run(): Promise<{ meta?: { changes?: number } }>
}
export interface D1Like {
  prepare(q: string): D1Stmt
  batch(s: D1Stmt[]): Promise<{ meta?: { changes?: number } }[]>
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS profiles (
    user TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, salt TEXT NOT NULL,
    check_iv TEXT NOT NULL, check_ct TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL,
    PRIMARY KEY (user, id))`,
  `CREATE TABLE IF NOT EXISTS rows (
    user TEXT NOT NULL, profile TEXT NOT NULL, k TEXT NOT NULL, t TEXT NOT NULL,
    u INTEGER NOT NULL, x INTEGER NOT NULL DEFAULT 0, iv TEXT, ct TEXT, r INTEGER NOT NULL,
    PRIMARY KEY (user, profile, k))`,
  `CREATE INDEX IF NOT EXISTS rows_r ON rows (user, profile, r)`,
]

interface ProfileRow { id: string; name: string; salt: string; check_iv: string; check_ct: string; created: number; updated: number; n?: number }
const toProfile = (p: ProfileRow): RemoteProfile => ({
  id: p.id, name: p.name, salt: p.salt, checkIv: p.check_iv, checkCt: p.check_ct, created: p.created, updated: p.updated, rows: p.n ?? 0,
})

export class D1Store implements SyncStore {
  private ready = false
  constructor(private db: D1Like) {}

  async init() {
    if (this.ready) return
    await this.db.batch(SCHEMA.map((q) => this.db.prepare(q)))
    this.ready = true
  }

  async listProfiles(user: string) {
    const { results } = await this.db
      .prepare(`SELECT p.*, (SELECT COUNT(*) FROM rows r WHERE r.user = p.user AND r.profile = p.id AND r.x = 0) AS n FROM profiles p WHERE p.user = ? ORDER BY p.created`)
      .bind(user).all<ProfileRow>()
    return results.map(toProfile)
  }

  async getProfile(user: string, id: string) {
    const p = await this.db.prepare(`SELECT * FROM profiles WHERE user = ? AND id = ?`).bind(user, id).first<ProfileRow>()
    return p ? toProfile(p) : null
  }

  async putProfile(user: string, p: ProfileUpload, now: number) {
    await this.db
      .prepare(`INSERT INTO profiles (user, id, name, salt, check_iv, check_ct, created, updated) VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(user, id) DO UPDATE SET name = excluded.name, salt = excluded.salt, check_iv = excluded.check_iv, check_ct = excluded.check_ct, updated = excluded.updated`)
      .bind(user, p.id, p.name, p.salt, p.checkIv, p.checkCt, now, now).run()
  }

  async deleteProfile(user: string, id: string) {
    await this.db.batch([
      this.db.prepare(`DELETE FROM rows WHERE user = ? AND profile = ?`).bind(user, id),
      this.db.prepare(`DELETE FROM profiles WHERE user = ? AND id = ?`).bind(user, id),
    ])
  }

  async rowsAfter(user: string, id: string, since: number, limit: number) {
    const { results } = await this.db
      .prepare(`SELECT k, t, u, x, iv, ct, r FROM rows WHERE user = ? AND profile = ? AND r > ? ORDER BY r LIMIT ?`)
      .bind(user, id, since, limit).all<{ k: string; t: ServerRow['t']; u: number; x: number; iv: string | null; ct: string | null; r: number }>()
    return results.map((r): ServerRow => (r.x ? { k: r.k, t: r.t, u: r.u, x: 1, r: r.r } : { k: r.k, t: r.t, u: r.u, iv: r.iv ?? undefined, ct: r.ct ?? undefined, r: r.r }))
  }

  async head(user: string, id: string) {
    const h = await this.db.prepare(`SELECT COALESCE(MAX(r), 0) AS h FROM rows WHERE user = ? AND profile = ?`).bind(user, id).first<{ h: number }>()
    return h?.h ?? 0
  }

  async countRows(user: string, id: string) {
    const c = await this.db.prepare(`SELECT COUNT(*) AS c FROM rows WHERE user = ? AND profile = ?`).bind(user, id).first<{ c: number }>()
    return c?.c ?? 0
  }

  /** Last-writer-wins by `u`; each accepted write gets the next `r` (statements in a batch run in order). */
  async upsertRows(user: string, id: string, rows: RemoteRow[]) {
    const stmts = rows.map((row) =>
      this.db
        .prepare(`INSERT INTO rows (user, profile, k, t, u, x, iv, ct, r)
          VALUES (?,?,?,?,?,?,?,?, COALESCE((SELECT MAX(r) FROM rows WHERE user = ? AND profile = ?), 0) + 1)
          ON CONFLICT(user, profile, k) DO UPDATE SET t = excluded.t, u = excluded.u, x = excluded.x, iv = excluded.iv, ct = excluded.ct, r = excluded.r
          WHERE excluded.u > rows.u`)
        .bind(user, id, row.k, row.t, row.u, row.x ? 1 : 0, row.iv ?? null, row.ct ?? null, user, id),
    )
    if (!stmts.length) return 0
    const res = await this.db.batch(stmts)
    return res.reduce((n, x) => n + (x.meta?.changes ?? 0), 0)
  }
}

// ---------- in-memory (tests and local fakes) ----------

export class MemoryStore implements SyncStore {
  profiles = new Map<string, RemoteProfile>() // key user|id
  rows = new Map<string, ServerRow>() // key user|id|k
  counters = new Map<string, number>()

  async init() {}
  private pk = (u: string, id: string) => `${u}|${id}`

  async listProfiles(user: string) {
    return [...this.profiles.entries()].filter(([k]) => k.startsWith(user + '|')).map(([, p]) => ({ ...p, rows: [...this.rows.entries()].filter(([k, r]) => k.startsWith(`${user}|${p.id}|`) && !r.x).length }))
  }
  async getProfile(user: string, id: string) {
    return this.profiles.get(this.pk(user, id)) ?? null
  }
  async putProfile(user: string, p: ProfileUpload, now: number) {
    const old = this.profiles.get(this.pk(user, p.id))
    this.profiles.set(this.pk(user, p.id), { ...p, created: old?.created ?? now, updated: now, rows: 0 })
  }
  async deleteProfile(user: string, id: string) {
    this.profiles.delete(this.pk(user, id))
    for (const k of [...this.rows.keys()]) if (k.startsWith(`${user}|${id}|`)) this.rows.delete(k)
  }
  async rowsAfter(user: string, id: string, since: number, limit: number) {
    return [...this.rows.entries()].filter(([k, r]) => k.startsWith(`${user}|${id}|`) && r.r > since).map(([, r]) => r).sort((a, b) => a.r - b.r).slice(0, limit)
  }
  async head(user: string, id: string) {
    return this.counters.get(this.pk(user, id)) ?? 0
  }
  async countRows(user: string, id: string) {
    return [...this.rows.keys()].filter((k) => k.startsWith(`${user}|${id}|`)).length
  }
  async upsertRows(user: string, id: string, rows: RemoteRow[]) {
    let n = 0
    for (const row of rows) {
      const key = `${user}|${id}|${row.k}`
      const old = this.rows.get(key)
      if (old && old.u >= row.u) continue
      const r = (this.counters.get(this.pk(user, id)) ?? 0) + 1
      this.counters.set(this.pk(user, id), r)
      this.rows.set(key, { ...row, r })
      n++
    }
    return n
  }
}
