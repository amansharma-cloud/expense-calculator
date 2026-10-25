import { LIMITS, type ProfileUpload, type RemoteRow } from '../src/sync/types'
import type { SyncStore } from './store'

/**
 * JSON API for encrypted sync. `user` is the email from the verified Access token: never from the request.
 * Everything is validated; ciphertext only (plaintext fields are rejected).
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  })
const fail = (status: number, error: string) => json({ error }, status)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const B64 = /^[A-Za-z0-9+/]+={0,2}$/
const TABLES = ['plan', 'cycles', 'transactions', 'planned'] as const
const KEY = /^(plan|cycles|transactions|planned):[A-Za-z0-9_.\-]{1,100}$/

const isB64 = (s: unknown, max: number): s is string => typeof s === 'string' && s.length > 0 && s.length <= max && B64.test(s)

export function validateProfile(id: string, body: unknown): ProfileUpload | string {
  const b = body as Record<string, unknown> | null
  if (!b || typeof b !== 'object') return 'invalid body'
  const check = b.check as Record<string, unknown> | undefined
  if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 80) return 'invalid name'
  if (!isB64(b.salt, 64)) return 'invalid salt'
  if (!check || !isB64(check.iv, 64) || !isB64(check.ct, 200)) return 'invalid check value'
  return { id, name: b.name.trim(), salt: b.salt, checkIv: check.iv, checkCt: check.ct }
}

export function validateRows(body: unknown, now: number): RemoteRow[] | string {
  const list = (body as { rows?: unknown } | null)?.rows
  if (!Array.isArray(list)) return 'rows must be an array'
  if (list.length > LIMITS.maxRowsPerPush) return `at most ${LIMITS.maxRowsPerPush} rows per request`
  const out: RemoteRow[] = []
  for (const raw of list as Record<string, unknown>[]) {
    if (!raw || typeof raw !== 'object') return 'invalid row'
    const allowed = new Set(['k', 't', 'u', 'x', 'iv', 'ct', 'r'])
    for (const f of Object.keys(raw)) if (!allowed.has(f)) return `field "${f}" is not allowed (plaintext data is never accepted)`
    const { k, t, u, x, iv, ct } = raw
    if (typeof k !== 'string' || !KEY.test(k)) return 'invalid key'
    if (typeof t !== 'string' || !(TABLES as readonly string[]).includes(t) || k.split(':')[0] !== t) return 'invalid table'
    if (typeof u !== 'number' || !Number.isSafeInteger(u) || u <= 0 || u > now + LIMITS.maxClockSkewMs) return 'invalid timestamp'
    if (x === 1) {
      if (iv !== undefined || ct !== undefined) return 'a deleted row carries no data'
      out.push({ k, t: t as RemoteRow['t'], u, x: 1 })
    } else {
      if (x !== undefined && x !== 0) return 'invalid x'
      if (!isB64(iv, 64) || !isB64(ct, LIMITS.maxCipherChars)) return 'rows must be encrypted (iv and ct)'
      out.push({ k, t: t as RemoteRow['t'], u, iv, ct })
    }
  }
  return out
}

async function readJson(req: Request): Promise<unknown | string> {
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return 'content-type must be application/json'
  const len = Number(req.headers.get('content-length') ?? 0)
  if (len > LIMITS.maxBodyBytes) return 'body too large'
  const text = await req.text()
  if (text.length > LIMITS.maxBodyBytes) return 'body too large'
  try {
    return JSON.parse(text)
  } catch {
    return 'invalid JSON'
  }
}

export async function handleApi(req: Request, user: string, store: SyncStore, now = Date.now()): Promise<Response> {
  const url = new URL(req.url)
  const method = req.method.toUpperCase()

  // CSRF: the login is a cookie, so state-changing requests must come from this same site.
  if (method !== 'GET' && method !== 'HEAD') {
    const origin = req.headers.get('origin')
    if (origin && origin !== url.origin) return fail(403, 'cross-site request refused')
  }

  const path = url.pathname.replace(/\/+$/, '')
  if (path === '/api/me' && method === 'GET') return json({ email: user })

  await store.init()

  if (path === '/api/profiles' && method === 'GET') return json({ profiles: await store.listProfiles(user) })

  const m = path.match(/^\/api\/profiles\/([^/]+)(\/rows)?$/)
  if (!m) return fail(404, 'not found')
  const id = m[1]
  if (!UUID.test(id)) return fail(400, 'invalid profile id')

  if (!m[2]) {
    if (method === 'PUT') {
      const body = await readJson(req)
      if (typeof body === 'string') return fail(400, body)
      const p = validateProfile(id, body)
      if (typeof p === 'string') return fail(400, p)
      const existing = await store.getProfile(user, id)
      if (!existing && (await store.listProfiles(user)).length >= LIMITS.maxProfilesPerUser) return fail(409, `at most ${LIMITS.maxProfilesPerUser} synced profiles per user`)
      await store.putProfile(user, p, now)
      return json({ ok: true })
    }
    if (method === 'DELETE') {
      await store.deleteProfile(user, id)
      return json({ ok: true })
    }
    return fail(405, 'method not allowed')
  }

  // /rows
  if (!(await store.getProfile(user, id))) return fail(404, 'profile not found')

  if (method === 'GET') {
    const since = Number(url.searchParams.get('since') ?? 0)
    if (!Number.isSafeInteger(since) || since < 0) return fail(400, 'invalid cursor')
    const rows = await store.rowsAfter(user, id, since, LIMITS.maxRowsPerPull)
    const head = await store.head(user, id)
    const last = rows.length ? rows[rows.length - 1].r : since
    return json({ rows, next: rows.length === LIMITS.maxRowsPerPull && last < head ? last : null, head })
  }

  if (method === 'POST') {
    const body = await readJson(req)
    if (typeof body === 'string') return fail(400, body)
    const rows = validateRows(body, now)
    if (typeof rows === 'string') return fail(400, rows)
    if ((await store.countRows(user, id)) + rows.length > LIMITS.maxRowsPerProfile + LIMITS.maxRowsPerPush) return fail(413, 'this profile has too many records for cloud sync')
    return json({ accepted: await store.upsertRows(user, id, rows) })
  }
  return fail(405, 'method not allowed')
}
