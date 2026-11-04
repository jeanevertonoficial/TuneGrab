<script setup lang="ts">
const emit = defineEmits<{ openJob: [id: string] }>()
const p = usePlayer()
const me = useMe()
const lyrics = useLyrics()
const { jobs } = useDownloads()

const running = computed(() => jobs.value.filter(j => j.status === 'running'))
const runningPct = computed(() => running.value.length ? running.value.reduce((a, j) => a + jobProgress(j), 0) / running.value.length : 0)

// arrastar a barra sem "brigar" com o timeupdate
const dragging = ref<number | null>(null)
const shownTime = computed(() => dragging.value ?? p.time.value)

function seekInput(e: Event) {
  dragging.value = Number((e.target as HTMLInputElement).value)
}
function seekCommit(e: Event) {
  p.seek(Number((e.target as HTMLInputElement).value))
  dragging.value = null
}

/** barra de progresso pelo teclado: ← → 5 s, Page Up/Down 30 s, Home/End início/fim (o padrão andava 0,1 s) */
function seekKey(e: KeyboardEvent) {
  const a = p.el()
  if (!a || !p.duration.value) return
  const jump: Record<string, number> = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5, PageUp: 30, PageDown: -30 }
  let t: number | null = null
  if (e.key in jump) t = a.currentTime + jump[e.key]!
  else if (e.key === 'Home') t = 0
  else if (e.key === 'End') t = p.duration.value - 1
  if (t === null) return
  e.preventDefault()
  p.seek(Math.min(Math.max(0, t), p.duration.value - 0.5))
}

function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement
  if (t?.closest?.('input, textarea, select, [contenteditable]')) return
  if (!p.current.value || e.ctrlKey || e.altKey || e.metaKey) return
  // atalhos: Espaço tocar/pausar • ← → voltar/avançar 5 s • M sem som • L letra
  // (Shift + ← → troca de música; ↑ ↓ continuam rolando a página)
  const a = p.el()
  if (e.code === 'Space') p.toggle()
  else if (e.code === 'ArrowRight' && e.shiftKey) p.next()
  else if (e.code === 'ArrowLeft' && e.shiftKey) p.prev()
  else if (e.code === 'ArrowRight' && a) p.seek(Math.min(a.currentTime + 5, a.duration || Infinity))
  else if (e.code === 'ArrowLeft' && a) p.seek(Math.max(0, a.currentTime - 5))
  else if (e.code === 'KeyM') p.toggleMute()
  else if (e.code === 'KeyL') lyrics.open.value = !lyrics.open.value
  else return
  e.preventDefault()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <footer class="bar">
    <div class="left">
      <template v-if="p.current.value">
        <!-- clicar leva até onde a música está tocando (pasta, download, busca, pré-lista…) -->
        <button class="now" :title="p.origin.value ? `Ir até “${p.current.value.title}” na lista` : p.current.value.title" :disabled="!p.origin.value" @click="p.reveal()">
          <img v-if="p.current.value.cover" :src="p.current.value.cover" alt="" class="cover" referrerpolicy="no-referrer">
          <div v-else class="cover none"><Icon name="music" :size="24" /></div>
          <div class="meta">
            <span class="ellipsis title">{{ p.current.value.title }}</span>
            <span class="ellipsis sub">{{ p.current.value.artist }}</span>
          </div>
        </button>
        <button
          v-if="p.current.value.file" class="ctl heart" :class="{ on: me.isFavorite(p.current.value.file.path) }"
          :title="me.isFavorite(p.current.value.file.path) ? 'Remover das Favoritas' : 'Adicionar às Favoritas'"
          @click="me.toggleFavorite(p.current.value.file)"
        >
          <svg viewBox="0 0 24 24" width="18" height="18"><path :fill="me.isFavorite(p.current.value.file.path) ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2" d="M12 20.5s-7.5-4.6-9.3-9.2C1.5 8.2 3.4 4.5 7 4.5c2.1 0 3.6 1.2 5 3 1.4-1.8 2.9-3 5-3 3.6 0 5.5 3.7 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2Z" /></svg>
        </button>
      </template>
    </div>

    <div class="center">
      <div class="controls">
        <button class="ctl" :class="{ on: p.shuffle.value }" title="Aleatório" @click="p.shuffle.value = !p.shuffle.value">
          <Icon name="shuffle" :size="18" />
        </button>
        <button class="ctl" title="Anterior" :disabled="!p.current.value" @click="p.prev()"><Icon name="prev" :size="18" /></button>
        <button class="playbtn" :disabled="!p.current.value" :title="p.playing.value ? 'Pausar' : 'Tocar'" @click="p.toggle()">
          <Icon :name="p.playing.value ? 'pause' : 'play'" :size="18" />
        </button>
        <button class="ctl" title="Próxima" :disabled="!p.current.value" @click="p.next()"><Icon name="next" :size="18" /></button>
        <button class="ctl" :class="{ on: p.repeat.value !== 'off' }" :title="{ off: 'Repetir', all: 'Repetindo tudo', one: 'Repetindo a faixa' }[p.repeat.value]" @click="p.cycleRepeat()">
          <Icon name="repeat" :size="18" />
          <i v-if="p.repeat.value === 'one'" class="one">1</i>
        </button>
      </div>
      <div class="seek">
        <span class="t">{{ formatDuration(shownTime) }}</span>
        <input
          type="range" class="range" min="0" :max="p.duration.value || 0" step="0.1"
          :value="shownTime" :disabled="!p.current.value"
          :style="{ '--pct': `${p.duration.value ? (shownTime / p.duration.value) * 100 : 0}%` }"
          aria-label="Posição da música" :aria-valuetext="`${formatDuration(shownTime)} de ${formatDuration(p.duration.value)}`"
          @input="seekInput" @change="seekCommit" @keydown="seekKey"
        >
        <span class="t">{{ formatDuration(p.duration.value) }}</span>
      </div>
    </div>

    <div class="right">
      <button v-if="running.length" class="dl" title="Ver downloads" @click="emit('openJob', running[0]!.id)">
        <Icon name="loader" :size="16" class="spin" />
        {{ running.length > 1 ? `${running.length} downloads` : 'Baixando' }} • {{ Math.round(runningPct) }}%
      </button>
      <button
        v-if="p.current.value?.video" class="ctl" :class="{ on: p.videoMode.value !== 'hidden' }"
        :title="p.videoMode.value === 'hidden' ? 'Mostrar vídeo' : 'Esconder vídeo'"
        @click="p.videoMode.value = p.videoMode.value === 'hidden' ? 'mini' : 'hidden'"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M3 5h18v14H3V5Zm2 2v10h14V7H5Zm5 2 5 3-5 3V9Z" /></svg>
      </button>
      <button
        class="ctl" :class="{ on: lyrics.open.value }" :disabled="!p.current.value"
        :title="lyrics.open.value ? 'Fechar letra' : 'Letra'" @click="lyrics.open.value = !lyrics.open.value"
      >
        <Icon name="mic" :size="18" />
      </button>
      <button class="ctl" :title="p.muted.value ? 'Ativar som' : 'Silenciar'" @click="p.toggleMute()">
        <Icon :name="p.muted.value || p.volume.value === 0 ? 'mute' : 'volume'" :size="18" />
      </button>
      <input
        type="range" class="range vol" min="0" max="1" step="0.05" :value="p.muted.value ? 0 : p.volume.value"
        :style="{ '--pct': `${(p.muted.value ? 0 : p.volume.value) * 100}%` }"
        title="Volume" aria-label="Volume" :aria-valuetext="`${Math.round((p.muted.value ? 0 : p.volume.value) * 100)}%`"
        @input="e => p.setVolume(Number((e.target as HTMLInputElement).value))"
      >
    </div>
  </footer>
</template>

<style scoped>
.bar {
  grid-column: 1 / -1; height: 72px; padding: 0 8px;
  display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) minmax(0, 1fr); align-items: center; gap: 16px;
}
.left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.now { display: flex; align-items: center; gap: 12px; min-width: 0; text-align: left; padding: 4px; margin: -4px; border-radius: 6px; }
.now:not(:disabled):hover { background: rgba(255, 255, 255, .06); }
.now:not(:disabled):hover .title { text-decoration: underline; }
.now:disabled { cursor: default; }
.cover { width: 56px; height: 56px; border-radius: 4px; object-fit: cover; flex: none; }
.cover.none { display: grid; place-items: center; background: #282828; color: var(--muted); }
.meta { display: flex; flex-direction: column; min-width: 0; }
.title { font-size: 14px; font-weight: 500; }
.sub { font-size: 12px; color: var(--subdued); }

.center { display: flex; flex-direction: column; align-items: center; gap: 6px; max-width: 720px; width: 100%; justify-self: center; }
.controls { display: flex; align-items: center; gap: 16px; }
.ctl { color: var(--subdued); display: grid; place-items: center; position: relative; padding: 4px; }
.ctl:hover:not(:disabled) { color: #fff; }
.ctl:disabled { opacity: .4; cursor: default; }
.ctl.on { color: var(--green); }
.heart { flex: none; margin-left: 4px; }
.heart.on::after { display: none; }
.ctl.on::after { content: ''; position: absolute; bottom: -4px; width: 4px; height: 4px; border-radius: 50%; background: var(--green); }
.one { position: absolute; top: -2px; right: -4px; font-size: 9px; font-style: normal; font-weight: 800; background: var(--green); color: #000; border-radius: 50%; width: 12px; height: 12px; display: grid; place-items: center; }
.playbtn { width: 32px; height: 32px; border-radius: 50%; background: #fff; color: #000; display: grid; place-items: center; transition: transform .1s; }
.playbtn:hover:not(:disabled) { transform: scale(1.06); }
.playbtn:disabled { opacity: .5; }

.seek { display: flex; align-items: center; gap: 8px; width: 100%; }
.t { font-size: 12px; color: var(--subdued); min-width: 40px; text-align: center; font-variant-numeric: tabular-nums; }

.range {
  -webkit-appearance: none; appearance: none; flex: 1; height: 4px; border-radius: 2px; cursor: pointer;
  background: linear-gradient(to right, #fff var(--pct), #4d4d4d var(--pct));
}
.range:hover:not(:disabled) { background: linear-gradient(to right, var(--green) var(--pct), #4d4d4d var(--pct)); }
.range::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; border-radius: 50%; background: #fff; opacity: 0; }
.range:hover::-webkit-slider-thumb, .range:focus-visible::-webkit-slider-thumb { opacity: 1; }
.range:focus-visible { background: linear-gradient(to right, var(--green) var(--pct), #4d4d4d var(--pct)); outline-offset: 6px; }
.range::-moz-range-thumb { width: 12px; height: 12px; border: 0; border-radius: 50%; background: #fff; }
.range:disabled { cursor: default; }

.right { display: flex; justify-content: flex-end; align-items: center; gap: 8px; padding-right: 8px; }
.vol { flex: none; width: 96px; }
.dl { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; color: var(--green); margin-right: 8px; white-space: nowrap; }
.dl:hover { text-decoration: underline; }

@media (max-width: 860px) {
  .bar { grid-template-columns: minmax(0, 1fr) auto; }
  .center .seek, .vol, .controls .ctl:first-child, .controls .ctl:last-child { display: none; }
  .center { grid-column: 2; grid-row: 1; }
  .right { display: none; }
}
</style>
