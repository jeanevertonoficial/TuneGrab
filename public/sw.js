// Service worker do TuneGrab: deixa instalar como app e abrir a tela mesmo com a rede instável.
// Sempre tenta a rede primeiro (nunca mostra versão velha); o cache é só reserva.
// A API (/api/...) nunca passa pelo cache: downloads, músicas e arquivos são sempre ao vivo.
const CACHE = 'tunegrab-v2' // v2: logo nova
const SHELL = ['/', '/logo.svg', '/favicon.svg', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon.svg']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  // apaga caches de versões antigas
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()))
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== location.origin) return
  if (url.pathname.startsWith('/api/') || req.headers.has('range')) return // ao vivo (e áudio/vídeo com Range)
  if (url.pathname.startsWith('/_nuxt/') && /[?&](v|t)=|@vite|@fs|\.vue/.test(url.pathname + url.search)) return // modo dev

  e.respondWith((async () => {
    try {
      const res = await fetch(req)
      if (res.ok && res.type === 'basic') {
        const copy = res.clone()
        caches.open(CACHE).then(c => c.put(req.mode === 'navigate' ? '/' : req, copy)).catch(() => {})
      }
      return res
    }
    catch {
      const hit = await caches.match(req.mode === 'navigate' ? '/' : req)
      if (hit) return hit
      return new Response('<h1 style="font-family:sans-serif">TuneGrab está fechado</h1><p style="font-family:sans-serif">Abra o TuneGrab no computador (npm run dev) e tente de novo.</p>', { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } })
    }
  })())
})
