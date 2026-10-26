import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { DayPoint } from '../../engine/budget'
import { shortDate } from '../../engine/dates'
import { getCurrency } from '../../engine/currency'
import { formatMoney } from '../../engine/money'
import type { Paise } from '../../engine/types'
import { categoryStyle } from '../categoryStyle'
import { CatIcon } from './CatIcon'

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

/** Daily spend as rounded pill bars; today glows. The dashed line is the day's limit. */
export function DailySpendChart({ series, limit }: { series: DayPoint[]; limit: Paise }) {
  const data = series.map((d) => ({ ...d, spent: Math.max(0, d.spentPaise) }))
  const lastDate = data.length ? data[data.length - 1].date : ''
  return (
    <div className="chart" role="img" aria-label="Daily spending compared with the recommended daily limit">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} barCategoryGap="22%">
          <defs>
            <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" />
              <stop offset="100%" stopColor="var(--accent-2)" />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--line)" vertical={false} strokeDasharray="3 5" />
          <XAxis dataKey="date" tick={axis} tickFormatter={(d) => String(d).slice(8)} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={14} />
          <YAxis tick={axis} tickFormatter={compact} tickLine={false} axisLine={false} width={44} />
          <Tooltip cursor={{ fill: 'var(--surface-2)', radius: 8 }} content={<Tip rows={[['Spent', 'spent']]} />} />
          {limit > 0 && <ReferenceLine y={limit} stroke="var(--s2)" strokeDasharray="5 4" label={{ value: 'limit', position: 'insideTopRight', fill: 'var(--ink-2)', fontSize: 11 }} />}
          <Bar dataKey="spent" radius={[999, 999, 999, 999]} maxBarSize={14} minPointSize={3} animationDuration={900}>
            {data.map((d) => <Cell key={d.date} fill="url(#barGrad)" fillOpacity={d.date === lastDate ? 1 : 0.55} style={d.date === lastDate ? { filter: 'drop-shadow(0 0 8px var(--accent))' } : undefined} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Remaining spendable budget day by day (filled area) vs an even burn-down (dashed). */
export function RemainingChart({ series }: { series: DayPoint[] }) {
  return (
    <div className="chart" role="img" aria-label="Remaining budget over the cycle compared with an even pace">
      <ResponsiveContainer>
        <ComposedChart data={series} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.45} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--line)" vertical={false} strokeDasharray="3 5" />
          <XAxis dataKey="date" tick={axis} tickFormatter={(d) => String(d).slice(8)} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={14} />
          <YAxis tick={axis} tickFormatter={compact} tickLine={false} axisLine={false} width={44} />
          <Tooltip content={<Tip rows={[['Remaining', 'remainingPaise'], ['Even pace', 'idealRemainingPaise']]} />} />
          <Line dataKey="idealRemainingPaise" stroke="var(--muted)" strokeDasharray="5 4" dot={false} strokeWidth={2} isAnimationActive={false} />
          <Area dataKey="remainingPaise" stroke="var(--accent)" strokeWidth={2.5} fill="url(#areaGrad)" activeDot={{ r: 5, stroke: 'var(--bg)', strokeWidth: 2 }} animationDuration={1000} />
        </ComposedChart>
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

/** Spending by category: donut with the total in the middle and a legend with icons, shares and amounts. */
export function SpendDonut({ rows, max = 5 }: { rows: { category: string; paise: Paise }[]; max?: number }) {
  if (!rows.length) return <p className="muted">No spending yet this cycle.</p>
  const total = rows.reduce((s, r) => s + r.paise, 0) || 1
  const top = rows.slice(0, max)
  const rest = rows.slice(max).reduce((s, r) => s + r.paise, 0)
  const slices = rest > 0 ? [...top, { category: `Other (${rows.length - max})`, paise: rest }] : top
  const colour = (name: string, i: number) => (name.startsWith('Other (') ? 'var(--muted)' : categoryStyle(name).color === 'var(--muted)' ? `var(--s${(i % 8) + 1})` : categoryStyle(name).color)
  return (
    <div className="donut-host">
    <div className="donut">
      <div className="donut-chart" role="img" aria-label="Spending by category">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={slices} dataKey="paise" nameKey="category" innerRadius="64%" outerRadius="94%" paddingAngle={slices.length > 1 ? 3 : 0} cornerRadius={6} stroke="none" startAngle={90} endAngle={-270} animationDuration={1100}>
              {slices.map((s, i) => <Cell key={s.category} fill={colour(s.category, i)} />)}
            </Pie>
            <Tooltip formatter={(v) => formatMoney(Number(v))} contentStyle={{ background: 'var(--modal)', border: '1px solid var(--line)', borderRadius: 12 }} />
          </PieChart>
        </ResponsiveContainer>
        <div className="donut-center"><span>Total spent</span><b className="num">{formatMoney(total)}</b></div>
      </div>
      <ul className="legend-list">
        {slices.map((s, i) => (
          <li key={s.category}>
            {s.category.startsWith('Other (') ? <span className="cat-icon" style={{ '--c': 'var(--muted)', width: 32, height: 32 } as React.CSSProperties} /> : <CatIcon name={s.category} size={32} />}
            <span className="dot" style={{ background: colour(s.category, i) }} aria-hidden="true" />
            <span className="grow ln">{s.category}</span>
            <span className="muted small num">{Math.round((s.paise / total) * 100)}%</span>
            <b className="num">{formatMoney(s.paise)}</b>
          </li>
        ))}
      </ul>
    </div>
    </div>
  )
}
