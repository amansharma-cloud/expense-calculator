import { DEFAULT_REMINDER_PREFS, type ReminderItem, type ReminderPrefs } from '../engine/reminders'

/**
 * Browser side of push reminders. Only dates and a count leave the device (see worker/push.ts).
 * The on/off switch and the preferences belong to THIS device, so they live in localStorage, not in your synced data.
 */
const KEY = 'ds-reminders'
export interface DeviceReminders { on: boolean; prefs: ReminderPrefs }

export function loadDevice(): DeviceReminders {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<DeviceReminders> | null
    return { on: !!raw?.on, prefs: { ...DEFAULT_REMINDER_PREFS, ...(raw?.prefs ?? {}) } }
  } catch {
    return { on: false, prefs: DEFAULT_REMINDER_PREFS }
  }
}
export function saveDevice(d: DeviceReminders) {
  try { localStorage.setItem(KEY, JSON.stringify(d)) } catch { /* private mode: it just will not be remembered */ }
}

export const pushSupported = () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

async function call<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T | null }> {
  const res = await fetch(path, {
    method, redirect: 'manual', credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (res.type === 'opaqueredirect') return { status: 401, data: null }
  const json = (res.headers.get('content-type') ?? '').includes('application/json')
  return { status: res.status, data: json ? ((await res.json()) as T) : null }
}

export async function serverConfig(): Promise<{ enabled: boolean; publicKey?: string } | null> {
  try {
    const r = await call<{ enabled: boolean; publicKey?: string }>('GET', '/api/push/config')
    return r.status === 200 ? r.data : null
  } catch {
    return null
  }
}

const keyBytes = (b64url: string) => Uint8Array.from(atob(b64url.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))

async function registration() {
  return Promise.race([navigator.serviceWorker.ready, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('no service worker')), 4000))])
}

export type EnableResult = 'ok' | 'denied' | 'unsupported' | 'unavailable' | 'signin'

export async function enableReminders(): Promise<EnableResult> {
  if (!pushSupported()) return 'unsupported'
  const cfg = await serverConfig()
  if (!cfg?.enabled || !cfg.publicKey) return 'unavailable'
  if ((await Notification.requestPermission()) !== 'granted') return 'denied'
  let reg: ServiceWorkerRegistration
  try { reg = await registration() } catch { return 'unsupported' }
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(cfg.publicKey) }))
  const r = await call('POST', '/api/push/subscribe', { endpoint: sub.endpoint })
  if (r.status === 401 || r.status === 403) return 'signin'
  return r.status === 200 ? 'ok' : 'unavailable'
}

export async function disableReminders(profileId: string) {
  try {
    const reg = await registration()
    const sub = await reg.pushManager.getSubscription()
    if (sub) {
      await call('DELETE', '/api/push/subscribe', { endpoint: sub.endpoint })
      await sub.unsubscribe()
    }
  } catch { /* nothing to undo */ }
  try { await call('DELETE', `/api/push/schedule/${profileId}`) } catch { /* offline: stale times expire on their own */ }
}

export async function isSubscribed(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== 'granted') return false
  try { return !!(await (await registration()).pushManager.getSubscription()) } catch { return false }
}

export async function uploadSchedule(profileId: string, items: ReminderItem[]): Promise<boolean> {
  try { return (await call('PUT', `/api/push/schedule/${profileId}`, { items })).status === 200 } catch { return false }
}

export async function sendTest(): Promise<'sent' | 'none' | 'failed'> {
  try {
    const r = await call<{ sent: number }>('POST', '/api/push/test', {})
    return r.status === 200 && (r.data?.sent ?? 0) > 0 ? 'sent' : r.status === 409 ? 'none' : 'failed'
  } catch { return 'failed' }
}
