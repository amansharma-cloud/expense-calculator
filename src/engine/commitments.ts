import type { Allocation, Paise } from './types'

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

export interface CommitmentMatch {
  allocation: Allocation
  /** True when the name matches AND the amount is close to the planned amount (50%–150%), so it can be linked automatically. */
  confident: boolean
}

/**
 * Does this payment look like one of the set-asides (rent, EMI, SIP…)? Used to count a payment against the
 * commitment instead of as spending. The name must appear in the description or equal the category;
 * only a plausible amount makes the match "confident" (so "Mom gift 500" is not mistaken for the monthly transfer to Mom).
 */
export function matchAllocation(description: string, category: string, amountPaise: Paise, allocations: Allocation[]): CommitmentMatch | null {
  const tokens = new Set(norm(`${description} ${category}`).split(' ').filter(Boolean))
  const cat = norm(category)
  let weak: CommitmentMatch | null = null
  for (const a of allocations) {
    if (a.amountPaise <= 0) continue
    const name = norm(a.name)
    if (!name) continue
    const hit = cat === name || name.split(' ').every((t) => tokens.has(t))
    if (!hit) continue
    const ratio = amountPaise / a.amountPaise
    if (ratio >= 0.5 && ratio <= 1.5) return { allocation: a, confident: true }
    weak ??= { allocation: a, confident: false }
  }
  return weak
}
