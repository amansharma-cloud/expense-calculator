import { describe, expect, it } from 'vitest'
import { canonicalRedirect } from '../worker/host'

describe('optional redirect to the custom domain', () => {
  const host = 'money.example.com'
  it('does nothing unless a canonical host is configured', () => {
    expect(canonicalRedirect(new URL('https://expense-calculator.me.workers.dev/'), undefined)).toBeNull()
    expect(canonicalRedirect(new URL('https://expense-calculator.me.workers.dev/'), '')).toBeNull()
  })
  it('redirects workers.dev pages, keeping path and query', () => {
    expect(canonicalRedirect(new URL('https://expense-calculator.me.workers.dev/?a=1'), host)).toBe('https://money.example.com/?a=1')
    expect(canonicalRedirect(new URL('https://expense-calculator.me.workers.dev/login'), host)).toBe('https://money.example.com/login')
  })
  it('never redirects the API, the custom domain itself, or other hosts', () => {
    expect(canonicalRedirect(new URL('https://expense-calculator.me.workers.dev/api/me'), host)).toBeNull()
    expect(canonicalRedirect(new URL('https://money.example.com/'), host)).toBeNull()
    expect(canonicalRedirect(new URL('http://localhost:8787/'), host)).toBeNull()
  })
})
