export default defineNuxtConfig({
  compatibilityDate: '2026-11-01',
  devtools: { enabled: false },
  // fonte junto com o app (antes vinha do Google Fonts: atrasava a 1ª tela e sumia sem internet)
  css: ['@fontsource-variable/figtree', '~/assets/main.css'],
  app: {
    head: {
      title: 'TuneGrab',
      htmlAttrs: { lang: 'pt-BR' },
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'description', content: 'Baixe músicas, playlists e vídeos do YouTube, Spotify e Deezer, salve no pendrive e ouça com letra.' },
        // app pessoal (mexe nos seus arquivos): se um dia ficar acessível pela rede, não aparece em buscadores
        { name: 'robots', content: 'noindex, nofollow' },
        // prévia ao compartilhar o link (WhatsApp, Telegram…)
        { property: 'og:title', content: 'TuneGrab' },
        { property: 'og:description', content: 'Baixe músicas, playlists e vídeos e salve direto no pendrive.' },
        { property: 'og:image', content: '/logo-wordmark.png' },
        { property: 'og:type', content: 'website' },
        // PWA: cor da barra da janela e do celular; ícone e nome ao instalar
        { name: 'theme-color', content: '#121212' },
        { name: 'color-scheme', content: 'dark' },
        { name: 'application-name', content: 'TuneGrab' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-title', content: 'TuneGrab' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/icons/favicon-32.png' },
        { rel: 'icon', type: 'image/png', sizes: '192x192', href: '/icons/icon-192.png' },
        { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png' },
        { rel: 'manifest', href: '/manifest.webmanifest' },
      ],
    },
  },
  nitro: {
    routeRules: {
      // o service worker e o manifesto não podem ficar presos em cache antigo
      '/sw.js': { headers: { 'cache-control': 'no-cache', 'service-worker-allowed': '/' } },
      '/manifest.webmanifest': { headers: { 'content-type': 'application/manifest+json', 'cache-control': 'no-cache' } },
      // ícones e logo quase nunca mudam: o navegador guarda por 1 dia
      '/icons/**': { headers: { 'cache-control': 'public, max-age=86400' } },
    },
  },
})
