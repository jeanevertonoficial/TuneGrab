<script setup lang="ts">
/** Letra da música que está tocando: a linha cantada fica em destaque e a tela acompanha (como no Spotify). */
const { open, mini, data, loading, load } = useLyrics()
const { current, playing, seek, toggle } = usePlayer()

watch([open, () => current.value?.key], ([o]) => {
  if (o) void load()
}, { immediate: true })

// tempo com precisão de quadro (o "timeupdate" do player só chega ~4x por segundo)
const now = ref(0)
let raf = 0
function tick() {
  now.value = mediaElement()?.currentTime ?? 0
  raf = requestAnimationFrame(tick)
}
onMounted(() => (raf = requestAnimationFrame(tick)))
onBeforeUnmount(() => cancelAnimationFrame(raf))

const lines = computed(() => data.value?.lines?.filter((l, i, a) => l.text || (a[i - 1]?.text ?? '') !== '') ?? null)
/** linha sendo cantada (um pouco antes, para o destaque não chegar atrasado) */
const active = computed(() => {
  const l = lines.value
  if (!l?.length) return -1
  const t = now.value + 0.25
  let i = -1
  for (let k = 0; k < l.length; k++) {
    if (l[k]!.t <= t) i = k
    else break
  }
  return i
})

// a tela acompanha a linha atual, a não ser que você tenha rolado com o mouse há pouco
const box = ref<HTMLElement>()
let userScrollAt = 0
function onWheel() {
  userScrollAt = Date.now()
}
watch(active, async (i) => {
  if (mini.value || i < 0 || Date.now() - userScrollAt < 3000) return
  await nextTick()
  box.value?.querySelector<HTMLElement>(`[data-i="${i}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
})

function jump(t: number) {
  seek(t)
  userScrollAt = 0
  if (!playing.value) toggle()
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && !mini.value) open.value = false
}

// voltou para o modo grande: a tela vai direto para a linha atual
watch(mini, async (m) => {
  if (m) return
  await nextTick()
  box.value?.querySelector<HTMLElement>(`[data-i="${active.value}"]`)?.scrollIntoView({ block: 'center' })
})

/** cartão pequeno: a linha cantada e a próxima */
const miniLines = computed(() => {
  const l = lines.value
  if (l?.length) {
    const i = Math.max(0, active.value)
    return { now: l[i]?.text || '♪', next: l.slice(i + 1).find(x => x.text)?.text ?? '' }
  }
  const first = data.value?.plain?.split(/\r?\n/).find(Boolean)
  return { now: first ?? '', next: '' }
})
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

// cor de fundo por música (variações de tons fortes, como no Spotify)
const COLORS = ['#7a3b2e', '#2e5a7a', '#5b2e7a', '#2e7a52', '#7a2e55', '#6b5a1e', '#1e5f6b', '#4a3a7a']
const bg = computed(() => {
  const s = current.value?.title ?? ''
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return COLORS[h % COLORS.length]
})
</script>

<template>
  <!-- pequeno no canto (ao navegar): clique para ampliar -->
  <aside v-if="mini" class="lyrics-mini" :style="{ '--bg': bg }" role="region" aria-label="Letra">
    <header class="m-top">
      <span class="m-label"><Icon name="mic" :size="13" /> Letra</span>
      <button class="m-btn" title="Ampliar a letra" aria-label="Ampliar a letra" @click="mini = false">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M4 4h6v2H6v4H4V4Zm10 0h6v6h-2V6h-4V4ZM4 14h2v4h4v2H4v-6Zm14 0h2v6h-6v-2h4v-4Z" /></svg>
      </button>
      <button class="m-btn" title="Fechar letra" aria-label="Fechar letra" @click="open = false"><Icon name="close" :size="16" /></button>
    </header>
    <button class="m-body" title="Ampliar a letra" @click="mini = false">
      <template v-if="loading"><span class="m-next">Procurando a letra…</span></template>
      <template v-else-if="miniLines.now">
        <span class="m-now">{{ miniLines.now }}</span>
        <span v-if="miniLines.next" class="m-next">{{ miniLines.next }}</span>
      </template>
      <span v-else class="m-next">Letra não disponível</span>
    </button>
  </aside>

  <section v-else class="lyrics" :style="{ '--bg': bg }">
    <header class="top">
      <div class="who">
        <img v-if="current?.cover" :src="current.cover" alt="" referrerpolicy="no-referrer">
        <div class="ellipsis-wrap">
          <strong class="ellipsis">{{ current?.title ?? 'Nada tocando' }}</strong>
          <span class="ellipsis">{{ current?.artist }}</span>
        </div>
      </div>
      <button class="close" title="Fechar letra (Esc)" @click="open = false"><Icon name="close" :size="22" /></button>
    </header>

    <div ref="box" class="body" @wheel.passive="onWheel" @touchmove.passive="onWheel">
      <p v-if="!current" class="state">Toque uma música para ver a letra.</p>
      <p v-else-if="loading" class="state"><Icon name="loader" :size="22" class="spin" /> Procurando a letra…</p>
      <div v-else-if="data?.unavailable && !data.plain" class="state">
        <p>Não foi possível buscar a letra agora (sem internet ou o acervo de letras está ocupado).</p>
        <button class="btn-ghost small" @click="load(true)">Tentar de novo</button>
      </div>
      <p v-else-if="!lines && !data?.plain" class="state">Letra não disponível para esta música.</p>

      <!-- sincronizada: clique numa linha para ir até ela -->
      <div v-else-if="lines" class="lines">
        <button
          v-for="(l, i) in lines" :key="i" :data-i="i" class="line"
          :class="{ on: i === active, past: i < active, gap: !l.text }"
          :title="`Ir para ${formatDuration(l.t)}`" @click="jump(l.t)"
        >
          {{ l.text || '♪' }}
        </button>
      </div>

      <!-- sem os tempos: a letra corrida -->
      <div v-else class="plain">
        <p class="note">Esta letra não tem o tempo de cada linha, então não acompanha a música.</p>
        <p v-for="(l, i) in data!.plain!.split('\n')" :key="i" class="pline">{{ l || ' ' }}</p>
      </div>

      <p v-if="data?.source" class="credit">Letra: {{ data.source === 'arquivo' ? 'gravada no arquivo' : 'LRCLIB' }}</p>
    </div>
  </section>
</template>

<style scoped>
.lyrics {
  grid-column: 2; grid-row: 1; z-index: 6; min-width: 0; min-height: 0;
  border-radius: var(--radius); overflow: hidden; display: flex; flex-direction: column;
  background: linear-gradient(180deg, color-mix(in srgb, var(--bg) 100%, #000 0%), color-mix(in srgb, var(--bg) 55%, #000 45%));
}
.top { display: flex; align-items: center; gap: 16px; padding: 16px 24px; }
.who { display: flex; align-items: center; gap: 12px; min-width: 0; flex: 1; }
.who img { width: 48px; height: 48px; border-radius: 4px; object-fit: cover; flex: none; }
.ellipsis-wrap { display: flex; flex-direction: column; min-width: 0; }
.who strong { font-size: 16px; }
.who span { font-size: 13px; color: rgba(255, 255, 255, .75); }
.close { color: rgba(255, 255, 255, .8); display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; }
.close:hover { color: #fff; background: rgba(0, 0, 0, .2); }
.body { flex: 1; overflow-y: auto; padding: 8px 48px 40vh; scrollbar-width: thin; }
.state { margin-top: 18vh; font-size: 24px; font-weight: 700; color: rgba(255, 255, 255, .85); display: flex; flex-direction: column; align-items: flex-start; gap: 16px; }
.state p { margin: 0; }
p.state { flex-direction: row; align-items: center; }
.lines { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding-top: 12vh; }
.line {
  font-size: clamp(22px, 3vw, 34px); font-weight: 800; line-height: 1.25; text-align: left; letter-spacing: -.3px;
  color: rgba(0, 0, 0, .55); padding: 4px 0; transition: color .25s, transform .25s; transform-origin: left center;
}
.line.past { color: rgba(255, 255, 255, .6); }
.line.on { color: #fff; transform: scale(1.02); }
.line:hover { color: #fff; text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 6px; }
.line.gap { font-size: 24px; }
.plain { padding-top: 6vh; }
.note { font-size: 14px; color: rgba(255, 255, 255, .7); margin: 0 0 20px; }
.pline { margin: 0; font-size: clamp(20px, 2.4vw, 28px); font-weight: 800; line-height: 1.35; color: #fff; }
.credit { margin-top: 48px; font-size: 12px; color: rgba(255, 255, 255, .6); }
.spin { animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* ---- cartão pequeno no canto ---- */
.lyrics-mini {
  position: fixed; left: 344px; bottom: 96px; z-index: 40; width: 340px; max-width: calc(100vw - 32px);
  border-radius: 10px; overflow: hidden; box-shadow: 0 12px 40px rgba(0, 0, 0, .55);
  background: linear-gradient(160deg, var(--bg), color-mix(in srgb, var(--bg) 50%, #000));
}
.m-top { display: flex; align-items: center; gap: 4px; padding: 8px 8px 0 14px; }
.m-label { display: inline-flex; align-items: center; gap: 6px; flex: 1; font-size: 11px; font-weight: 800; letter-spacing: .6px; text-transform: uppercase; color: rgba(255, 255, 255, .75); }
.m-btn { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; color: rgba(255, 255, 255, .8); }
.m-btn:hover { color: #fff; background: rgba(0, 0, 0, .25); }
.m-body { display: flex; flex-direction: column; gap: 6px; width: 100%; padding: 6px 14px 14px; text-align: left; }
.m-now { font-size: 18px; font-weight: 800; line-height: 1.25; color: #fff; }
.m-next { font-size: 14px; font-weight: 700; line-height: 1.3; color: rgba(255, 255, 255, .55); }

@media (max-width: 860px) {
  .lyrics-mini { left: 16px; }
  /* tela estreita: a barra lateral vira uma linha em cima; a letra ocupa o lugar da tela principal */
  .lyrics { grid-column: 1; grid-row: 2; }
  .body { padding: 8px 20px 40vh; }
}
</style>
