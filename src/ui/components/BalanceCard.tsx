import { useState } from 'react'
import { balanceSeries, balanceSummary } from '../../engine/budget'
import { getCurrency } from '../../engine/currency'
import { formatMoney } from '../../engine/money'
import { useStore } from '../../state/store'
import { useCountUp } from '../useCountUp'
import { MoneyInput } from './AllocationEditor'
import { Sparkline } from './Sparkline'
import { Alert, useToast } from './common'

/**
 * "How much is left": carry-over + this cycle's money − what is spent or still to pay (the Excel tracker's Balance),
 * plus a check against the real bank balance.
 */
export function BalanceCard() {
  const { cycle, data, today, addTx } = useStore()
  const toast = useToast()
  const [bank, setBank] = useState(0)
  const [checked, setChecked] = useState(false)
  if (!cycle) return null
  const b = balanceSummary(cycle, data.transactions, data.planned)
  const series = balanceSeries(cycle, data.transactions, today).map((p) => p.paise)
  const startBal = series[0] ?? b.inAccountNowPaise
  const change = b.inAccountNowPaise - startBal
  const nowShown = useCountUp(b.inAccountNowPaise, 1100)
  const afterShown = useCountUp(b.afterPlanPaise, 1100)
  const diff = bank - b.inAccountNowPaise
  const neg = (n: number) => (n < 0 ? { color: 'var(--bad)' } : undefined)

  const record = async () => {
    await addTx({
      date: today, time: new Date().toTimeString().slice(0, 5), amountPaise: Math.abs(diff), type: diff < 0 ? 'expense' : 'income',
      category: 'Adjustment', merchant: 'Balance adjustment', method: 'other', note: `Matched to the bank balance (${formatMoney(bank)})`, source: 'manual',
    })
    setChecked(false)
    toast('Adjustment recorded; the tracker now matches your bank')
  }

  const rows: [string, number, '+' | '−' | '=', boolean?][] = [
    ['Carry-over from the last cycle', b.openingCarryPaise, '+'],
    ['Salary & other money this cycle', b.incomePaise, '+'],
    ['Set-asides already paid (rent, EMIs, investments)', b.setAsidePaidPaise, '−'],
    ['Spending so far', b.spentPaise, '−'],
    ['In your account now', b.inAccountNowPaise, '=', true],
    ['Set-asides still to pay', b.setAsideDuePaise, '−'],
    ['Bills still expected (estimates)', b.plannedDuePaise, '−'],
    ['After everything planned', b.afterPlanPaise, '=', true],
  ]

  return (
    <section className="card balance glass reveal" style={{ '--i': 1 } as React.CSSProperties} aria-label="Account balance">
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="eyebrow muted">Account balance</div>
          <div className="balance-amount num" style={neg(b.inAccountNowPaise)}>{formatMoney(Math.round(nowShown))}</div>
          <div className="small muted">in your account now</div>
        </div>
        <span className={`chip ${change < 0 ? 'warn' : 'good'}`} title="Change since the cycle started">{change < 0 ? '▼' : '▲'} {formatMoney(Math.abs(change))} this cycle</span>
      </div>
      <Sparkline values={series} label="Account balance over this cycle" />
      <div className="balance-after">
        <div>
          <div className="small muted">After everything planned</div>
          <div className="num" style={{ fontSize: '1.25rem', fontWeight: 700, ...neg(b.afterPlanPaise) }}>{formatMoney(Math.round(afterShown))}</div>
        </div>
        <div className="small muted" style={{ maxWidth: 260 }}>what you will have once the set-asides and bills still to pay are done: your old sheet’s Balance</div>
      </div>

      <details>
        <summary>How it adds up</summary>
        <table className="explain" style={{ marginTop: 8 }}>
          <tbody>
            {rows.map(([label, paise, sign, total]) => (
              <tr key={label} className={total ? 'eq' : ''}>
                <td className="sign">{sign}</td>
                <td>{label}</td>
                <td className="num" style={neg(total ? paise : 0)}>{formatMoney(paise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint" style={{ marginTop: 6 }}>Transfers are ignored, refunds add back, and money you chose to release from carry-over is not extra money, so it doesn’t change these numbers.</p>
      </details>

      <details style={{ marginTop: 10 }} onToggle={(e) => { if (!(e.target as HTMLDetailsElement).open) setChecked(false) }}>
        <summary>Check against my bank balance</summary>
        <div className="stack" style={{ marginTop: 8 }}>
          <div className="field">
            <label className="lbl" htmlFor="bankbal">Balance your bank shows right now ({getCurrency().symbol})</label>
            <div className="row">
              <div style={{ flex: '1 1 180px' }}><MoneyInput id="bankbal" label="Bank balance" value={bank} onChange={(p) => { setBank(p ?? 0); setChecked(false) }} /></div>
              <button className="btn" disabled={bank <= 0} onClick={() => setChecked(true)}>Compare</button>
            </div>
          </div>
          {checked && diff === 0 && <Alert kind="good">Matches: the tracker and your bank agree.</Alert>}
          {checked && diff < 0 && (
            <Alert kind="warn">
              Your bank shows <b>{formatMoney(-diff)} less</b> than the tracker. Some spending is probably missing. Add the missing expenses, or record the gap as one adjustment.
              <div style={{ marginTop: 8 }}><button className="btn sm" onClick={record}>Record {formatMoney(-diff)} as spending</button></div>
            </Alert>
          )}
          {checked && diff > 0 && (
            <Alert kind="info">
              Your bank shows <b>{formatMoney(diff)} more</b> than the tracker. Some money in (interest, a refund, a payout) may be missing.
              <div style={{ marginTop: 8 }}><button className="btn sm" onClick={record}>Record {formatMoney(diff)} as money in</button></div>
            </Alert>
          )}
          <p className="hint">The comparison uses “in your account now”, not the after-plan figure. An adjustment is saved as a normal transaction you can edit or delete in History.</p>
        </div>
      </details>
    </section>
  )
}
