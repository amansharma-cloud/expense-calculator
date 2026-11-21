import type { SyncStore } from './store'

/**
 * Web Push reminders. Zero-knowledge by design: the server only ever holds
 *  - the browser's push address (no keys, because we send NO payload),
 *  - the times to send, and a short generic text the device chose ("2 bills due tomorrow").
 * It never sees bill names, amounts or any transaction. When a push arrives the service worker fetches
 * /api/push/last (signed in) to get that one generic line and shows it.
 */

export interface ReminderItem { at: number; title: string; body: string }

export interface PushEnv {
  /** Secret: ECDSA P-256 private key as JSON (made by scripts/gen-vapid.mjs). Reminders are off when unset. */
  VAPID_PRIVATE_JWK?: string
  VAPID_SUBJECT?: string
  CANONICAL_HOST?: string
}

export const PUSH_LIMITS = { maxSubs: 10, maxItems: 200, horizonMs: 120 * 86_400_000, staleMs: 6 * 3_600_000, maxText: 140 }
/** Only real browser push services; the server never POSTs to an arbitrary address. */
const PUSH_HOSTS = [/(^|\.)fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/]

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
const fail = (status: number, error: string) => json({ error }, status)

const b64url = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
const utf8 = (s: string) => new TextEncoder().encode(s)

export function parsePrivateJwk(raw: string | undefined): JsonWebKey | null {
  if (!raw) return null
  try {
    const j = JSON.parse(raw) as JsonWebKey
    return j.kty === 'EC' && j.crv === 'P-256' && j.d && j.x && j.y ? j : null
  } catch {
    return null
  }
}

/** The public half browsers need (raw uncompressed point, base64url), derived from the private JWK. */
export function publicKeyOf(jwk: JsonWebKey): string {
  const out = new Uint8Array(65)
  out[0] = 4
  out.set(fromB64url(jwk.x!), 1)
  out.set(fromB64url(jwk.y!), 33)
  return b64url(out)
}

async function vapidHeader(endpoint: string, jwk: JsonWebKey, subject: string, now: number): Promise<string> {
  const key = await crypto.subtle.importKey('jwk', { ...jwk, key_ops: ['sign'] }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const head = b64url(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64url(utf8(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })))
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(`${head}.${claims}`))
  return `vapid t=${head}.${claims}.${b64url(sig)}, k=${publicKeyOf(jwk)}`
}

export type Sender = (endpoint: string, headers: Record<string, string>) => Promise<number>
const realSender: Sender = async (endpoint, headers) => (await fetch(endpoint, { method: 'POST', headers })).status

/** Send one empty push. Returns false when the address is gone (404/410) so it can be forgotten. */
export async function sendPush(endpoint: string, env: PushEnv, now: number, send: Sender = realSender): Promise<boolean> {
  const jwk = parsePrivateJwk(env.VAPID_PRIVATE_JWK)
  if (!jwk) return true
  const subject = env.VAPID_SUBJECT || (env.CANONICAL_HOST ? `https://${env.CANONICAL_HOST}` : 'https://workers.dev')
  const status = await send(endpoint, { TTL: '3600', Urgency: 'high', 'Content-Length': '0', Authorization: await vapidHeader(endpoint, jwk, subject, now) })
  return !(status === 404 || status === 410)
}

/** Called by the cron trigger: send everything that is due (but not stale), then remember it as "last". */
export async function runDueReminders(store: SyncStore, env: PushEnv, now: number, send?: Sender): Promise<number> {
  await store.init()
  await store.pruneSchedule(now - PUSH_LIMITS.staleMs)
  const due = await store.dueSchedule(now)
  let sent = 0
  for (const d of due) {
    const subs = await store.listPushSubs(d.user)
    await store.setLastPush(d.user, d.at, d.title, d.body)
    for (const endpoint of subs) {
      if (await sendPush(endpoint, env, now, send)) sent++
      else await store.deletePushSub(d.user, endpoint)
    }
    await store.removeSchedule(d.user, d.profile, d.at)
  }
  return sent
}

export function validateSchedule(body: unknown, now: number): ReminderItem[] | string {
  const list = (body as { items?: unknown } | null)?.items
  if (!Array.isArray(list)) return 'items must be an array'
  if (list.length > PUSH_LIMITS.maxItems) return `at most ${PUSH_LIMITS.maxItems} reminders`
  const out: ReminderItem[] = []
  for (const raw of list as Record<string, unknown>[]) {
    if (!raw || typeof raw !== 'object') return 'invalid reminder'
    const { at, title, body: text } = raw
    if (typeof at !== 'number' || !Number.isSafeInteger(at) || at < now - PUSH_LIMITS.staleMs || at > now + PUSH_LIMITS.horizonMs) return 'invalid time'
    if (typeof title !== 'string' || typeof text !== 'string' || title.length > 60 || text.length > PUSH_LIMITS.maxText || !title.trim() || !text.trim()) return 'invalid text'
    out.push({ at, title: title.trim(), body: text.trim() })
  }
  return out
}

export function validateEndpoint(endpoint: unknown): string | null {
  if (typeof endpoint !== 'string' || endpoint.length > 600) return null
  try {
    const u = new URL(endpoint)
    return u.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(u.hostname)) ? endpoint : null
  } catch {
    return null
  }
}

async function readJson(req: Request): Promise<unknown | string> {
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return 'content-type must be application/json'
  const text = await req.text()
  if (text.length > 64_000) return 'body too large'
  try { return JSON.parse(text) } catch { return 'invalid JSON' }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function handlePush(req: Request, user: string, store: SyncStore, env: PushEnv, now = Date.now(), send?: Sender): Promise<Response> {
  const url = new URL(req.url)
  const method = req.method.toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') {
    const origin = req.headers.get('origin')
    if (origin && origin !== url.origin) return fail(403, 'cross-site request refused')
  }
  const path = url.pathname.replace(/\/+$/, '')
  const jwk = parsePrivateJwk(env.VAPID_PRIVATE_JWK)
  await store.init()

  if (path === '/api/push/config' && method === 'GET') return json(jwk ? { enabled: true, publicKey: publicKeyOf(jwk) } : { enabled: false })
  if (!jwk) return fail(503, 'reminders are not set up on this site')

  if (path === '/api/push/last' && method === 'GET') return json({ last: await store.getLastPush(user) })

  if (path === '/api/push/subscribe' && method === 'POST') {
    const body = await readJson(req)
    if (typeof body === 'string') return fail(400, body)
    const endpoint = validateEndpoint((body as { endpoint?: unknown })?.endpoint)
    if (!endpoint) return fail(400, 'invalid push address')
    const have = await store.listPushSubs(user)
    if (!have.includes(endpoint) && have.length >= PUSH_LIMITS.maxSubs) return fail(409, `at most ${PUSH_LIMITS.maxSubs} devices`)
    await store.putPushSub(user, endpoint, now)
    return json({ ok: true })
  }
  if (path === '/api/push/subscribe' && method === 'DELETE') {
    const body = await readJson(req)
    if (typeof body === 'string') return fail(400, body)
    const endpoint = validateEndpoint((body as { endpoint?: unknown })?.endpoint)
    if (!endpoint) return fail(400, 'invalid push address')
    await store.deletePushSub(user, endpoint)
    return json({ ok: true })
  }

  if (path === '/api/push/test' && method === 'POST') {
    const subs = await store.listPushSubs(user)
    if (!subs.length) return fail(409, 'this device is not subscribed yet')
    await store.setLastPush(user, now, 'Daily Spend', 'Test reminder: notifications are working.')
    let ok = 0
    for (const endpoint of subs) {
      if (await sendPush(endpoint, env, now, send)) ok++
      else await store.deletePushSub(user, endpoint)
    }
    return json({ sent: ok })
  }

  const m = path.match(/^\/api\/push\/schedule\/([^/]+)$/)
  if (m && method === 'PUT') {
    if (!UUID.test(m[1])) return fail(400, 'invalid profile id')
    const body = await readJson(req)
    if (typeof body === 'string') return fail(400, body)
    const items = validateSchedule(body, now)
    if (typeof items === 'string') return fail(400, items)
    await store.setSchedule(user, m[1], items)
    return json({ ok: true, count: items.length })
  }
  if (m && method === 'DELETE') {
    if (!UUID.test(m[1])) return fail(400, 'invalid profile id')
    await store.setSchedule(user, m[1], [])
    return json({ ok: true })
  }
  return fail(404, 'not found')
}
