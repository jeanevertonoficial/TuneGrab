<script setup lang="ts">
const { el, current, videoMode: mode, toggle, playing } = usePlayer()
const host = ref<HTMLElement>()
const panel = ref<HTMLElement>()

// encaixa o elemento de mídia do player aqui (ele continua tocando ao trocar de modo)
onMounted(() => {
  const media = el()
  if (media && host.value) host.value.appendChild(media)
})

const visible = computed(() => !!current.value?.video && mode.value !== 'hidden')

/**
 * Vigia da imagem: com a janela minimizada/em segundo plano o Chrome desliga a imagem do vídeo
 * (economia de energia) e, se a próxima faixa começa nesse meio-tempo, às vezes a imagem não volta:
 * fica o último quadro do vídeo anterior com o som do próximo. Se o som anda e a imagem não,
 * força o redesenho no ponto atual; se não adiantar, recarrega a faixa no mesmo segundo.
 */
const { reload: reloadTrack } = usePlayer()
let lastFrameAt = 0
let lastFrameMedia = 0
let tries = 0
let handle = 0
let reloadedFor: string | null = null // recarrega no máximo 1x por faixa (nunca entra em ciclo)
let watchTimer: ReturnType<typeof setInterval> | null = null

function listen() {
  const v = el()
  if (!v) return
  if (handle) v.cancelVideoFrameCallback(handle)
  handle = v.requestVideoFrameCallback(onFrame)
}

function onFrame(_now: number, meta: { mediaTime: number }) {
  lastFrameAt = performance.now()
  lastFrameMedia = meta.mediaTime
  tries = 0
  handle = 0
  listen()
}

function checkFrames() {
  const v = el()
  if (!v || !visible.value || !current.value?.video || v.paused || document.hidden || v.readyState < 3 || !v.videoWidth) return
  const stuck = performance.now() - lastFrameAt > 2500 && v.currentTime - lastFrameMedia > 2.5
  if (!stuck) return
  tries++
  if (tries <= 2) {
    v.currentTime = v.currentTime + 0.01 // pular "quase nada" faz o navegador decodificar e mostrar o quadro atual
    restartWatch()
  }
  else if (reloadedFor !== current.value.key) {
    tries = 0
    reloadedFor = current.value.key
    reloadTrack({ time: v.currentTime, playing: true }) // última tentativa: abre a faixa de novo no mesmo ponto
  }
}

function restartWatch() {
  const v = el()
  if (!v || !('requestVideoFrameCallback' in v)) return
  // faixa nova ou janela voltou: conta a partir de agora
  lastFrameAt = performance.now()
  lastFrameMedia = v.currentTime
  listen()
}

onMounted(() => {
  const v = el()
  if (!v || !('requestVideoFrameCallback' in v)) return
  v.addEventListener('loadeddata', restartWatch)
  v.addEventListener('play', restartWatch)
  document.addEventListener('visibilitychange', restartWatch)
  restartWatch()
  watchTimer = setInterval(checkFrames, 1000)
})
onBeforeUnmount(() => {
  if (watchTimer) clearInterval(watchTimer)
  document.removeEventListener('visibilitychange', restartWatch)
})

/**
 * Janela flutuante (Picture-in-Picture): o vídeo fica por cima de todas as janelas do computador,
 * dá para arrastar para qualquer canto e mudar o tamanho. No programa instalado abre sozinha ao
 * minimizar o app (o Electron chama window.__tunegrabPip) e fecha ao voltar.
 */
async function floating(on: boolean) {
  const v = el()
  try {
    if (on && v && current.value?.video && v.videoWidth && document.pictureInPictureElement !== v) await v.requestPictureInPicture()
    if (!on && document.pictureInPictureElement) await document.exitPictureInPicture()
  }
  catch { /* sem vídeo carregado ou o navegador não deixou */ }
}
// ---- programa instalado: janela flutuante do TuneGrab ----
// O som NUNCA sai daqui: a janelinha mostra só a imagem (sem som) acompanhando este player.
// Minimizar e voltar não trocam quem toca: nada para, pula ou repete. Os botões dela mandam aqui.
const { volume, muted, setVolume, toggleMute, seek } = usePlayer()
type Desktop = {
  float: (i: object) => void, floatState: (s: object) => void, closeFloat: () => void,
  onCmd?: (cb: (c: { type: string, t?: number, v?: number }) => void) => void
}
const desktop = () => (window as any).tunegrabDesktop as Desktop | undefined
let floatOpen = false
let stateTimer: ReturnType<typeof setInterval> | null = null

/** foto do quadro atual: a janelinha aparece com ela na hora (nunca preta) até o vídeo dela assumir */
function snapshot(v: HTMLVideoElement) {
  try {
    if (!v.videoWidth) return null
    const w = Math.min(v.videoWidth, 854)
    const c = document.createElement('canvas')
    c.width = w
    c.height = Math.round(w * v.videoHeight / v.videoWidth)
    c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', 0.85)
  }
  catch { return null }
}

function stateOf(v: HTMLVideoElement) {
  return {
    t: v.currentTime, at: Date.now(), paused: v.paused, rate: v.playbackRate,
    stalled: !v.paused && v.readyState < 3, // carregando: a imagem espera também
    volume: volume.value, muted: muted.value, duration: Number.isFinite(v.duration) ? v.duration : 0,
  }
}
function pushState() {
  const v = el()
  if (floatOpen && v) desktop()?.floatState(stateOf(v))
}
const STATE_EVENTS = ['play', 'pause', 'playing', 'waiting', 'seeked', 'ratechange', 'volumechange', 'durationchange']

function sendToFloat() {
  const v = el()
  const cur = current.value
  if (!v || !cur?.video || !desktop()) return
  floatOpen = true
  desktop()!.float({
    src: new URL(cur.src, location.href).href, title: cur.title, artist: cur.artist,
    w: v.videoWidth, h: v.videoHeight, poster: snapshot(v), state: stateOf(v),
  })
  if (!stateTimer) {
    stateTimer = setInterval(pushState, 500)
    for (const ev of STATE_EVENTS) v.addEventListener(ev, pushState)
  }
}
function stopFloat() {
  floatOpen = false
  if (stateTimer) clearInterval(stateTimer)
  stateTimer = null
  const v = el()
  if (v) for (const ev of STATE_EVENTS) v.removeEventListener(ev, pushState)
}

// mudou de faixa com o app minimizado: vídeo → a janelinha troca junto; só áudio → ela fecha
function onTrackLoaded() {
  if (!floatOpen) return
  if (current.value?.video) sendToFloat()
  else {
    stopFloat()
    desktop()?.closeFloat()
  }
}

onMounted(() => {
  el()?.addEventListener('loadeddata', onTrackLoaded)
  // botões da janelinha
  desktop()?.onCmd?.((c) => {
    const v = el()
    if (c.type === 'float-closed') return stopFloat()
    if (!v) return
    if (c.type === 'toggle') toggle()
    else if (c.type === 'pause') v.pause()
    else if (c.type === 'seek' && typeof c.t === 'number') seek(c.t)
    else if (c.type === 'volume' && typeof c.v === 'number') setVolume(c.v)
    else if (c.type === 'mute') toggleMute()
    pushState()
  })
})
onBeforeUnmount(() => {
  stopFloat()
  el()?.removeEventListener('loadeddata', onTrackLoaded)
})

// abriu sozinha (app minimizado): fecha sozinha quando o app volta a aparecer.
// A aberta pelo botão continua até a pessoa fechar.
let autoFloating = false
function onVisible() {
  if (!document.hidden && autoFloating) {
    autoFloating = false
    void floating(false)
  }
}
onMounted(() => {
  ;(window as any).__tunegrabPip = async (on: boolean) => {
    if (on) {
      // ao minimizar: só se um vídeo está tocando
      if (el()?.paused ?? true) return
      // programa instalado: janela flutuante do TuneGrab (título da música, voltar ao app)
      if (desktop()) return sendToFloat()
      await floating(true)
      autoFloating = !!document.pictureInPictureElement
    }
    else if (autoFloating) {
      autoFloating = false
      await floating(false)
    }
  }
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('focus', onVisible)
  el()?.addEventListener('leavepictureinpicture', onLeaveFloating)
})

/**
 * Saiu da janela flutuante com o app minimizado. "Voltar" (o vídeo continua tocando) → reabre o
 * programa; o X da janelinha pausa o vídeo → o app continua minimizado.
 */
function onLeaveFloating() {
  autoFloating = false
  const v = el()
  if (!document.hidden || !v) return
  setTimeout(() => {
    if (!v.paused) (window as any).tunegrabDesktop?.show()
  }, 150) // o X pausa logo em seguida: espera um instante para saber qual foi
}
onBeforeUnmount(() => {
  el()?.removeEventListener('leavepictureinpicture', onLeaveFloating)
  delete (window as any).__tunegrabPip
  document.removeEventListener('visibilitychange', onVisible)
  window.removeEventListener('focus', onVisible)
})

function fullscreen() {
  const media = el()
  if (document.fullscreenElement) void document.exitFullscreen()
  else void (panel.value ?? media)?.requestFullscreen?.()
}

function onKey(e: KeyboardEvent) {
  if (!current.value?.video) return
  if ((e.target as HTMLElement).closest('input, textarea, select')) return
  if (e.key === 'Escape' && mode.value === 'expanded' && !document.fullscreenElement) mode.value = 'mini'
  if (e.key.toLowerCase() === 'f') fullscreen()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div ref="panel" class="video-panel" :class="[mode, { visible }]">
    <div ref="host" class="host" @click="toggle()" @dblclick="mode = mode === 'expanded' ? 'mini' : 'expanded'" />
    <div v-if="visible" class="bar">
      <span class="ellipsis title">{{ current?.title }}</span>
      <button v-if="mode === 'mini'" title="Expandir" @click="mode = 'expanded'">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M4 4h6v2H6v4H4V4Zm10 0h6v6h-2V6h-4V4ZM4 14h2v4h4v2H4v-6Zm14 0h2v6h-6v-2h4v-4Z" /></svg>
      </button>
      <button v-else title="Reduzir" @click="mode = 'mini'">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 4h2v6H4V8h4V4Zm6 0h2v4h4v2h-6V4ZM4 14h6v6H8v-4H4v-2Zm10 0h6v2h-4v4h-2v-6Z" /></svg>
      </button>
      <button title="Janela flutuante (fica por cima de tudo; arraste e redimensione)" @click="floating(true)">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M3 5h18v8h-2V7H5v10h6v2H3V5Zm10 9h9v6h-9v-6Z" /></svg>
      </button>
      <button title="Tela cheia (F)" @click="fullscreen">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5Zm2 0v14h14V5H5Zm2 2h4v2H9v2H7V7Zm10 10h-4v-2h2v-2h2v4Z" /></svg>
      </button>
      <button title="Minimizar (continua tocando)" @click="mode = 'hidden'">
        <Icon name="close" :size="18" />
      </button>
    </div>
    <div v-if="visible && !playing" class="paused" @click="toggle()"><Icon name="play" :size="40" /></div>
  </div>
</template>

<style scoped>
.video-panel { display: none; }
.video-panel.visible {
  display: flex; flex-direction: column; position: fixed; z-index: 50; background: #000; border-radius: 8px; overflow: hidden;
  box-shadow: 0 16px 48px rgba(0, 0, 0, .7);
}
/* mini: cartão no canto, acima da barra do player */
.video-panel.visible.mini { right: 16px; bottom: 96px; width: 400px; max-width: calc(100vw - 32px); }
/* expandido: ocupa a área principal do app */
.video-panel.visible.expanded { left: 336px; right: 8px; top: max(8px, env(titlebar-area-height, 0px)); bottom: 88px; }
.video-panel:fullscreen { border-radius: 0; }

.host { position: relative; flex: 1; min-height: 0; cursor: pointer; display: flex; }
.mini .host { aspect-ratio: 16 / 9; }
.host :deep(video) { width: 100%; height: 100%; object-fit: contain; background: #000; display: block; }

.bar {
  display: flex; align-items: center; gap: 4px; padding: 6px 8px 6px 12px;
  background: #181818; border-top: 1px solid #282828;
}
.title { flex: 1; min-width: 0; font-size: 13px; font-weight: 600; }
.bar button { color: var(--subdued); display: grid; place-items: center; padding: 6px; border-radius: 50%; }
.bar button:hover { color: #fff; background: #2a2a2a; }

.paused {
  position: absolute; inset: 0 0 41px 0; display: grid; place-items: center; color: #fff; cursor: pointer;
  background: rgba(0, 0, 0, .35); pointer-events: auto;
}
/* o play fica num círculo escuro: aparece até em vídeo claro (antes era branco sobre quase branco) */
.paused :deep(svg) {
  box-sizing: content-box; padding: 16px 14px 16px 18px; border-radius: 50%;
  background: rgba(0, 0, 0, .65); box-shadow: 0 4px 24px rgba(0, 0, 0, .5);
}

@media (max-width: 860px) {
  .video-panel.visible.expanded { left: 8px; top: 64px; }
  .video-panel.visible.mini { width: 260px; }
}
</style>
