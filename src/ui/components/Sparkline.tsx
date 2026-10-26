import { useId } from 'react'

/** Small smooth area line (no axes). Draws itself in "rich" motion mode. */
export function Sparkline({ values, height = 64, label }: { values: number[]; height?: number; label: string }) {
  const id = useId()
  const w = 300
  const pts = values.length >= 2 ? values : [values[0] ?? 0, values[0] ?? 0]
  const min = Math.min(...pts)
  const max = Math.max(...pts)
  const span = max - min || 1
  const x = (i: number) => 8 + (i / (pts.length - 1)) * (w - 16)
  // a flat series sits in the middle instead of on the bottom edge
  const y = (v: number) => (max === min ? height / 2 : height - 8 - ((v - min) / span) * (height - 18))
  // smooth path through the points (Catmull-Rom → cubic Bézier)
  let d = `M ${x(0)} ${y(pts[0])}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? pts[i + 1]
    const x1 = x(i) + (x(i + 1) - x(i > 0 ? i - 1 : i)) / 6
    const y1 = y(p1) + (y(p2) - y(p0)) / 6
    const x2 = x(i + 1) - (x(i + 2 > pts.length - 1 ? i + 1 : i + 2) - x(i)) / 6
    const y2 = y(p2) - (y(p3) - y(p1)) / 6
    d += ` C ${x1} ${y1}, ${x2} ${y2}, ${x(i + 1)} ${y(p2)}`
  }
  const last = pts.length - 1
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" role="img" aria-label={label} style={{ height }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.38" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <clipPath id={`${id}c`}><rect className="spark-reveal" x="0" y="-10" width={w} height={height + 20} /></clipPath>
      <g clipPath={`url(#${id}c)`}>
        <path d={`${d} L ${w} ${height} L 0 ${height} Z`} fill={`url(#${id})`} />
        <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <circle cx={x(last)} cy={y(pts[last])} r="4.5" fill="var(--accent)" stroke="var(--bg)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </g>
    </svg>
  )
}
