import { describe, expect, it } from 'vitest'
import { TOUR_STEPS } from '../src/ui/tourSteps'

const files = import.meta.glob('../src/ui/**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const source = Object.values(files).join('\n')
const ROUTES = ['dashboard', 'transactions', 'budget', 'reports', 'settings']

describe('guided tour steps', () => {
  it('has unique ids, a welcome first and a closing message last (both without a target)', () => {
    expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(TOUR_STEPS.length)
    expect(TOUR_STEPS[0].target).toBeUndefined()
    expect(TOUR_STEPS[TOUR_STEPS.length - 1].target).toBeUndefined()
  })
  it('only uses real pages and every step has text', () => {
    for (const s of TOUR_STEPS) {
      expect(ROUTES).toContain(s.route)
      expect(s.title.length).toBeGreaterThan(2)
      expect(s.body.length).toBeGreaterThan(10)
    }
  })
  it('every target is a data-tour attribute that exists in the UI code', () => {
    for (const s of TOUR_STEPS.filter((x) => x.target)) {
      const m = /^\[data-tour="([\w-]+)"\]$/.exec(s.target!)
      expect(m, s.id).not.toBeNull()
      expect(source, s.id).toContain(`data-tour="${m![1]}"`)
    }
  })
})
