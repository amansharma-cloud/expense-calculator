import {
  SyncAuthError, SyncError, SyncUnavailableError,
  type ProfileUpload, type PullResult, type RemoteProfile, type RemoteRow, type SyncApi,
} from './types'

/** Talks to this site's own /api (same origin; the Cloudflare Access login cookie goes along automatically). */
export class HttpSyncApi implements SyncApi {
  private async call<T>(method: string, path: string, body?: unknown, probe = false): Promise<T> {
    let res: Response
    try {
      res = await fetch(path, {
        method,
        redirect: 'manual', // an expired login redirects to the Access sign-in page: don't follow it, report it
        credentials: 'same-origin',
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      throw new TypeError('network') // offline / blocked
    }
    if (res.type === 'opaqueredirect' || res.status === 401 || res.status === 403) throw new SyncAuthError()
    if (res.status === 503 || (probe && res.status === 404)) throw new SyncUnavailableError()
    const isJson = (res.headers.get('content-type') ?? '').includes('application/json')
    if (!isJson) throw new SyncUnavailableError() // e.g. a static host answering /api/* with index.html
    const data = (await res.json()) as T & { error?: string }
    if (!res.ok) throw new SyncError(data.error ?? `Request failed (${res.status})`)
    return data
  }

  me() {
    return this.call<{ email: string }>('GET', '/api/me', undefined, true)
  }
  async listProfiles(): Promise<RemoteProfile[]> {
    return (await this.call<{ profiles: RemoteProfile[] }>('GET', '/api/profiles')).profiles
  }
  async putProfile(p: ProfileUpload) {
    await this.call('PUT', `/api/profiles/${p.id}`, { name: p.name, salt: p.salt, check: { iv: p.checkIv, ct: p.checkCt } })
  }
  pull(id: string, since: number) {
    return this.call<PullResult>('GET', `/api/profiles/${id}/rows?since=${since}`)
  }
  push(id: string, rows: RemoteRow[]) {
    return this.call<{ accepted: number }>('POST', `/api/profiles/${id}/rows`, { rows })
  }
  async deleteProfile(id: string) {
    await this.call('DELETE', `/api/profiles/${id}`)
  }
}
