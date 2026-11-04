<script setup lang="ts">
import type { Job, JobItem, Track } from '~/composables/useDownloads'

const props = defineProps<{
  tracks: (Track | JobItem)[]
  selected?: Set<string>
  job?: Job
  /** formatos que já existem no disco para cada faixa (aviso "já baixada") */
  existing?: Record<string, string[]>
  /** mostra o botão "ouvir" (vídeos do YouTube, antes de baixar) */
  preview?: boolean
}>()
const emit = defineEmits<{ toggle: [id: string], toggleAll: [], play: [index: number], preview: [id: string] }>()

const { current, playing, buffering } = usePlayer()
/** dá para ouvir antes de baixar: vídeo do YouTube (busca, playlist, canal, pré-lista) */
const canPreview = (t: Track | JobItem) => props.preview && /^[\w-]{11}$/.test(t.id) && /youtu/.test(t.url)
/** a mesma chave que o player usa para esta linha (download salvo = caminho do arquivo; senão, prévia do YouTube) */
function playKey(t: Track | JobItem) {
  const item = asItem(t)
  if (props.job && item) return item.savedTo ?? `${props.job.id}:${item.index}`
  return previewKey(t.id)
}
const isPlaying = (t: Track | JobItem) => current.value?.key === playKey(t)

// mouse parado em cima da música: o servidor já procura o áudio, e o play começa quase na hora
const warmed = new Set<string>()
let warmTimer: ReturnType<typeof setTimeout> | null = null
function warm(t: Track | JobItem) {
  if (warmTimer) clearTimeout(warmTimer)
  if (!canPreview(t) || warmed.has(t.id)) return
  warmTimer = setTimeout(() => {
    warmed.add(t.id)
    void $fetch(`/api/preview/${t.id}`, { query: { warm: 1 } }).catch(() => warmed.delete(t.id))
  }, 350)
}

// listas grandes (curtidas, canais com centenas de vídeos): desenha aos poucos conforme rola
const STEP = 120
const limit = ref(STEP)
const visible = computed(() => props.tracks.slice(0, limit.value))
const sentinel = ref<HTMLElement>()
let observer: IntersectionObserver | null = null
onMounted(() => {
  observer = new IntersectionObserver((entries) => {
    if (entries.some(e => e.isIntersecting) && limit.value < props.tracks.length) limit.value += STEP
  }, { rootMargin: '800px' })
  if (sentinel.value) observer.observe(sentinel.value)
})
onBeforeUnmount(() => observer?.disconnect())
// outra lista: volta ao começo
watch(() => props.tracks[0]?.id, () => (limit.value = STEP))
// clicou na música no player e ela está mais para o fim: desenha até ela
const { revealReq } = usePlayer()
watch(revealReq, (req) => {
  const i = req ? props.tracks.findIndex(t => playKey(t) === req.key) : -1
  if (i >= limit.value) limit.value = i + STEP
})

const selectable = computed(() => !!props.selected)
const allSelected = computed(() => !!props.selected && props.tracks.every(t => props.selected!.has(t.id)))

const statusLabel: Record<string, string> = {
  queued: 'Na fila',
  downloading: 'Baixando',
  converting: 'Convertendo',
  searching: 'Procurando no YouTube',
  saving: 'Salvando',
  done: 'Pronto',
  error: 'Erro',
  canceled: 'Cancelado',
}

const asItem = (t: Track | JobItem) => ('status' in t ? t : null)
</script>

<template>
  <div class="table" :class="{ selectable, withStatus: !!job }">
    <div class="row head">
      <span class="num">
        <input v-if="selectable" type="checkbox" :checked="allSelected" title="Selecionar todas" @change="emit('toggleAll')">
        <template v-else>#</template>
      </span>
      <span>Título</span>
      <span v-if="job" class="status-col">Status</span>
      <span class="dur"><Icon name="clock" :size="16" /></span>
    </div>

    <div
      v-for="(t, i) in visible" :key="t.id + i" :data-play-key="playKey(t)"
      class="row" :class="{ off: selectable && !selected!.has(t.id), now: isPlaying(t), active: ['searching', 'downloading', 'converting'].includes(asItem(t)?.status ?? '') }"
      @click="selectable && emit('toggle', t.id)"
      @mouseenter="warm(t)"
    >
      <span class="num">
        <input v-if="selectable" type="checkbox" :checked="selected!.has(t.id)" @click.stop @change="emit('toggle', t.id)">
        <template v-else-if="asItem(t)?.status === 'done'"><Icon name="check" :size="18" class="ok" /></template>
        <template v-else-if="['searching', 'downloading', 'converting'].includes(asItem(t)?.status ?? '')">
          <span class="bars"><i /><i /><i /></span>
        </template>
        <template v-else>{{ i + 1 }}</template>
      </span>

      <div class="title-cell">
        <div v-if="canPreview(t)" class="thumb" :class="{ now: isPlaying(t) }">
          <img v-if="t.thumbnail" :src="t.thumbnail" alt="" loading="lazy" referrerpolicy="no-referrer">
          <button
            class="listen" :title="isPlaying(t) && playing ? 'Pausar' : 'Ouvir'"
            @click.stop="emit('preview', t.id)"
          >
            <Icon v-if="isPlaying(t) && buffering" name="loader" :size="18" class="spin" />
            <span v-else-if="isPlaying(t) && playing" class="bars"><i /><i /><i /></span>
            <Icon v-else name="play" :size="18" />
          </button>
        </div>
        <img v-else-if="t.thumbnail" :src="t.thumbnail" alt="" loading="lazy" referrerpolicy="no-referrer">
        <div class="ellipsis-wrap">
          <span class="ellipsis t-title" :class="{ hot: isPlaying(t) }">{{ t.title }}</span>
          <span class="ellipsis t-artist">
            <span v-for="f in existing?.[t.id] ?? []" :key="f" class="have" title="Já existe no disco">✓ {{ f.toUpperCase() }}</span>
            <span v-if="t.section && t.section !== 'Vídeos'" class="sect">{{ t.section }}</span>
            {{ t.artist }}
            <a
              v-if="asItem(t)?.matched" :href="asItem(t)!.matched!.url" target="_blank" rel="noopener" class="match"
              :title="`Vídeo usado: ${asItem(t)!.matched!.title} (${asItem(t)!.matched!.channel})`" @click.stop
            >• YouTube: {{ asItem(t)!.matched!.channel }}</a>
          </span>
        </div>
      </div>

      <div v-if="job" class="status-col">
        <template v-if="asItem(t)">
          <div v-if="['searching', 'downloading', 'converting', 'saving'].includes(asItem(t)!.status)" class="mini">
            <div class="mini-bar"><div :style="{ width: `${asItem(t)!.status === 'downloading' ? asItem(t)!.progress : 100}%` }" /></div>
            <span>{{ asItem(t)!.status === 'downloading' ? `${Math.round(asItem(t)!.progress)}%` : statusLabel[asItem(t)!.status] }}</span>
          </div>
          <span v-else-if="asItem(t)!.status === 'done' && asItem(t)!.missing" class="st gone" title="O arquivo foi excluído, movido ou o pendrive está desconectado">
            Excluída
          </span>
          <span v-else-if="asItem(t)!.status === 'done'" class="done-actions">
            <button class="save" title="Tocar" @click.stop="emit('play', asItem(t)!.index)"><Icon name="play" :size="16" /> Tocar</button>
            <a :href="fileUrl(job, asItem(t)!.index)" download class="save" title="Baixar pelo navegador" @click.stop><Icon name="download" :size="18" /></a>
          </span>
          <span v-else :class="['st', asItem(t)!.status]" :title="asItem(t)!.error">
            {{ statusLabel[asItem(t)!.status] }}<template v-if="asItem(t)!.error">: {{ asItem(t)!.error }}</template>
          </span>
        </template>
      </div>

      <span class="dur">{{ formatDuration(t.duration) }}</span>
    </div>
    <div ref="sentinel" class="sentinel" />
    <p v-if="limit < tracks.length" class="more">Carregando mais… ({{ limit }} de {{ tracks.length }})</p>
  </div>
</template>

<style scoped>
.table { padding: 0 24px 32px; }
.row {
  display: grid; grid-template-columns: 40px minmax(0, 1fr) 64px; align-items: center; gap: 16px;
  height: 56px; padding: 0 16px; border-radius: 4px; color: var(--subdued); font-size: 14px;
  /* linhas fora da tela não são desenhadas pelo navegador */
  content-visibility: auto; contain-intrinsic-size: auto 56px;
}
.head { content-visibility: visible; }
.sentinel { height: 1px; }
.more { color: var(--muted); font-size: 13px; padding: 8px 16px; margin: 0; }
.withStatus .row { grid-template-columns: 40px minmax(0, 1fr) minmax(120px, 220px) 64px; }
.row:not(.head):hover { background: rgba(255, 255, 255, .1); }
.selectable .row:not(.head) { cursor: pointer; }
/* desmarcada fica apagada, mas acende ao passar o mouse e quando está tocando */
.row.off { opacity: .45; transition: opacity .12s; }
.row.off:hover, .row.now { opacity: 1; }
.row.now { background: rgba(255, 255, 255, .07); }
.row.now:hover { background: rgba(255, 255, 255, .12); }
.row.active .t-title { color: var(--green); }
.head {
  height: 36px; border-bottom: 1px solid rgba(255, 255, 255, .1); margin-bottom: 16px; border-radius: 0;
  position: sticky; top: 64px; background: var(--panel); z-index: 1;
}
.num { text-align: right; font-variant-numeric: tabular-nums; display: flex; justify-content: flex-end; }
.dur { text-align: right; font-variant-numeric: tabular-nums; display: flex; justify-content: flex-end; }
.title-cell { display: flex; align-items: center; gap: 12px; min-width: 0; }
.title-cell img { width: 40px; height: 40px; object-fit: cover; border-radius: 4px; flex: none; }
.ellipsis-wrap { display: flex; flex-direction: column; min-width: 0; }
/* ouvir antes de baixar: botão por cima da capa */
.thumb { position: relative; width: 40px; height: 40px; flex: none; border-radius: 4px; background: #333; }
.thumb img { width: 100%; height: 100%; }
.listen {
  position: absolute; inset: 0; display: grid; place-items: center; border-radius: 4px;
  background: rgba(0, 0, 0, .55); color: #fff; opacity: 0; transition: opacity .12s;
}
.row:hover .listen, .thumb.now .listen { opacity: 1; }
.listen:hover { background: rgba(0, 0, 0, .7); color: var(--green); }
/* pelo teclado (Tab) o botão aparece também; sombra no ícone para capas claras */
.listen:focus-visible { opacity: 1; outline-offset: -2px; }
.listen :deep(svg), .listen .bars { filter: drop-shadow(0 1px 3px rgba(0, 0, 0, .8)); }
.t-title.hot { color: var(--green); }
.spin { animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.t-title { color: #fff; font-size: 16px; }
.match { color: var(--muted); margin-left: 4px; }
.match:hover { color: #fff; text-decoration: underline; }
.have { display: inline-block; font-size: 10px; font-weight: 800; color: #000; background: var(--green); border-radius: 3px; padding: 0 4px; margin-right: 6px; line-height: 16px; }
.sect { display: inline-block; font-size: 10px; font-weight: 800; color: #fff; background: #e91429; border-radius: 3px; padding: 0 4px; margin-right: 6px; line-height: 16px; text-transform: uppercase; }
.ok { color: var(--green); }
input[type=checkbox] { accent-color: var(--green); width: 16px; height: 16px; cursor: pointer; }

.mini { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.mini-bar { flex: 1; height: 4px; background: #4d4d4d; border-radius: 2px; overflow: hidden; }
.mini-bar div { height: 100%; background: var(--green); transition: width .4s; }
.done-actions { display: inline-flex; align-items: center; gap: 14px; }
.save { display: inline-flex; align-items: center; gap: 6px; color: var(--subdued); font-weight: 700; font-size: 14px; }
.save:hover { color: #fff; }
.st { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; }
.st.error { color: var(--red); }
.st.gone { color: var(--muted); }

.bars { display: inline-flex; gap: 2px; align-items: flex-end; height: 14px; }
.bars i { width: 3px; background: var(--green); animation: eq .9s ease-in-out infinite; }
.bars i:nth-child(2) { animation-delay: .2s; }
.bars i:nth-child(3) { animation-delay: .4s; }
@keyframes eq { 0%, 100% { height: 4px; } 50% { height: 14px; } }

@media (max-width: 860px) {
  .table { padding: 0 8px 24px; }
  .row { padding: 0 8px; gap: 10px; }
  .withStatus .row { grid-template-columns: 28px minmax(0, 1fr) 96px; }
  .withStatus .dur { display: none; }
}
</style>
