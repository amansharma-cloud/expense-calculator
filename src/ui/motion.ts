/** Pure helpers for animation and greetings (no React, easy to test). */

export type MotionMode = 'standard' | 'rich' | 'off'

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3)
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** Value shown `elapsed` ms into a count-up from `from` to `to` lasting `duration` ms. */
export function countUpValue(from: number, to: number, elapsed: number, duration: number): number {
  if (duration <= 0 || elapsed >= duration) return to
  return lerp(from, to, easeOutCubic(elapsed / duration))
}

/** "Good morning" etc. from the local hour. */
export function greeting(now: Date = new Date()): string {
  const h = now.getHours()
  if (h >= 5 && h < 12) return 'Good morning'
  if (h >= 12 && h < 17) return 'Good afternoon'
  if (h >= 17 && h < 22) return 'Good evening'
  return 'Hello'
}

/** Motion is off if the person chose Off or their device asks for reduced motion. */
export function effectiveMotion(setting: MotionMode | undefined, prefersReduced: boolean): MotionMode {
  if (prefersReduced) return 'off'
  return setting ?? 'standard'
}
