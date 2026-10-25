import { useEffect, useState } from 'react'
import { formatINR } from '../engine/money'
import { useStore } from '../state/store'
import { Icon, Modal, useToast } from './components/common'
import { AutoBackupRunner } from './components/DataHealth'
import { ExpenseForm } from './components/ExpenseForm'
import { Budget } from './pages/Budget'
import { Dashboard } from './pages/Dashboard'
import { NewCycle, ProfilePicker, Setup } from './pages/Gate'
import { Reports } from './pages/Reports'
import { Settings } from './pages/Settings'
import { Transactions } from './pages/Transactions'

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

  useEffect(() => {
    const on = () => setRoute(readRoute())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])

  useEffect(() => {
    if (plan.theme === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', plan.theme)
  }, [plan.theme])

  if (!ready) return <div className="gate"><p className="muted">Loading…</p></div>
  if (!active) return <ProfilePicker />
  if (!data.plan && data.cycles.length === 0) return <Setup />
  if (!cycle) return <NewCycle />

  const saveNew = async (d: Parameters<typeof addTx>[0]) => {
    await addTx(d)
    setAdding(false)
    if (route === 'add') window.location.hash = '#/dashboard'
    toast(`Saved ${formatINR(d.amountPaise)} · ${d.category}`)
  }

  const page = () => {
    switch (route) {
      case 'add': return <div className="stack"><div className="page-head"><h1>Add expense</h1></div><div className="card"><ExpenseForm onSaved={(d) => void saveNew(d)} /></div></div>
      case 'transactions': return <Transactions />
      case 'budget': return <Budget />
      case 'reports': return <Reports />
      case 'settings': return <Settings />
      default: return <Dashboard onAdd={() => setAdding(true)} />
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
        {page()}
      </main>
      {route !== 'add' && <button className="fab" onClick={() => setAdding(true)} aria-label="Add expense"><Icon name="plus" /></button>}
      {adding && (
        <Modal title="Add expense" onClose={() => setAdding(false)}>
          <ExpenseForm onSaved={(d) => void saveNew(d)} onCancel={() => setAdding(false)} />
        </Modal>
      )}
      <AutoBackupRunner />
      <span className="sr" aria-live="polite">{budget ? `Today's limit ${formatINR(budget.todayLimitPaise)}` : ''}</span>
    </div>
  )
}
