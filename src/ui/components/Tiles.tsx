import { useState } from 'react'
import type { Tip } from '../../engine/insights'
import { useCountUp } from '../useCountUp'
import { Icon } from './common'

/** Number tile with a soft icon badge, a count-up value and an optional trend chip. */
export function KpiTile({ label, value, format, icon, color, sub, trend, bar, index = 0 }: {
  label: string
  value: number
  format: (n: number) => string
  icon: string
  /** CSS colour for the icon badge */
  color: string
  sub?: string
  trend?: { text: string; tone: 'good' | 'warn' | 'info'; down?: boolean }
  /** 0–100 progress bar shown under the value */
  bar?: { pct: number; cls?: string }
  index?: number
}) {
  const shown = useCountUp(value, 1000)
  return (
    <div className="card kpi reveal" style={{ '--i': index + 2, '--c': color } as React.CSSProperties}>
      <div className="kpi-top">
        <span className="kpi-ic" aria-hidden="true"><Icon name={icon} size={20} /></span>
        {trend && <span className={`chip small ${trend.tone}`}><Icon name={trend.down ? 'down' : 'up'} size={12} /> {trend.text}</span>}
      </div>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value num">{format(shown)}</div>
      {bar && <div className={`bar ${bar.cls ?? ''}`} role="progressbar" aria-valuenow={Math.round(bar.pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}><i style={{ width: `${Math.min(100, bar.pct)}%` }} /></div>}
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  )
}

export function QuickActions({ onAdd, onPay }: { onAdd: () => void; onPay: () => void }) {
  const items: { label: string; icon: string; color: string; onClick?: () => void; href?: string }[] = [
    { label: 'Add expense', icon: 'plus', color: 'var(--s2)', onClick: onAdd },
    { label: 'Pay bills', icon: 'check', color: 'var(--s1)', onClick: onPay },
    { label: 'Import', icon: 'upload', color: 'var(--s7)', href: '#/settings' },
    { label: 'Backup', icon: 'download', color: 'var(--s3)', href: '#/settings' },
  ]
  return (
    <nav data-tour="quick" className="quick reveal" style={{ '--i': 2 } as React.CSSProperties} aria-label="Quick actions">
      {items.map((it) => {
        const inner = (<><span className="qa-ic" style={{ '--c': it.color } as React.CSSProperties}><Icon name={it.icon} size={22} /></span><span>{it.label}</span></>)
        return it.href
          ? <a key={it.label} className="qa" href={it.href}>{inner}</a>
          : <button key={it.label} className="qa" onClick={it.onClick}>{inner}</button>
      })}
    </nav>
  )
}

/** One helpful, plain-language observation computed from your own numbers. */
export function SmartTipCard({ tips }: { tips: Tip[] }) {
  const [i, setI] = useState(0)
  const tip = tips[i % tips.length]
  return (
    <section className={`card tipcard tone-${tip.tone} reveal`} style={{ '--i': 6 } as React.CSSProperties} aria-label="Smart tip">
      <span className="tip-ic" aria-hidden="true"><Icon name="spark" size={22} /></span>
      <div className="tip-body">
        <div className="eyebrow">Smart tip</div>
        <p>{tip.text}</p>
      </div>
      {tips.length > 1 && <button className="btn ghost sm" onClick={() => setI(i + 1)}>Next tip</button>}
    </section>
  )
}
