import type { ReactNode } from 'react'
import { Icon } from './common'

/** Card heading with a tinted icon tile, a title, an optional hint and an optional right-hand slot. */
export function SectionHead({ icon, color = 'var(--accent)', title, hint, right }: { icon: string; color?: string; title: string; hint?: ReactNode; right?: ReactNode }) {
  return (
    <div className="sec-head">
      <span className="sec-ic" style={{ '--c': color } as React.CSSProperties} aria-hidden="true"><Icon name={icon} size={20} /></span>
      <div className="sec-text"><h2>{title}</h2>{hint && <p className="hint">{hint}</p>}</div>
      {right && <div className="sec-right">{right}</div>}
    </div>
  )
}

/** Friendly empty state with a small inline illustration (no images to download). */
export function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <svg viewBox="0 0 120 96" width="120" height="96" aria-hidden="true">
        <defs>
          <linearGradient id="emptyG" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="var(--accent)" /><stop offset="100%" stopColor="var(--accent-2)" /></linearGradient>
        </defs>
        <ellipse cx="60" cy="86" rx="38" ry="6" fill="var(--line)" />
        <rect x="18" y="26" width="84" height="54" rx="14" fill="url(#emptyG)" opacity=".92" />
        <rect x="18" y="38" width="84" height="12" fill="rgba(0,0,0,.18)" />
        <rect x="74" y="54" width="22" height="14" rx="7" fill="rgba(255,255,255,.9)" />
        <circle cx="85" cy="61" r="3" fill="var(--accent)" />
        <path d="M30 26 l10 -14 h40 l10 14" fill="none" stroke="url(#emptyG)" strokeWidth="5" strokeLinejoin="round" opacity=".6" />
        <path d="M100 10v10M95 15h10" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <h3>{title}</h3>
      <p className="muted">{text}</p>
      {action}
    </div>
  )
}
