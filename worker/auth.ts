/**
 * Verifies the JWT that Cloudflare Access adds to every request it lets through
 * (header `Cf-Access-Jwt-Assertion`). Signature (RS256), issuer, audience and expiry are all checked.
 * Fails closed: anything unexpected throws.
 */
export interface AccessConfig {
  /** e.g. "myteam.cloudflareaccess.com" */
  teamDomain: string
  /** The Access application's AUD tag */
  aud: string
}

export interface Jwks {
  keys: (JsonWebKey & { kid?: string })[]
}

export class AuthError extends Error {}

const b64urlToBytes = (s: string): Uint8Array<ArrayBuffer> => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
const parseJson = (s: string) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s))) as Record<string, unknown>

export async function verifyAccessJwt(token: string, cfg: AccessConfig, jwks: Jwks, nowSec = Math.floor(Date.now() / 1000)): Promise<{ email: string }> {
  const parts = token.split('.')
  if (parts.length !== 3) throw new AuthError('malformed token')
  let header: Record<string, unknown>
  let payload: Record<string, unknown>
  try {
    header = parseJson(parts[0])
    payload = parseJson(parts[1])
  } catch {
    throw new AuthError('malformed token')
  }
  if (header.alg !== 'RS256') throw new AuthError('unsupported algorithm')
  const jwk = jwks.keys.find((k) => k.kid === header.kid)
  if (!jwk) throw new AuthError('unknown key')

  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`))
  if (!ok) throw new AuthError('bad signature')

  if (payload.iss !== `https://${cfg.teamDomain}`) throw new AuthError('wrong issuer')
  const aud = payload.aud
  if (!(Array.isArray(aud) ? aud.includes(cfg.aud) : aud === cfg.aud)) throw new AuthError('wrong audience')
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) throw new AuthError('expired')
  if (typeof payload.nbf === 'number' && payload.nbf > nowSec + 60) throw new AuthError('not yet valid')
  const email = payload.email
  if (typeof email !== 'string' || !email.includes('@')) throw new AuthError('no email in token')
  return { email: email.toLowerCase() }
}

let cache: { team: string; jwks: Jwks; at: number } | null = null

/** Access signing keys, cached for an hour; re-fetched (at most once a minute) when an unknown key id shows up. */
export async function getJwks(teamDomain: string, wantKid?: string, now = Date.now(), fetcher: typeof fetch = fetch): Promise<Jwks> {
  const fresh = cache && cache.team === teamDomain && now - cache.at < 3600_000
  const hasKid = !wantKid || cache?.jwks.keys.some((k) => k.kid === wantKid)
  if (cache && fresh && hasKid) return cache.jwks
  if (cache && cache.team === teamDomain && now - cache.at < 60_000) return cache.jwks
  const res = await fetcher(`https://${teamDomain}/cdn-cgi/access/certs`)
  if (!res.ok) throw new AuthError('could not load signing keys')
  const jwks = (await res.json()) as Jwks
  cache = { team: teamDomain, jwks, at: now }
  return jwks
}

export const kidOf = (token: string): string | undefined => {
  try {
    return parseJson(token.split('.')[0]).kid as string | undefined
  } catch {
    return undefined
  }
}

export function resetJwksCache() {
  cache = null
}
