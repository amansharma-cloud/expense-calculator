import { beforeAll, describe, expect, it } from 'vitest'
import { handleApi } from '../worker/api'
import { AuthError, getJwks, resetJwksCache, verifyAccessJwt, type Jwks } from '../worker/auth'
import { MemoryStore } from '../worker/store'

// ---------- Access JWT ----------
const enc = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
const b64u = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')

let keyPair: CryptoKeyPair
let jwks: Jwks
beforeAll(async () => {
  keyPair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  jwks = { keys: [{ ...(await crypto.subtle.exportKey('jwk', keyPair.publicKey)), kid: 'k1' }] }
})

const cfg = { teamDomain: 'team.cloudflareaccess.com', aud: 'AUD123' }
const NOW = 1_800_000_000

async function sign(payload: Record<string, unknown>, header: Record<string, unknown> = { alg: 'RS256', kid: 'k1' }, key = () => keyPair.privateKey) {
  const body = `${enc(header)}.${enc(payload)}`
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key(), new TextEncoder().encode(body))
  return `${body}.${b64u(sig)}`
}
const good = { iss: 'https://team.cloudflareaccess.com', aud: ['AUD123'], exp: NOW + 600, email: 'Aman@Example.com' }

describe('Access token verification', () => {
  it('accepts a valid token and lowercases the email', async () => {
    expect(await verifyAccessJwt(await sign(good), cfg, jwks, NOW)).toEqual({ email: 'aman@example.com' })
  })
  it('accepts a string audience', async () => {
    expect((await verifyAccessJwt(await sign({ ...good, aud: 'AUD123' }), cfg, jwks, NOW)).email).toBe('aman@example.com')
  })
  it.each([
    ['expired', { ...good, exp: NOW - 1 }],
    ['wrong audience', { ...good, aud: ['OTHER'] }],
    ['wrong issuer', { ...good, iss: 'https://evil.cloudflareaccess.com' }],
    ['no email', { ...good, email: undefined }],
    ['not yet valid', { ...good, nbf: NOW + 3600 }],
  ])('rejects %s', async (_n, payload) => {
    await expect(verifyAccessJwt(await sign(payload as Record<string, unknown>), cfg, jwks, NOW)).rejects.toBeInstanceOf(AuthError)
  })
  it('rejects a token signed by a different key', async () => {
    const other = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
    await expect(verifyAccessJwt(await sign(good, { alg: 'RS256', kid: 'k1' }, () => other.privateKey), cfg, jwks, NOW)).rejects.toBeInstanceOf(AuthError)
  })
  it('rejects tampered payloads, unknown keys, alg none and garbage', async () => {
    const t = await sign(good)
    const [h, , s] = t.split('.')
    await expect(verifyAccessJwt(`${h}.${enc({ ...good, email: 'admin@example.com' })}.${s}`, cfg, jwks, NOW)).rejects.toBeInstanceOf(AuthError)
    await expect(verifyAccessJwt(await sign(good, { alg: 'RS256', kid: 'nope' }), cfg, jwks, NOW)).rejects.toBeInstanceOf(AuthError)
    await expect(verifyAccessJwt(`${enc({ alg: 'none' })}.${enc(good)}.`, cfg, jwks, NOW)).rejects.toBeInstanceOf(AuthError)
    await expect(verifyAccessJwt('not.a.jwt', cfg, jwks, NOW)).rejects.toBeInstanceOf(AuthError)
    await expect(verifyAccessJwt('x', cfg, jwks, NOW)).rejects.toBeInstanceOf(AuthError)
  })
  it('caches signing keys and refetches only for an unknown key id', async () => {
    resetJwksCache()
    let calls = 0
    const f = (async () => { calls++; return new Response(JSON.stringify(jwks)) }) as unknown as typeof fetch
    await getJwks('t.example', 'k1', 1_000_000, f)
    await getJwks('t.example', 'k1', 1_100_000, f)
    expect(calls).toBe(1)
    await getJwks('t.example', 'unknown', 1_200_000, f) // > 60 s since last fetch
    expect(calls).toBe(2)
  })
})

// ---------- API ----------
const ID = '11111111-1111-4111-8111-111111111111'
const ID2 = '22222222-2222-4222-8222-222222222222'
const T0 = 1_800_000_000_000
const profileBody = { name: 'Aman', salt: 'c2FsdA==', check: { iv: 'aXY=', ct: 'Y3Q=' } }
const call = (store: MemoryStore, user: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  handleApi(new Request('https://app.example' + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), user, store, T0)
const row = (k: string, u: number, extra: Record<string, unknown> = {}) => ({ k, t: k.split(':')[0], u, iv: 'aXY=', ct: 'Y2lwaGVy', ...extra })

describe('sync API', () => {
  it('stores ciphertext rows and returns them with a server counter', async () => {
    const s = new MemoryStore()
    expect((await call(s, 'a@x.com', 'PUT', `/api/profiles/${ID}`, profileBody)).status).toBe(200)
    const push = await call(s, 'a@x.com', 'POST', `/api/profiles/${ID}/rows`, { rows: [row('transactions:1', T0), row('transactions:2', T0)] })
    expect(await push.json()).toEqual({ accepted: 2 })
    const pull = (await (await call(s, 'a@x.com', 'GET', `/api/profiles/${ID}/rows?since=0`)).json()) as { rows: { k: string; r: number }[]; next: number | null; head: number }
    expect(pull.rows.map((r) => r.r)).toEqual([1, 2])
    expect(pull.next).toBeNull()
    expect(pull.head).toBe(2)
  })

  it('one user can never read, write or delete another user’s data', async () => {
    const s = new MemoryStore()
    await call(s, 'alice@x.com', 'PUT', `/api/profiles/${ID}`, profileBody)
    await call(s, 'alice@x.com', 'POST', `/api/profiles/${ID}/rows`, { rows: [row('transactions:1', T0)] })
    expect(((await (await call(s, 'bob@x.com', 'GET', '/api/profiles')).json()) as { profiles: unknown[] }).profiles).toEqual([])
    expect((await call(s, 'bob@x.com', 'GET', `/api/profiles/${ID}/rows?since=0`)).status).toBe(404)
    expect((await call(s, 'bob@x.com', 'POST', `/api/profiles/${ID}/rows`, { rows: [row('transactions:9', T0)] })).status).toBe(404)
    await call(s, 'bob@x.com', 'DELETE', `/api/profiles/${ID}`)
    expect(await s.countRows('alice@x.com', ID)).toBe(1) // untouched
    // bob creating a profile with the same id gets his own, separate profile
    await call(s, 'bob@x.com', 'PUT', `/api/profiles/${ID}`, { ...profileBody, name: 'Bob' })
    expect(await s.countRows('bob@x.com', ID)).toBe(0)
    expect((await s.getProfile('alice@x.com', ID))?.name).toBe('Aman')
  })

  it('refuses plaintext rows and unknown fields', async () => {
    const s = new MemoryStore()
    await call(s, 'a@x.com', 'PUT', `/api/profiles/${ID}`, profileBody)
    const bad = [
      { k: 'transactions:1', t: 'transactions', u: T0, d: { merchant: 'Zomato', amountPaise: 1000 } },
      { k: 'transactions:1', t: 'transactions', u: T0 },
      { ...row('transactions:1', T0), merchant: 'Zomato' },
      row('transactions:1', T0, { iv: 'not base64!' }),
    ]
    for (const r of bad) expect((await call(s, 'a@x.com', 'POST', `/api/profiles/${ID}/rows`, { rows: [r] })).status).toBe(400)
    expect(await s.countRows('a@x.com', ID)).toBe(0)
  })

  it('validates keys, tables, timestamps, sizes and ids', async () => {
    const s = new MemoryStore()
    await call(s, 'a@x.com', 'PUT', `/api/profiles/${ID}`, profileBody)
    const post = (rows: unknown) => call(s, 'a@x.com', 'POST', `/api/profiles/${ID}/rows`, { rows })
    expect((await post([row('evil:1', T0)])).status).toBe(400)
    expect((await post([{ ...row('transactions:1', T0), t: 'cycles' }])).status).toBe(400)
    expect((await post([row('transactions:../x', T0)])).status).toBe(400)
    expect((await post([row('transactions:1', T0 + 2 * 24 * 3600_000)])).status).toBe(400) // far future
    expect((await post([row('transactions:1', -5)])).status).toBe(400)
    expect((await post(Array.from({ length: 401 }, (_, i) => row(`transactions:${i}`, T0)))).status).toBe(400)
    expect((await call(s, 'a@x.com', 'GET', '/api/profiles/not-a-uuid/rows')).status).toBe(400)
    expect((await call(s, 'a@x.com', 'PUT', `/api/profiles/${ID}`, { name: '', salt: 'x', check: {} })).status).toBe(400)
    expect((await call(s, 'a@x.com', 'GET', '/api/nope')).status).toBe(404)
  })

  it('last writer wins by update time; tombstones carry no data', async () => {
    const s = new MemoryStore()
    await call(s, 'a@x.com', 'PUT', `/api/profiles/${ID}`, profileBody)
    const post = (rows: unknown[]) => call(s, 'a@x.com', 'POST', `/api/profiles/${ID}/rows`, { rows })
    await post([row('transactions:1', T0 + 10, { ct: 'bmV3' })])
    expect(((await (await post([row('transactions:1', T0 + 5, { ct: 'b2xk' })])).json()) as { accepted: number }).accepted).toBe(0) // older ignored
    expect(((await (await post([{ k: 'transactions:1', t: 'transactions', u: T0 + 20, x: 1 }])).json()) as { accepted: number }).accepted).toBe(1)
    const rows = (await s.rowsAfter('a@x.com', ID, 0, 10))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ x: 1 })
    expect(rows[0].ct).toBeUndefined()
    expect((await post([{ k: 'transactions:2', t: 'transactions', u: T0, x: 1, ct: 'YQ==' }])).status).toBe(400)
  })

  it('a late write with an old timestamp is still delivered to a client that already pulled', async () => {
    const s = new MemoryStore()
    await call(s, 'a@x.com', 'PUT', `/api/profiles/${ID}`, profileBody)
    await call(s, 'a@x.com', 'POST', `/api/profiles/${ID}/rows`, { rows: [row('transactions:1', T0 + 100)] })
    const first = (await (await call(s, 'a@x.com', 'GET', `/api/profiles/${ID}/rows?since=0`)).json()) as { head: number }
    await call(s, 'a@x.com', 'POST', `/api/profiles/${ID}/rows`, { rows: [row('transactions:2', T0 + 1)] }) // offline device, old clock
    const second = (await (await call(s, 'a@x.com', 'GET', `/api/profiles/${ID}/rows?since=${first.head}`)).json()) as { rows: { k: string }[] }
    expect(second.rows.map((r) => r.k)).toEqual(['transactions:2'])
  })

  it('rejects cross-site and non-JSON writes (CSRF)', async () => {
    const s = new MemoryStore()
    expect((await call(s, 'a@x.com', 'PUT', `/api/profiles/${ID}`, profileBody, { origin: 'https://evil.example' })).status).toBe(403)
    expect((await call(s, 'a@x.com', 'DELETE', `/api/profiles/${ID}`, undefined, { origin: 'https://evil.example' })).status).toBe(403)
    const r = await handleApi(new Request('https://app.example/api/profiles/' + ID, { method: 'PUT', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(profileBody) }), 'a@x.com', s, T0)
    expect(r.status).toBe(400)
    expect((await call(s, 'a@x.com', 'PUT', `/api/profiles/${ID}`, profileBody, { origin: 'https://app.example' })).status).toBe(200)
  })

  it('limits the number of synced profiles per user', async () => {
    const s = new MemoryStore()
    for (let i = 0; i < 5; i++) expect((await call(s, 'a@x.com', 'PUT', `/api/profiles/aaaaaaaa-aaaa-4aaa-8aaa-00000000000${i}`, profileBody)).status).toBe(200)
    expect((await call(s, 'a@x.com', 'PUT', `/api/profiles/${ID2}`, profileBody)).status).toBe(409)
    expect((await call(s, 'a@x.com', 'PUT', 'https://x/api/profiles/aaaaaaaa-aaaa-4aaa-8aaa-000000000001'.replace('https://x', ''), { ...profileBody, name: 'renamed' })).status).toBe(200)
  })

  it('pages large pulls and deletes the cloud copy on request', async () => {
    const s = new MemoryStore()
    await call(s, 'a@x.com', 'PUT', `/api/profiles/${ID}`, profileBody)
    for (let b = 0; b < 3; b++) await call(s, 'a@x.com', 'POST', `/api/profiles/${ID}/rows`, { rows: Array.from({ length: 400 }, (_, i) => row(`transactions:${b}-${i}`, T0 + b)) })
    let since = 0
    let total = 0
    for (;;) {
      const page = (await (await call(s, 'a@x.com', 'GET', `/api/profiles/${ID}/rows?since=${since}`)).json()) as { rows: unknown[]; next: number | null }
      total += page.rows.length
      if (page.next === null) break
      since = page.next
    }
    expect(total).toBe(1200)
    await call(s, 'a@x.com', 'DELETE', `/api/profiles/${ID}`)
    expect(await s.countRows('a@x.com', ID)).toBe(0)
    expect(await s.getProfile('a@x.com', ID)).toBeNull()
  })

  it('answers /api/me with the signed-in email', async () => {
    expect(await (await call(new MemoryStore(), 'a@x.com', 'GET', '/api/me')).json()).toEqual({ email: 'a@x.com' })
  })
})
