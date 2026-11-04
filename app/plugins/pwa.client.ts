/** Registra o service worker (PWA) e começa a ouvir o convite de instalação do navegador. */
export default defineNuxtPlugin(() => {
  usePwa().listen()
  if ('serviceWorker' in navigator && window.isSecureContext)
    void navigator.serviceWorker.register('/sw.js').catch(() => {})
})
