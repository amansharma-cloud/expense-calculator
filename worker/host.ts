/**
 * Optional: once everyone has moved to the custom domain, send visitors of the old `*.workers.dev` address to it.
 * Off unless CANONICAL_HOST is set. Never touches /api (so old installs can still sync until they update).
 */
export function canonicalRedirect(url: URL, canonicalHost: string | undefined): string | null {
  if (!canonicalHost || url.hostname === canonicalHost || !url.hostname.endsWith('.workers.dev')) return null
  if (url.pathname.startsWith('/api/')) return null
  return `https://${canonicalHost}${url.pathname}${url.search}${url.hash}`
}
