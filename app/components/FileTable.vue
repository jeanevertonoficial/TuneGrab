<script setup lang="ts">
import type { FsFile } from '~/composables/useFiles'

type Row = FsFile & { exists?: boolean }

const props = defineProps<{
  files: Row[]
  selected: Set<string>
  /** mostra a pasta de cada arquivo (Biblioteca, Favoritas, Recentes) */
  showFolder?: boolean
}>()
const emit = defineEmits<{
  play: [index: number]
  toggle: [path: string]
  toggleAll: []
  action: [id: string, file: FsFile]
}>()

const { current, playing, toggle: togglePlay } = usePlayer()
const { isFavorite, toggleFavorite } = useMe()
const { locations } = useDriveLocations()

const menu = [
  { id: 'play', label: 'Tocar', icon: 'play' },
  { id: 'tags', label: 'Editar informações', icon: 'edit' },
  { id: 'rename', label: 'Renomear arquivo', icon: 'edit' },
  { id: 'move', label: 'Mover para…', icon: 'move' },
  { id: 'copy', label: 'Copiar para…', icon: 'copy' },
  { id: 'open', label: 'Abrir pasta', icon: 'folder' },
  { id: 'delete', label: 'Excluir', icon: 'trash', danger: true },
]

// listas grandes: desenha aos poucos conforme rola (milhares de linhas travariam a tela)
const STEP = 150
const limit = ref(STEP)
const visible = computed(() => props.files.slice(0, limit.value))
const sentinel = ref<HTMLElement>()
let observer: IntersectionObserver | null = null

onMounted(() => {
  observer = new IntersectionObserver((entries) => {
    if (entries.some(e => e.isIntersecting) && limit.value < props.files.length) limit.value += STEP
  }, { rootMargin: '600px' })
  if (sentinel.value) observer.observe(sentinel.value)
})
onBeforeUnmount(() => observer?.disconnect())
// outra pasta/lista: volta ao começo (atualizações de tags na mesma lista não resetam)
watch(() => props.files[0]?.path, () => (limit.value = STEP))

// clicou na música no player e ela está mais para o fim da lista: desenha até ela (para dar para rolar)
const { revealReq } = usePlayer()
watch(revealReq, (req) => {
  const i = req ? props.files.findIndex(f => f.path === req.key) : -1
  if (i >= limit.value) limit.value = i + STEP
})

// capa que falhou ao carregar (arquivo excluído no meio): mostra o ícone
const broken = reactive(new Set<string>())

const allSelected = computed(() => props.files.length > 0 && props.files.every(f => props.selected.has(f.path)))

function folderOf(path: string) {
  return friendlyPath(path.replace(/[\\/][^\\/]+$/, ''), locations.value)
}

function onRowPlay(i: number, f: Row) {
  if (f.exists === false) return
  if (current.value?.key === f.path) togglePlay()
  else emit('play', i)
}
</script>

<template>
  <div class="table" :class="{ withFolder: showFolder }">
    <div class="row head">
      <span class="chk"><input type="checkbox" :checked="allSelected" title="Selecionar todas" @change="emit('toggleAll')"></span>
      <span class="num">#</span>
      <span>Título</span>
      <span class="album">{{ showFolder ? 'Pasta' : 'Álbum' }}</span>
      <span />
      <span class="dur"><Icon name="clock" :size="16" /></span>
      <span />
    </div>

    <div
      v-for="(f, i) in visible" :key="f.path" :data-play-key="f.path"
      class="row" :class="{ sel: selected.has(f.path), now: current?.key === f.path, missing: f.exists === false }"
      :title="f.exists === false ? 'Arquivo indisponível (pendrive desconectado, movido ou excluído)' : undefined"
      @dblclick="onRowPlay(i, f)"
    >
      <span class="chk"><input type="checkbox" :checked="selected.has(f.path)" @change="emit('toggle', f.path)"></span>
      <span class="num">
        <span class="idx">
          <span v-if="current?.key === f.path && playing" class="bars"><i /><i /><i /></span>
          <template v-else>{{ i + 1 }}</template>
        </span>
        <button class="play" :title="current?.key === f.path && playing ? 'Pausar' : 'Tocar'" @click="onRowPlay(i, f)">
          <Icon :name="current?.key === f.path && playing ? 'pause' : 'play'" :size="16" />
        </button>
      </span>
      <div class="title-cell">
        <img v-if="f.hasCover && f.exists !== false && !broken.has(f.path)" :src="coverUrl(f.path, f.mtime)" alt="" loading="lazy" decoding="async" @error="broken.add(f.path)">
        <div v-else class="nocover"><Icon name="music" :size="18" /></div>
        <div class="ellipsis-wrap">
          <span class="ellipsis t-title">{{ f.title || f.name.replace(/\.[^.]+$/, '') }}</span>
          <span class="ellipsis t-artist" :class="{ loading: f.pending }">{{ f.exists === false ? 'Indisponível' : (f.artist || f.name) }}</span>
        </div>
      </div>
      <span class="ellipsis album">{{ showFolder ? folderOf(f.path) : f.album }}</span>
      <button class="fav" :class="{ on: isFavorite(f.path) }" :title="isFavorite(f.path) ? 'Remover das Favoritas' : 'Adicionar às Favoritas'" @click="toggleFavorite(f)">
        <svg viewBox="0 0 24 24" width="18" height="18"><path :fill="isFavorite(f.path) ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2" d="M12 20.5s-7.5-4.6-9.3-9.2C1.5 8.2 3.4 4.5 7 4.5c2.1 0 3.6 1.2 5 3 1.4-1.8 2.9-3 5-3 3.6 0 5.5 3.7 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2Z" /></svg>
      </button>
      <span class="dur">{{ formatDuration(f.duration) }}</span>
      <RowMenu :items="menu" @select="id => emit('action', id, f)" />
    </div>
    <div ref="sentinel" class="sentinel" />
    <p v-if="limit < files.length" class="more">Carregando mais… ({{ limit }} de {{ files.length }})</p>
  </div>
</template>

<style scoped>
.table { padding: 0 24px 32px; }
.row {
  display: grid; grid-template-columns: 24px 32px minmax(0, 4fr) minmax(0, 2fr) 32px 56px 32px; align-items: center; gap: 16px;
  height: 56px; padding: 0 16px; border-radius: 4px; color: var(--subdued); font-size: 14px;
  content-visibility: auto; contain-intrinsic-size: auto 56px;
}
.row:not(.head):hover { background: rgba(255, 255, 255, .1); }
.row.sel { background: rgba(255, 255, 255, .16); }
.row.now .t-title { color: var(--green); }
.row.missing { opacity: .45; }
.row.missing .play { cursor: not-allowed; }
.head {
  height: 36px; border-bottom: 1px solid rgba(255, 255, 255, .1); margin-bottom: 12px; border-radius: 0;
  position: sticky; top: 64px; background: var(--panel); z-index: 2; content-visibility: visible;
}
.chk { display: flex; }
.chk input { accent-color: var(--green); width: 16px; height: 16px; cursor: pointer; opacity: .6; }
.row:hover .chk input, .row.sel .chk input, .head .chk input { opacity: 1; }
.num { display: flex; justify-content: flex-end; font-variant-numeric: tabular-nums; position: relative; }
.play { display: none; color: #fff; }
.row:not(.head):hover .idx { display: none; }
.row:not(.head):hover .play { display: grid; }
.title-cell { display: flex; align-items: center; gap: 12px; min-width: 0; }
.title-cell img, .nocover { width: 40px; height: 40px; object-fit: cover; border-radius: 4px; flex: none; }
.nocover { display: grid; place-items: center; background: #333; color: var(--muted); }
.ellipsis-wrap { display: flex; flex-direction: column; min-width: 0; }
.t-title { color: #fff; font-size: 16px; }
.t-artist.loading { opacity: .6; }
.fav { color: var(--subdued); display: grid; place-items: center; opacity: 0; transition: transform .1s; }
.row:hover .fav, .fav.on { opacity: 1; }
.fav.on { color: var(--green); }
.fav:hover { color: #fff; transform: scale(1.1); }
.fav.on:hover { color: var(--green-hover); }
.dur { text-align: right; font-variant-numeric: tabular-nums; }
.sentinel { height: 1px; }
.more { color: var(--muted); font-size: 13px; padding: 8px 16px; margin: 0; }

.bars { display: inline-flex; gap: 2px; align-items: flex-end; height: 14px; }
.bars i { width: 3px; background: var(--green); animation: eq .9s ease-in-out infinite; }
.bars i:nth-child(2) { animation-delay: .2s; }
.bars i:nth-child(3) { animation-delay: .4s; }
@keyframes eq { 0%, 100% { height: 4px; } 50% { height: 14px; } }

@media (max-width: 860px) {
  .table { padding: 0 8px 24px; }
  .row { grid-template-columns: 20px 24px minmax(0, 1fr) 28px 32px; gap: 10px; padding: 0 8px; }
  .album, .dur { display: none; }
  .fav { opacity: 1; }
}
</style>
