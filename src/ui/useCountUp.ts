import { useEffect, useRef, useState } from 'react'
import { countUpValue } from './motion'

// App sets data-motion (already accounting for the device's reduce-motion setting and the person's choice)
const motionOff = () => typeof document !== 'undefined' && document.documentElement.dataset.motion === 'off'

/** Animates a number toward `target` (first time from 0). Shows the target immediately when motion is off. */
export function useCountUp(target: number, duration = 900): number {
  const [value, setValue] = useState(() => (motionOff() ? target : 0))
  const shown = useRef(value)
  shown.current = value
  useEffect(() => {
    if (motionOff()) { setValue(target); return }
    const from = shown.current
    if (from === target) return
    let raf = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      const v = countUpValue(from, target, now - t0, duration)
      setValue(v)
      if (now - t0 < duration) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return value
}
