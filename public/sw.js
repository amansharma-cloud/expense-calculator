// Network-first with cache fallback: you always get the newest version when online,
// and the app still opens offline after the first visit. Only same-origin app files are cached;
// your financial data lives in IndexedDB and never passes through here.
const CACHE = 'daily-spend-v1'
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  )
})
self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(req, copy))
        }
        return res
      })
      .catch(() => caches.match(req).then((m) => m || caches.match('./'))),
  )
})

// ---- Bill reminders (Web Push) ----
// The push carries no data. We ask the server for the one generic line it holds for this user
// (e.g. "2 bills due tomorrow") and show it; if that fails we still show a harmless generic one.
self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    let title = 'Daily Spend'
    let body = 'You have bills coming up. Open Daily Spend to see them.'
    try {
      const res = await fetch('./api/push/last', { credentials: 'same-origin', redirect: 'manual' })
      if (res.ok) {
        const { last } = await res.json()
        if (last && last.body) { title = last.title || title; body = last.body }
      }
    } catch { /* offline: use the generic line */ }
    await self.registration.showNotification(title, { body, icon: 'icon-192.png', badge: 'icon-192.png', tag: 'bills', renotify: true })
  })())
})
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const open = all.find((c) => new URL(c.url).origin === self.location.origin)
    if (open) { await open.focus(); return }
    await self.clients.openWindow('./')
  })())
})
