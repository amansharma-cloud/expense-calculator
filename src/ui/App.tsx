import { lazy, Suspense, useEffect, useState } from 'react'
import { formatMoney } from '../engine/money'
import type { TxType } from '../engine/types'
import { useStore } from '../state/store'
import { Icon, Modal, useToast } from './components/common'
import { effectiveMotion } from './motion'
import { AutoBackupRunner } from './components/DataHealth'
import { ExpenseForm } from './components/ExpenseForm'
import { Dashboard } from './pages/Dashboard'
import { NewCycle, ProfilePicker, Setup } from './pages/Gate'

const Budget = lazy(() => import('./pages/Budget').then((m) => ({ default: m.Budget })))
const Reports = lazy(() => import('./pages/Reports').then((m) => ({ default: m.Reports })))
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })))
const Transactions = lazy(() => import('./pages/Transactions').then((m) => ({ default: m.Transactions })))

const ROUTES = [
  ['dashboard', 'Dashboard', 'home'],
  ['add', 'Add', 'plus'],
  ['transactions', 'History', 'list'],
  ['budget', 'Budget', 'wallet'],
  ['reports', 'Reports', 'chart'],
  ['settings', 'Settings', 'cog'],
] as const
type Route = (typeof ROUTES)[number][0]

const readRoute = (): Route => {
  const r = window.location.hash.replace(/^#\/?/, '') as Route
  return ROUTES.some((x) => x[0] === r) ? r : 'dashboard'
}

export function App() {
  const store = useStore()
  const { ready, active, data, cycle, plan, addTx, budget } = store
  const toast = useToast()
  const [route, setRoute] = useState<Route>(readRoute())
  const [adding, setAdding] = useState(false)
  const [addType, setAddType] = useState<TxType | undefined>(undefined)
  const openAdd = (t?: TxType) => { setAddType(t); setAdding(true) }

  useEffect(() => {
    const on = () => setRoute(readRoute())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])

  useEffect(() => {
    if (plan.theme === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', plan.theme)
  }, [plan.theme])

  // set during render so child effects (count-ups) already see the right level
  if (typeof document !== 'undefined') {
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    document.documentElement.dataset.motion = effectiveMotion(plan.motion, reduced)
    if (plan.motion) document.documentElement.dataset.motionExplicit = '1'
    else delete document.documentElement.dataset.motionExplicit
  }

  if (!ready) return <div className="gate"><p className="muted">Loading…</p></div>
  if (!active) return <ProfilePicker />
  if (!data.plan && data.cycles.length === 0) return <Setup />
  if (!cycle) return <NewCycle />

  const saveNew = async (d: Parameters<typeof addTx>[0]) => {
    await addTx(d)
    setAdding(false)
    if (route === 'add') window.location.hash = '#/dashboard'
    toast(`Saved ${formatMoney(d.amountPaise)} · ${d.category}`)
  }

  const page = () => {
    switch (route) {
      case 'add': return <div className="stack"><div className="page-head"><h1>Add expense</h1></div><div className="card"><ExpenseForm onSaved={(d) => void saveNew(d)} /></div></div>
      case 'transactions': return <Transactions />
      case 'budget': return <Budget />
      case 'reports': return <Reports />
      case 'settings': return <Settings />
      default: return <Dashboard onAdd={openAdd} />
    }
  }

  return (
    <div className="app">
      <nav className="nav" aria-label="Main">
        <div className="brand"><img src="./favicon.svg" alt="" />Daily Spend</div>
        {ROUTES.map(([id, label, icon]) => (
          <a key={id} href={`#/${id}`} aria-current={route === id ? 'page' : undefined}><Icon name={icon} />{label}</a>
        ))}
        <div className="side-foot">
          <button className="who" onClick={() => { window.location.hash = '#/settings' }} aria-label={`Profile ${active.name}`}>
            <span className="avatar">{active.name[0]?.toUpperCase()}</span>{active.name}
          </button>
          <p style={{ marginTop: 10 }}>Data stays on this device.</p>
        </div>
      </nav>
      <main className="main" id="main">
        {route !== 'settings' && (
          <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 8 }}>
            <a className="who" href="#/settings" style={{ textDecoration: 'none', color: 'inherit' }} aria-label={`Profile: ${active.name}. Open settings`}>
              <span className="avatar">{active.name[0]?.toUpperCase()}</span><span className="small">{active.name}</span>
            </a>
          </div>
        )}
        <Suspense fallback={<div className="stack"><div className="skeleton" style={{ height: 56, width: '50%' }} /><div className="skeleton" style={{ height: 180 }} /><div className="skeleton" style={{ height: 180 }} /></div>}>{page()}</Suspense>
      </main>
      {route !== 'add' && <button className="fab" onClick={() => openAdd()} aria-label="Add expense"><Icon name="plus" /></button>}
      {adding && (
        <Modal title={addType === 'income' ? 'Add money' : 'Add expense'} onClose={() => setAdding(false)}>
          <ExpenseForm defaultType={addType} onSaved={(d) => void saveNew(d)} onCancel={() => setAdding(false)} />
        </Modal>
      )}
      <AutoBackupRunner />
      <span className="sr" aria-live="polite">{budget ? `Today's limit ${formatMoney(budget.todayLimitPaise)}` : ''}</span>
    </div>
  )
}
