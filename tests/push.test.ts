const webcrypto = globalThis.crypto
import { describe, expect, it } from 'vitest'
import { handlePush, publicKeyOf, runDueReminders, sendPush, validateEndpoint, type Sender } from '../worker/push'
import { MemoryStore } from '../worker/store'

const FCM = 'https://fcm.googleapis.com/fcm/send/abc123'
const PROFILE = '11111111-2222-3333-4444-555555555555'
const NOW = Date.parse('2026-11-21T10:00:00Z')

async function keys() {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const jwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey)
  return { env: { VAPID_PRIVATE_JWK: JSON.stringify(jwk) }, pub: pair.publicKey }
}
const call = (store: MemoryStore, env: { VAPID_PRIVATE_JWK?: string }, user: string, method: string, path: string, body?: unknown, send?: Sender) =>
  handlePush(new Request('https://app.example' + path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), user, store, env, NOW, send)

describe('push reminders', () => {
  it('is off, and says so, until the secret is set', async () => {
    const r = await call(new MemoryStore(), {}, 'a@x.com', 'GET', '/api/push/config')
    expect(await r.json()).toEqual({ enabled: false })
    expect((await call(new MemoryStore(), {}, 'a@x.com', 'POST', '/api/push/test')).status).toBe(503)
  })

  it('signs a VAPID token the push service can verify, and sends no body', async () => {
    const { env, pub } = await keys()
    let seen: Record<string, string> = {}
    await sendPush(FCM, env, NOW, async (_e, h) => { seen = h; return 201 })
    expect(seen['Content-Length']).toBe('0')
    const [, t, k] = seen.Authorization.match(/^vapid t=([^,]+), k=(.+)$/)!
    const [head, claims, sig] = t.split('.')
    expect(JSON.parse(atob(claims.replace(/-/g, '+').replace(/_/g, '/'))).aud).toBe('https://fcm.googleapis.com')
    const raw = Uint8Array.from(atob(sig.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
    const ok = await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, raw, new TextEncoder().encode(`${head}.${claims}`))
    expect(ok).toBe(true)
    expect(k).toBe(publicKeyOf(JSON.parse(env.VAPID_PRIVATE_JWK)))
  })

  it('only accepts real push-service addresses', () => {
    expect(validateEndpoint(FCM)).toBe(FCM)
    expect(validateEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).not.toBeNull()
    expect(validateEndpoint('https://evil.example/hook')).toBeNull()
    expect(validateEndpoint('http://fcm.googleapis.com/x')).toBeNull()
    expect(validateEndpoint('https://fcm.googleapis.com.evil.example/x')).toBeNull()
  })

  it('stores times and a generic line, then the cron sends once and keeps the last message', async () => {
    const { env } = await keys()
    const store = new MemoryStore()
    await call(store, env, 'a@x.com', 'POST', '/api/push/subscribe', { endpoint: FCM })
    const put = await call(store, env, 'a@x.com', 'PUT', `/api/push/schedule/${PROFILE}`, { items: [{ at: NOW - 60_000, title: 'Daily Spend', body: '2 bills due tomorrow' }, { at: NOW + 86_400_000, title: 'Daily Spend', body: 'later' }] })
    expect(put.status).toBe(200)
    const sentTo: string[] = []
    const n = await runDueReminders(store, env, NOW, async (e) => { sentTo.push(e); return 201 })
    expect(n).toBe(1)
    expect(sentTo).toEqual([FCM])
    expect(await runDueReminders(store, env, NOW, async () => 201)).toBe(0) // already sent
    const last = await (await call(store, env, 'a@x.com', 'GET', '/api/push/last')).json() as { last: { body: string } }
    expect(last.last.body).toBe('2 bills due tomorrow')
    expect((await (await call(store, env, 'b@x.com', 'GET', '/api/push/last')).json() as { last: unknown }).last).toBeNull() // other users see nothing
  })

  it('forgets a device the push service says is gone, and drops stale reminders', async () => {
    const { env } = await keys()
    const store = new MemoryStore()
    await store.putPushSub('a@x.com', FCM, NOW)
    await store.setSchedule('a@x.com', PROFILE, [{ at: NOW - 60_000, title: 'Daily Spend', body: 'x' }])
    await runDueReminders(store, env, NOW, async () => 410)
    expect(await store.listPushSubs('a@x.com')).toEqual([])
    await store.setSchedule('a@x.com', PROFILE, [{ at: NOW - 10 * 3_600_000, title: 'Daily Spend', body: 'old' }])
    await store.putPushSub('a@x.com', FCM, NOW)
    expect(await runDueReminders(store, env, NOW, async () => 201)).toBe(0)
  })

  it('rejects bad schedules, other-site requests, and too many devices', async () => {
    const { env } = await keys()
    const store = new MemoryStore()
    const bad = (items: unknown) => call(store, env, 'a@x.com', 'PUT', `/api/push/schedule/${PROFILE}`, { items })
    expect((await bad([{ at: NOW + 999 * 86_400_000, title: 'a', body: 'b' }])).status).toBe(400)
    expect((await bad([{ at: NOW + 1000, title: 'a', body: 'x'.repeat(500) }])).status).toBe(400)
    expect((await bad('nope')).status).toBe(400)
    const cross = await handlePush(new Request('https://app.example/api/push/test', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' }), 'a@x.com', store, env, NOW)
    expect(cross.status).toBe(403)
    for (let i = 0; i < 10; i++) await call(store, env, 'a@x.com', 'POST', '/api/push/subscribe', { endpoint: `${FCM}${i}` })
    expect((await call(store, env, 'a@x.com', 'POST', '/api/push/subscribe', { endpoint: FCM + 'extra' })).status).toBe(409)
  })
})
