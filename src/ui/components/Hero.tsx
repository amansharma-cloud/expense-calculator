import { useEffect, useId, useState } from 'react'
import { cycleLabel, shortDate } from '../../engine/dates'
import { formatMoney } from '../../engine/money'
import type { BudgetResult, Cycle } from '../../engine/types'
import { useCountUp } from '../useCountUp'
import { Icon, StatusChip } from './common'

/** Limits are shown in whole units, rounded down, so the app never nudges you to overspend. */
const whole = (paise: number) => Math.floor(paise / 100) * 100

function Ring({ pct, over }: { pct: number; over: boolean }) {
  const id = useId()
  const r = 54
  const c = 2 * Math.PI * r
  // start empty, then grow to the real value so the CSS transition animates it
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const t = requestAnimationFrame(() => setShown(pct))
    return () => cancelAnimationFrame(t)
  }, [pct])
  const pctInt = Math.round(useCountUp(pct * 100, 1000))
  return (
    <div className="ring2" role="img" aria-label={`${Math.round(pct * 100)} percent of today's limit used`}>
      <svg viewBox="0 0 132 132" aria-hidden="true">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={over ? '#ff9a9a' : '#9ff5e6'} />
            <stop offset="100%" stopColor={over ? '#ff5d5d' : '#5eead4'} />
          </linearGradient>
        </defs>
        <circle cx="66" cy="66" r={r} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="12" />
        <circle className="ring2-arc" cx="66" cy="66" r={r} fill="none" stroke={`url(#${id})`} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, shown))} transform="rotate(-90 66 66)" />
      </svg>
      <div className="ring2-center"><b className="num">{pctInt}%</b><span>of today</span></div>
    </div>
  )
}

export function Hero({ b, cycle, over, onAdd }: { b: BudgetResult; cycle: Cycle; over: boolean; onAdd: () => void }) {
  const amount = useCountUp(whole(Math.abs(b.todayRemainingPaise)), 1100)
  const limitPct = b.todayLimitPaise > 0 ? Math.max(0, b.todaySpentPaise) / b.todayLimitPaise : b.todaySpentPaise > 0 ? 1 : 0
  return (
    <section className="hero2 glass reveal" style={{ '--i': 0 } as React.CSSProperties} aria-label="Today">
      <div className="hero2-glow" aria-hidden="true" />
      <div className="hero2-top">
        <div className="hero2-copy">
          <div className="eyebrow">{over ? 'You are over today’s limit by' : 'You can still spend today'}</div>
          <div className="hero2-amount num">{formatMoney(Math.round(amount / 100) * 100)}</div>
          <div className="hero2-sub">Today’s limit {formatMoney(whole(b.todayLimitPaise))} · spent {formatMoney(whole(Math.max(0, b.todaySpentPaise)))}</div>
          <div className="hero2-actions">
            <button className="btn-white" onClick={onAdd}><Icon name="plus" size={18} /> Add expense</button>
            <StatusChip status={b.status} />
          </div>
        </div>
        <Ring pct={limitPct} over={over} />
      </div>
      <div className="hero2-meta">
        <div><span>Left this cycle</span><b className="num">{formatMoney(b.remainingPaise)}</b></div>
        <div><span>Days to next pay</span><b className="num">{b.daysLeft}</b></div>
        <div><span>Next payday</span><b className="num">{shortDate(cycle.end)}</b></div>
      </div>
      <div className="hero2-cycle">{cycle.label ?? 'Pay cycle'} · {cycleLabel(cycle.start, cycle.end)} · day {b.dayNumber} of {b.cycleDays}</div>
    </section>
  )
}
