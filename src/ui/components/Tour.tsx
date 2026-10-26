import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { TOUR_STEPS, type TourStep } from '../tourSteps'

interface Box { top: number; left: number; width: number; height: number }

const PAD = 6
const sameBox = (a: Box | null, b: Box | null) => (a === b) || (!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height)

/**
 * Step-by-step tour with a spotlight. Pure presentation: the parent decides when it is open, which page is showing
 * (`route`), how to change page (`go`) and what to do when it ends (`onClose`, `finished` = reached the last step).
 */
export function Tour({ steps = TOUR_STEPS, route, go, onClose }: {
  steps?: TourStep[]
  route: string
  go: (route: TourStep['route']) => void
  onClose: (finished: boolean) => void
}) {
  const [i, setI] = useState(0)
  const [box, setBox] = useState<Box | null>(null)
  const [cardH, setCardH] = useState(180)
  const card = useRef<HTMLDivElement>(null)
  const scrolledFor = useRef<string | null>(null)
  const step = steps[i]
  const last = i === steps.length - 1

  // the step may live on another page: go there first
  useEffect(() => { if (step.route !== route) go(step.route) }, [step.route, route, go])

  // follow the target every frame (it may appear late on a lazily loaded page, animate in, or move on resize)
  useEffect(() => {
    let raf = 0
    scrolledFor.current = null
    const tick = () => {
      const el = step.route === route && step.target ? document.querySelector<HTMLElement>(step.target) : null
      let next: Box | null = null
      if (el && el.getClientRects().length) {
        const r = el.getBoundingClientRect()
        if (scrolledFor.current !== step.id) {
          scrolledFor.current = step.id
          const narrow = window.innerWidth < 640
          const inView = r.top >= 0 && r.bottom <= window.innerHeight
          const fixed = getComputedStyle(el).position === 'fixed'
          if (!fixed && (!inView || narrow)) {
            window.scrollTo({ top: Math.max(0, window.scrollY + r.top - (narrow ? 70 : 90)), behavior: 'auto' })
          }
        }
        next = { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 }
      }
      setBox((prev) => (sameBox(prev, next) ? prev : next))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [step, route])

  useLayoutEffect(() => { if (card.current) setCardH(card.current.offsetHeight) }, [i, box])

  // keyboard: arrows move, Esc skips; focus the primary button on every step so screen readers read the new one
  const next = useCallback(() => (last ? onClose(true) : setI((n) => n + 1)), [last, onClose])
  const back = useCallback(() => setI((n) => Math.max(0, n - 1)), [])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(last) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); next() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); back() }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [next, back, onClose, last])
  useEffect(() => { card.current?.querySelector<HTMLElement>('[data-primary]')?.focus({ preventScroll: true }) }, [i])

  // where the card goes: next to the target on wide screens, docked top/bottom on phones, centred when there is no target
  const vw = window.innerWidth
  const vh = window.innerHeight
  const w = Math.min(360, vw - 24)
  let pos: React.CSSProperties
  if (!box) {
    pos = { top: Math.max(12, (vh - cardH) / 2), left: (vw - w) / 2 }
  } else if (vw < 640) {
    const dockTop = box.top + box.height / 2 > vh * 0.62
    pos = dockTop ? { top: 12, left: (vw - w) / 2 } : { top: Math.max(12, vh - cardH - 92), left: (vw - w) / 2 }
  } else {
    const below = box.top + box.height + 14
    const above = box.top - cardH - 14
    const left = Math.min(Math.max(12, box.left + box.width / 2 - w / 2), vw - w - 12)
    if (below + cardH <= vh - 12) pos = { top: below, left }
    else if (above >= 12) pos = { top: above, left }
    else pos = { top: Math.max(12, vh - cardH - 20), left: Math.min(Math.max(12, box.left + box.width + 16), vw - w - 12) } // tall target: park beside / over its lower part
  }

  return (
    <div className="tour" role="presentation">
      {box ? <div className="tour-spot" style={{ top: box.top, left: box.left, width: box.width, height: box.height }} aria-hidden="true" /> : <div className="tour-dim" aria-hidden="true" />}
      <div ref={card} className={`tour-card glass ${box ? '' : 'center'}`} style={{ ...pos, width: w }} role="dialog" aria-label={`Tour: ${step.title}`} aria-describedby="tour-body">
        <div className="tour-top">
          <span className="tour-step">Step {i + 1} of {steps.length}</span>
          {!last && <button type="button" className="tour-skip" onClick={() => onClose(false)}>Skip tour</button>}
        </div>
        <div className="tour-bar" role="progressbar" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={i + 1} aria-label="Tour progress"><i style={{ width: `${((i + 1) / steps.length) * 100}%` }} /></div>
        <h2 className="tour-title">{step.title}</h2>
        <p id="tour-body" className="tour-body">{step.body}</p>
        <div className="tour-actions">
          <button type="button" className="btn ghost sm" onClick={back} disabled={i === 0}>Back</button>
          <button type="button" className="btn primary sm" data-primary onClick={next}>{last ? 'Finish' : i === 0 ? 'Start tour' : 'Next'}</button>
        </div>
      </div>
    </div>
  )
}

/** The persistent round button that (re)starts the tour. */
export function TourButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="tour-btn" onClick={onClick} aria-label="Take a tour" data-label="Explore the application">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5" /><path d="M9.2 9.3a3 3 0 1 1 4.3 2.7c-.9.5-1.5 1-1.5 2" /><path d="M12 17.2h.01" /></svg>
    </button>
  )
}
