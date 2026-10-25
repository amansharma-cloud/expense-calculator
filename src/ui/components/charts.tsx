import { Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { DayPoint } from '../../engine/budget'
import { shortDate } from '../../engine/dates'
import { getCurrency } from '../../engine/currency'
import { formatMoney } from '../../engine/money'
import type { Paise } from '../../engine/types'

const axis = { fontSize: 11, fill: 'var(--muted)' }
const compact = (paise: number) => {
  const r = paise / 100
  const a = Math.abs(r)
  if (getCurrency().group === 'indian' && a >= 100000) return `${+(r / 100000).toFixed(1)}L`
  if (a >= 1_000_000) return `${+(r / 1_000_000).toFixed(1)}M`
  return a >= 1000 ? `${+(r / 1000).toFixed(1)}k` : String(Math.round(r))
}

function Tip({ active, payload, label, rows }: { active?: boolean; payload?: { payload: Record<string, number | string> }[]; label?: string; rows: [string, string][] }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="tip">
      <b>{shortDate(String(label ?? p.date))}</b>
      {rows.map(([name, key]) => <div key={key} className="num">{name}: {formatMoney(Number(p[key]), { decimals: false })}</div>)}
    </div>
  )
}

/** Daily spend bars with the day's limit as a reference line. */
export function DailySpendChart({ series, limit }: { series: DayPoint[]; limit: Paise }) {
  const data = series.map((d) => ({ ...d, spent: Math.max(0, d.spentPaise) }))
  return (
    <div className="chart" role="img" aria-label="Daily spending compared with the recommended daily limit">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="date" tick={axis} tickFormatter={(d) => String(d).slice(8)} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={14} />
          <YAxis tick={axis} tickFormatter={compact} tickLine={false} axisLine={false} width={44} />
          <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<Tip rows={[['Spent', 'spent']]} />} />
          {limit > 0 && <ReferenceLine y={limit} stroke="var(--s2)" strokeDasharray="5 4" label={{ value: 'limit', position: 'insideTopRight', fill: 'var(--ink-2)', fontSize: 11 }} />}
          <Bar dataKey="spent" fill="var(--s1)" radius={[4, 4, 0, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Remaining spendable budget day by day vs. an even burn-down. */
export function RemainingChart({ series }: { series: DayPoint[] }) {
  return (
    <div className="chart" role="img" aria-label="Remaining budget over the cycle compared with an even pace">
      <ResponsiveContainer>
        <LineChart data={series} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="date" tick={axis} tickFormatter={(d) => String(d).slice(8)} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={14} />
          <YAxis tick={axis} tickFormatter={compact} tickLine={false} axisLine={false} width={44} />
          <Tooltip content={<Tip rows={[['Remaining', 'remainingPaise'], ['Even pace', 'idealRemainingPaise']]} />} />
          <Line dataKey="idealRemainingPaise" stroke="var(--muted)" strokeDasharray="5 4" dot={false} strokeWidth={2} />
          <Line dataKey="remainingPaise" stroke="var(--s1)" dot={false} strokeWidth={2.5} activeDot={{ r: 5, stroke: 'var(--surface)', strokeWidth: 2 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export function Legend({ items }: { items: [string, string][] }) {
  return <div className="legend">{items.map(([c, l]) => <span key={l}><i style={{ background: c }} />{l}</span>)}</div>
}

/** Ranked horizontal bars; one hue, the label names the category (no colour-only identity). */
export function CategoryBars({ rows, max = 8 }: { rows: { category: string; paise: Paise }[]; max?: number }) {
  if (!rows.length) return <p className="muted">No spending yet.</p>
  const shown = rows.slice(0, max)
  const rest = rows.slice(max).reduce((s, r) => s + r.paise, 0)
  const list = rest > 0 ? [...shown, { category: `Other (${rows.length - max})`, paise: rest }] : shown
  const top = Math.max(...list.map((r) => r.paise), 1)
  const total = rows.reduce((s, r) => s + r.paise, 0) || 1
  return (
    <div role="list" aria-label="Spending by category">
      {list.map((r) => (
        <div className="hbar" role="listitem" key={r.category} title={`${r.category}: ${formatMoney(r.paise)}`}>
          <span className="name">{r.category}</span>
          <span className="track"><i style={{ width: `${Math.max(2, (r.paise / top) * 100)}%` }} /></span>
          <span className="num"><b>{formatMoney(r.paise)}</b> <span className="muted small">{Math.round((r.paise / total) * 100)}%</span></span>
        </div>
      ))}
    </div>
  )
}

/** Budget vs actual per month (cycle history). */
export function MonthlyChart({ rows }: { rows: { label: string; spendable: number; spent: number }[] }) {
  return (
    <div className="chart tall" role="img" aria-label="Spendable budget and actual spending for each cycle">
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <YAxis tick={axis} tickFormatter={(v) => compact(Number(v))} tickLine={false} axisLine={false} width={48} />
          <Tooltip cursor={{ fill: 'var(--surface-2)' }} formatter={(v) => formatMoney(Number(v))} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10 }} />
          <Bar dataKey="spendable" name="Budget" fill="var(--s3)" radius={[4, 4, 0, 0]} maxBarSize={26} />
          <Bar dataKey="spent" name="Spent" fill="var(--s1)" radius={[4, 4, 0, 0]} maxBarSize={26} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
