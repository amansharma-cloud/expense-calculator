import { handleApi } from './api'
import { canonicalRedirect } from './host'
import { AuthError, getJwks, kidOf, verifyAccessJwt } from './auth'
import { D1Store, type D1Like } from './store'

interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> }
  DB?: D1Like
  /** e.g. "myteam.cloudflareaccess.com" */
  ACCESS_TEAM_DOMAIN?: string
  /** AUD tag of the Access application that protects this site */
  ACCESS_AUD?: string
  /** When set (e.g. "money.example.com"), page loads on *.workers.dev are redirected here. Leave unset until everyone has moved. */
  CANONICAL_HOST?: string
  /** Local development only (set in .dev.vars, never deployed): skip Access and act as this email. */
  ALLOW_DEV_AUTH?: string
  DEV_AUTH_EMAIL?: string
}

const text = (status: number, body: string) => new Response(body, { status, headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } })
const jsonErr = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

/** Returns the signed-in email, or a Response to send instead. Fails closed when Access is not configured. */
async function authenticate(req: Request, env: Env): Promise<{ email: string } | Response> {
  if (env.ALLOW_DEV_AUTH === '1' && env.DEV_AUTH_EMAIL) return { email: env.DEV_AUTH_EMAIL.toLowerCase() }
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return jsonErr(503, 'sync is not configured on this site')
  const token = req.headers.get('cf-access-jwt-assertion')
  if (!token) return jsonErr(401, 'sign in required')
  try {
    const jwks = await getJwks(env.ACCESS_TEAM_DOMAIN, kidOf(token))
    return await verifyAccessJwt(token, { teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD }, jwks)
  } catch (e) {
    return jsonErr(e instanceof AuthError ? 401 : 503, 'sign in required')
  }
}

let store: D1Store | null = null

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)

    const moved = canonicalRedirect(url, env.CANONICAL_HOST)
    if (moved) return Response.redirect(moved, 301)

    if (url.pathname === '/login') {
      const who = await authenticate(req, env)
      return who instanceof Response ? who : Response.redirect(new URL('/#/settings', url.origin).toString(), 302)
    }

    if (url.pathname.startsWith('/api/')) {
      const who = await authenticate(req, env)
      if (who instanceof Response) return who
      if (!env.DB) return jsonErr(503, 'sync database is not configured')
      store ??= new D1Store(env.DB)
      try {
        return await handleApi(req, who.email, store)
      } catch {
        return text(500, 'server error') // never leak internals
      }
    }

    return env.ASSETS.fetch(req)
  },
}
