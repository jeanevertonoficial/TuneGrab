<script setup lang="ts">
import type { FormatChoice, MediaInfo } from '~/composables/useDownloads'

const emit = defineEmits<{ started: [jobId: string] }>()
const { start, resume } = useDownloads()

const url = useState('homeUrl', () => '')
const info = useState<MediaInfo | null>('homeInfo', () => null)
const selected = ref(new Set<string>())
const loading = ref(false)
const starting = ref(false)
const error = ref('')
const greeting = ref('Olá')
onMounted(() => {
  const h = new Date().getHours()
  greeting.value = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
})
const formats = ref<FormatChoice[]>([{ format: 'mp3', quality: '320' }])

// onde salvar: null = baixar pelo navegador; senão, uma pasta (pendrive, Músicas…)
const destination = useState<string | null>('destination', () => null)
const subfolder = useState('subfolder', () => true)
// nome da pasta nova: começa com o nome da playlist/álbum e pode ser editado
const folderName = useState('folderName', () => '')
// busca por nome: a pasta sugerida é o que foi buscado (não "Resultados para…")
watch(() => info.value?.id, () => (folderName.value = info.value?.source === 'search' ? info.value.id.slice(7) : (info.value?.title ?? '')), { immediate: true })
const { locations } = useDriveLocations()
const { pickFolder } = useDialog()

onMounted(() => {
  try {
    const saved = JSON.parse(localStorage.getItem('tunegrab:dest') || 'null')
    if (saved) {
      destination.value = saved.path ?? null
      subfolder.value = saved.subfolder ?? true
    }
  }
  catch {}
})
watch([destination, subfolder], ([path, sub]) => {
  try { localStorage.setItem('tunegrab:dest', JSON.stringify({ path, subfolder: sub })) }
  catch {}
})

const destLocation = computed(() => (destination.value ? locationOf(destination.value, locations.value) : null))
// pasta nova (playlist/álbum) entra no caminho mostrado, com o nome que a pessoa digitou
const newFolder = computed(() => (subfolder.value && info.value && info.value.type !== 'video' ? (folderName.value.trim() || info.value.title) : ''))
const withFolder = (label: string) => (newFolder.value ? `${label} › ${newFolder.value}` : label)
const destLabel = computed(() => (destination.value ? withFolder(friendlyPath(destination.value, locations.value)) : ''))

// MP3 + MP4 juntos: o vídeo vai para a pasta irmã "<pasta>_VIDEO" (mesma regra do servidor)
const mixed = computed(() => formats.value.some(f => f.format === 'mp4') && formats.value.some(f => f.format !== 'mp4'))
const videoLabel = computed(() => {
  const d = destination.value
  if (!d || !mixed.value) return ''
  const loc = destLocation.value
  const isRoot = !!loc && loc.kind !== 'folder' && loc.path.toLowerCase().replace(/[\\/]$/, '') === d.toLowerCase().replace(/[\\/]$/, '')
  const video = isRoot ? `${d.replace(/[\\/]$/, '')}\\VIDEO` : `${d.replace(/[\\/]$/, '')}_VIDEO`
  return withFolder(friendlyPath(video, locations.value))
})
// pendrive com destino escolhido foi removido?
const destMissing = computed(() => !!destination.value && locations.value.length > 0 && !destLocation.value)

async function chooseDestination() {
  const path = await pickFolder('Salvar músicas em…', destination.value ?? undefined)
  if (path) destination.value = path
}

const removables = computed(() => locations.value.filter(l => l.kind === 'removable'))

// ---- canal: abas (Vídeos, Shorts, Ao vivo) e busca dentro da lista ----
const section = ref('all')
const filter = ref('')

// ---- busca por nome + pré-lista ----
// numa busca, marcar a música = colocar na pré-lista; as buscas seguintes vão somando
const pre = usePreList()
onMounted(pre.load)
const isSearch = computed(() => info.value?.source === 'search')
const isPreList = computed(() => info.value?.source === 'prelist')
const searchQuery = computed(() => (isSearch.value ? info.value!.id.slice(7) : ''))

function syncFromPreList() {
  if (isSearch.value) selected.value = new Set(info.value!.tracks.filter(t => pre.has(t.id)).map(t => t.id))
}

/** abre a pré-lista como uma "playlist": dá para escolher formato, pasta e baixar */
function openPreList() {
  if (!pre.tracks.value.length) return
  searchSeq++
  error.value = ''
  url.value = ''
  info.value = {
    type: 'playlist', source: 'prelist', id: 'prelist', title: 'Pré-lista',
    author: `${new Set(pre.tracks.value.map(t => t.query.toLowerCase())).size} buscas`,
    thumbnail: pre.tracks.value[0]?.thumbnail ?? null, url: '',
    tracks: pre.tracks.value.map(({ query, addedAt, ...t }) => t),
  }
}

// clicou no player numa música que veio da pré-lista: abre ela de novo
// (é um "pedido pendente": vale também se esta tela ainda não estava aberta)
const openPreListReq = useState('openPreListReq', () => false)
function takePreListReq() {
  if (!openPreListReq.value) return
  openPreListReq.value = false
  openPreList()
}
watch(openPreListReq, takePreListReq)
onMounted(takePreListReq)

function removeFromPreList(ids: string[]) {
  pre.remove(ids)
  if (!isPreList.value) return
  if (!pre.tracks.value.length) return reset()
  const gone = new Set(ids)
  info.value = { ...info.value!, tracks: info.value!.tracks.filter(t => !gone.has(t.id)) }
}

function searchAgain(q: string) {
  url.value = q
  recentIndex.value = -1
  ;(document.activeElement as HTMLElement | null)?.blur()
  void search()
}

// ---- buscas recentes: lista que abre ao clicar no campo ----
const focused = ref(false)
const recentIndex = ref(-1)
const isLink = (s: string) => /^https?:\/\//i.test(s.trim())
/** filtra pelo que está digitado (link colado não mostra a lista) */
const recentMatches = computed(() => {
  const q = url.value.trim().toLowerCase()
  if (isLink(q)) return []
  return pre.history.value.filter(h => !q || (h.q.toLowerCase().includes(q) && h.q.toLowerCase() !== q)).slice(0, 8)
})
const recentOpen = computed(() => focused.value && !loading.value && recentMatches.value.length > 0)
/** faixa abaixo do campo: só as outras buscas (a atual já está escrita no campo) */
const otherSearches = computed(() => pre.history.value.filter(h => !(isSearch.value && h.q.toLowerCase() === searchQuery.value.toLowerCase())).slice(0, 12))

function onSearchKey(e: KeyboardEvent) {
  const n = recentMatches.value.length
  if (!recentOpen.value || !n) return
  if (e.key === 'ArrowDown') recentIndex.value = (recentIndex.value + 1) % n
  else if (e.key === 'ArrowUp') recentIndex.value = recentIndex.value <= 0 ? n - 1 : recentIndex.value - 1
  else if (e.key === 'Escape') focused.value = false
  // Enter com uma busca destacada: usa ela (mesmo com o campo vazio, que o navegador barraria)
  else if (e.key === 'Enter' && recentIndex.value >= 0) searchAgain(recentMatches.value[recentIndex.value]!.q)
  else return
  e.preventDefault()
}

/** Enter: se uma busca recente está destacada (setas), usa ela */
function submitSearch() {
  const h = recentOpen.value ? recentMatches.value[recentIndex.value] : undefined
  if (h) return searchAgain(h.q)
  ;(document.activeElement as HTMLElement | null)?.blur()
  void search()
}

function timeAgo(ts: number) {
  const m = Math.round((Date.now() - ts) / 60000)
  if (m < 1) return 'agora'
  if (m < 60) return `há ${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.round(h / 24)
  return d === 1 ? 'ontem' : `há ${d} dias`
}

watch(info, (i) => {
  // canal pode ter centenas de vídeos: começa sem nenhum marcado, você escolhe
  // (busca por nome: marcadas = as que já estão na pré-lista)
  if (i?.source === 'search') syncFromPreList()
  else selected.value = new Set(i?.type === 'channel' ? [] : (i?.tracks.map(t => t.id) ?? []))
  section.value = 'all'
  filter.value = ''
}, { immediate: true })
watch(() => pre.tracks.value.length, syncFromPreList)

const sections = computed(() => {
  const counts = new Map<string, number>()
  for (const t of info.value?.tracks ?? []) if (t.section) counts.set(t.section, (counts.get(t.section) ?? 0) + 1)
  return [...counts].map(([name, count]) => ({ name, count }))
})
const shownTracks = computed(() => {
  const q = filter.value.trim().toLowerCase()
  return (info.value?.tracks ?? []).filter(t =>
    (section.value === 'all' || t.section === section.value)
    && (!q || t.title.toLowerCase().includes(q) || t.artist?.toLowerCase().includes(q)))
})

// ---- já baixado / download interrompido ----
interface CheckResult {
  /** id da faixa -> formato -> caminho do arquivo que já existe */
  existing: Record<string, Record<string, string>>
  /** id da faixa -> todos os formatos que já existem no disco (qualquer formato, não só os escolhidos) */
  have?: Record<string, string[]>
  /** downloads anteriores deste mesmo link que ficaram pela metade */
  resumable: { id: string, format: string, title: string, done: number, total: number }[]
}
const check = ref<CheckResult | null>(null)
const mode = ref<'missing' | 'replace'>('missing')
const formatKeys = computed(() => formats.value.map(f => f.format))
const existingFor = (id: string) => formatKeys.value.filter(f => check.value?.existing[id]?.[f])
/** faixas que já existem em TODOS os formatos escolhidos */
const fullyDownloaded = computed(() => (info.value?.tracks ?? []).filter(t => existingFor(t.id).length === formatKeys.value.length))
const partlyDownloaded = computed(() => (info.value?.tracks ?? []).filter(t => existingFor(t.id).length > 0))
// selo "✓ MP4" na lista: todo formato já baixado, mesmo que não seja o escolhido agora
const existingMap = computed(() => (check.value ? Object.fromEntries((info.value?.tracks ?? []).map(t => [t.id, check.value!.have?.[t.id] ?? existingFor(t.id)])) : undefined))

let checkSeq = 0
async function runCheck() {
  const i = info.value
  if (!i) return
  const seq = ++checkSeq
  const result = await $fetch<CheckResult>('/api/check', { method: 'POST', body: { url: i.url, tracks: i.tracks.map(t => t.id), formats: formatKeys.value } }).catch(() => null)
  // trocou de formato/link enquanto conferia: vale só a resposta mais nova
  if (seq === checkSeq) check.value = result
}
watch([info, formatKeys], () => void runCheck())

// "baixar só o que falta": desmarca o que já existe em todos os formatos.
// Ao voltar para "substituir", marca de novo o que tinha sido desmarcado automaticamente
const autoUnchecked = new Set<string>()
watch(info, () => autoUnchecked.clear())
watch([check, mode], () => {
  if (isSearch.value) return // na busca a marcação é a pré-lista, não "o que baixar"
  const s = new Set(selected.value)
  if (mode.value === 'replace') {
    for (const id of autoUnchecked) s.add(id)
    autoUnchecked.clear()
  }
  else {
    for (const t of fullyDownloaded.value) {
      if (s.delete(t.id)) autoUnchecked.add(t.id)
    }
  }
  selected.value = s
})

async function resumeOld(id: string) {
  await resume(id)
  emit('started', id)
}

let searchSeq = 0
async function search() {
  const value = url.value.trim()
  if (!value) return
  const seq = ++searchSeq
  loading.value = true
  error.value = ''
  info.value = null
  try {
    const result = await $fetch<MediaInfo & { partial?: boolean }>('/api/info', { query: { url: value } })
    // colou outro link enquanto este carregava: não mostra o resultado antigo
    if (seq !== searchSeq) return
    info.value = result
    if (result.source === 'search') pre.remember(value, result.tracks.length)
    // resultado rápido (só título e capa): busca a duração em segundo plano
    if (result.partial) void fillDetails(value)
  }
  catch (e: any) {
    if (seq === searchSeq) error.value = e?.data?.statusMessage || e?.statusMessage || 'Não foi possível ler esse link.'
  }
  finally {
    if (seq === searchSeq) loading.value = false
  }
}

async function fillDetails(value: string) {
  const full = await $fetch<MediaInfo>('/api/info', { query: { url: value, full: 1 } }).catch(() => null)
  const cur = info.value
  if (!full || !cur || url.value.trim() !== value) return
  // só completa a duração, sem trocar a lista (para não perder a seleção)
  cur.tracks.forEach((t, i) => (t.duration = full.tracks[i]?.duration ?? t.duration))
}

const me = useMe()
const view = useState<string>('view')
const { playList, current: nowPlaying, toggle: togglePlay, togglePreviewVideo } = usePlayer()

/** Ouvir antes de baixar: toca a lista que está na tela (vídeos do YouTube) a partir da clicada. */
function listen(id: string, video = false) {
  const cur = nowPlaying.value
  if (cur?.key === previewKey(id)) {
    // a mesma música: "ver vídeo" troca para o vídeo; ouvir de novo pausa/toca
    if (video && !cur.video) return togglePreviewVideo()
    return togglePlay()
  }
  const list = shownTracks.value.filter(t => /^[\w-]{11}$/.test(t.id) && /youtu/.test(t.url))
  const start = Math.max(0, list.findIndex(t => t.id === id))
  // a clicada vai com vídeo (se pediu); as próximas da lista, só áudio
  playList(list.map((t, i) => trackToPreview(t, video && i === start)), start)
}
const brokenCovers = reactive(new Set<string>())
const recentShelf = computed(() => me.recent.value.slice(0, me.favorites.value.length ? 7 : 8))

function playRecent(r: (typeof me.recent.value)[number]) {
  if (r.exists === false) return
  const list = me.recent.value.filter(x => x.exists !== false)
  playList(list.map(fileToPlayItem), list.indexOf(r), { view: 'recent' }) // no player, leva às Recentes
}

// lista aberta pela barra lateral (curtidas, playlists da conta…)
const openLink = useState<string | null>('openLink', () => null)
watch(openLink, (link) => {
  if (!link) return
  openLink.value = null
  url.value = link
  void search()
}, { immediate: true })

// voltou para a página com um link na URL: mostra o resultado de novo (vem do cache, na hora)
onMounted(() => {
  if (url.value.trim() && !info.value && !loading.value) void search()
})

async function paste() {
  try {
    url.value = (await navigator.clipboard.readText()).trim()
    if (url.value) search()
  }
  catch {}
}

function toggle(id: string) {
  if (isSearch.value) {
    const t = info.value!.tracks.find(x => x.id === id)
    if (!t) return
    pre.has(id) ? pre.remove([id]) : pre.add([t], searchQuery.value)
    return syncFromPreList()
  }
  const s = new Set(selected.value)
  s.has(id) ? s.delete(id) : s.add(id)
  selected.value = s
}

function toggleAll() {
  // vale para o que está visível (aba/busca do canal)
  const list = shownTracks.value
  const all = list.every(t => selected.value.has(t.id))
  if (isSearch.value) {
    all ? pre.remove(list.map(t => t.id)) : pre.add(list, searchQuery.value)
    return syncFromPreList()
  }
  const s = new Set(selected.value)
  for (const t of list) all ? s.delete(t.id) : s.add(t.id)
  selected.value = s
}

const totalDuration = computed(() => info.value?.tracks.reduce((a, t) => a + (t.duration ?? 0), 0) ?? 0)

const headerMeta = computed(() => {
  const i = info.value!
  const meta = [i.author || 'YouTube']
  if (i.type === 'channel') meta.push(`${i.tracks.length} vídeos`)
  else if (i.source === 'search') meta.push(`${i.tracks.length} resultados`)
  else if (i.source === 'prelist') meta.push(`${i.tracks.length} ${i.tracks.length === 1 ? 'música' : 'músicas'}`)
  else if (/^RD/.test(i.id)) meta.push(`${i.tracks.length} primeiros vídeos do Mix`)
  else if (i.type === 'playlist') meta.push(`${i.tracks.length} músicas`)
  if (totalDuration.value) meta.push(formatDuration(totalDuration.value))
  return meta
})

async function download() {
  const i = info.value
  if (!i || !selected.value.size) return
  starting.value = true
  error.value = ''
  try {
    const created = await start({
      title: i.title,
      type: i.type,
      thumbnail: i.thumbnail,
      formats: formats.value,
      tracks: i.tracks.filter(t => selected.value.has(t.id)),
      // mesmo que a lista de unidades esteja desatualizada, o servidor confere se a pasta existe
      destination: destination.value,
      subfolder: i.type !== 'video' && subfolder.value,
      folderName: folderName.value.trim() || i.title,
      sourceUrl: i.url,
      // "só o que falta": o servidor pula, por formato, o que já foi baixado
      skipExisting: mode.value === 'missing',
      replace: mode.value === 'replace',
    })
    // pré-lista: o que foi para download sai dela (as desmarcadas continuam lá)
    if (i.source === 'prelist' && created.length) pre.remove([...selected.value])
    if (!created.length) {
      error.value = 'Tudo isso já está baixado nesses formatos. Para baixar de novo, escolha "Baixar de novo e substituir".'
      return
    }
    emit('started', created[0]!.id)
  }
  catch (e: any) {
    error.value = e?.data?.statusMessage || 'Não foi possível iniciar o download.'
  }
  finally {
    starting.value = false
  }
}

function reset() {
  info.value = null
  url.value = ''
  error.value = ''
}

// ---- colar lista de músicas (Amazon Music ou qualquer lugar) ----
const listOpen = ref(false)
const listText = ref('')
async function searchList() {
  const text = listText.value.trim()
  if (!text) return
  listOpen.value = false
  searchSeq++ // um link que ainda estava carregando não substitui a lista colada
  loading.value = true
  error.value = ''
  info.value = null
  url.value = ''
  try {
    info.value = await $fetch<MediaInfo>('/api/info/text', { method: 'POST', body: { text } })
  }
  catch (e: any) {
    error.value = e?.data?.statusMessage || 'Não consegui ler a lista.'
  }
  finally {
    loading.value = false
  }
}

const sourceName = computed(() => ({ spotify: 'Spotify', deezer: 'Deezer', text: 'sua lista' } as Record<string, string>)[info.value?.source ?? ''] ?? null)
const kindLabel = computed(() => {
  const i = info.value!
  if (i.source === 'search') return 'Busca'
  if (i.source === 'prelist') return 'Suas buscas'
  if (i.type === 'channel') return 'Canal'
  if (i.type === 'video') return 'Música'
  if (/^RD/.test(i.id)) return 'Mix'
  return i.kind === 'album' ? 'Álbum' : 'Playlist'
})
</script>

<template>
  <div>
    <div class="topbar">
      <form class="search" :class="{ open: recentOpen }" @submit.prevent="submitSearch">
        <Icon name="search" class="s-icon" />
        <input
          v-model="url" type="search" required autofocus enterkeyhint="search" autocomplete="off"
          placeholder="Cole um link (YouTube, Spotify, Deezer) ou busque por música, artista, gênero…"
          @focus="focused = true" @blur="focused = false" @input="recentIndex = -1" @keydown="onSearchKey"
        >
        <button v-if="url" type="button" class="clear" title="Limpar" @click="reset">
          <Icon name="close" :size="20" />
        </button>

        <!-- buscas recentes: abre ao clicar no campo e filtra conforme digita -->
        <div v-if="recentOpen" class="recent-pop" @mousedown.prevent>
          <div class="rp-head">
            <span>Buscas recentes</span>
            <button type="button" class="rp-clear" @click="pre.clearHistory()">Limpar tudo</button>
          </div>
          <div
            v-for="(h, i) in recentMatches" :key="h.q" class="rp-item" :class="{ hi: i === recentIndex }"
            @mouseenter="recentIndex = i" @click="searchAgain(h.q)"
          >
            <Icon name="clock" :size="18" class="rp-icon" />
            <div class="rp-text">
              <span class="ellipsis">{{ h.q }}</span>
              <small>
                {{ h.count }} resultados · {{ timeAgo(h.at) }}
                <b v-if="pre.countByQuery.value.get(h.q.toLowerCase())"> · {{ pre.countByQuery.value.get(h.q.toLowerCase()) }} na pré-lista</b>
              </small>
            </div>
            <button type="button" class="rp-x" title="Tirar do histórico" @click.stop="pre.forgetSearch(h.q)">
              <Icon name="close" :size="16" />
            </button>
          </div>
        </div>
      </form>
      <button class="btn-green go" :disabled="loading || !url.trim()" @click="search">
        <Icon v-if="loading" name="loader" :size="18" class="spin" />
        <span v-else>Buscar</span>
      </button>
    </div>

    <div v-if="error" class="error">
      <Icon name="error" :size="18" />
      <span>{{ error }}</span>
      <button v-if="/amazon/i.test(url)" class="btn-ghost small" @click="listOpen = true">Colar lista de músicas</button>
    </div>

    <!-- pré-lista + histórico das buscas por nome -->
    <!-- (a busca que já está no campo não se repete aqui) -->
    <div v-if="(pre.tracks.value.length || otherSearches.length) && (!info || isSearch || isPreList)" class="searches">
      <button
        v-if="pre.tracks.value.length" class="pre-chip" :class="{ on: isPreList }"
        title="Ver a pré-lista e baixar" @click="openPreList"
      >
        <Icon name="library" :size="16" /> Pré-lista <b>{{ pre.tracks.value.length }}</b>
      </button>
      <div v-if="otherSearches.length" class="s-row">
        <span class="s-label">{{ isSearch ? 'Outras buscas' : 'Buscas recentes' }}</span>
        <span v-for="h in otherSearches" :key="h.q" class="s-chip">
          <button class="s-q" :title="`Buscar &quot;${h.q}&quot; de novo`" @click="searchAgain(h.q)">
            <Icon name="clock" :size="13" class="s-clock" />
            <span class="ellipsis">{{ h.q }}</span>
            <b v-if="pre.countByQuery.value.get(h.q.toLowerCase())" title="Músicas desta busca na pré-lista">{{ pre.countByQuery.value.get(h.q.toLowerCase()) }}</b>
          </button>
          <button class="s-x" title="Tirar do histórico" @click="pre.forgetSearch(h.q)"><Icon name="close" :size="12" /></button>
        </span>
      </div>
    </div>

    <!-- carregando -->
    <div v-if="loading" class="skeleton">
      <div class="sk-cover" />
      <div class="sk-lines"><div /><div /><div /></div>
    </div>

    <!-- resultado -->
    <template v-else-if="info">
      <MediaHeader
        :kind="sourceName && info.source !== 'text' ? `${kindLabel} do ${sourceName}` : kindLabel"
        :title="info.title" :thumbnail="info.thumbnail" :seed="info.id" :meta="headerMeta"
      />
      <!-- busca por nome: marcar = guardar na pré-lista; o download é feito pela pré-lista -->
      <div v-if="isSearch" class="actions">
        <button class="btn-green big" :disabled="!pre.tracks.value.length" title="Ver a pré-lista e baixar" @click="openPreList">
          <Icon name="library" :size="28" />
        </button>
        <div class="actions-text">
          <strong>{{ pre.tracks.value.length ? `${pre.tracks.value.length} ${pre.tracks.value.length === 1 ? 'música' : 'músicas'} na pré-lista` : 'Pré-lista vazia' }}</strong>
          <span class="pre-hint">Marque as músicas que quiser: elas vão para a pré-lista. Faça outras buscas e, no fim, abra a pré-lista para baixar tudo junto (ou não).</span>
        </div>
      </div>
      <div v-else class="actions">
        <button class="btn-green big" :disabled="starting || !selected.size" title="Baixar" @click="download">
          <Icon v-if="starting" name="loader" :size="28" class="spin" />
          <Icon v-else name="download" :size="28" />
        </button>
        <div class="actions-text">
          <strong>
            {{ info.type === 'video' ? 'Baixar música' : `Baixar ${selected.size} de ${info.tracks.length} ${info.type === 'channel' ? 'vídeos' : 'músicas'}` }}
            <template v-if="formats.length > 1"> em {{ formats.length }} formatos</template>
          </strong>
          <FormatPicker v-model="formats" />
          <div class="dest">
            <span class="dest-label">Salvar em</span>
            <button class="chip" :class="{ active: !destination }" @click="destination = null">
              <Icon name="download" :size="14" /> Navegador
            </button>
            <button
              v-for="r in removables" :key="r.id" class="chip usb"
              :class="{ active: destination?.toLowerCase() === r.path.toLowerCase() }" @click="destination = r.path"
            >
              <Icon name="usb" :size="14" /> {{ r.name }}
            </button>
            <button class="chip" :class="{ active: !!destination && !removables.some(r => r.path.toLowerCase() === destination!.toLowerCase()) }" @click="chooseDestination">
              <Icon name="folder" :size="14" />
              {{ destination && !removables.some(r => r.path.toLowerCase() === destination!.toLowerCase()) ? destination.split(/[\\/]/).filter(Boolean).pop() : 'Escolher pasta…' }}
            </button>
            <label v-if="destination && info.type !== 'video'" class="sub">
              <input v-model="subfolder" type="checkbox"> Criar pasta <span class="q">“</span><input
                v-model="folderName" class="folder-name" type="text" maxlength="120" spellcheck="false"
                :size="Math.max(4, (folderName || info.title).length)"
                :placeholder="info.title" title="Clique para mudar o nome da pasta"
                @focus="subfolder = true" @click.prevent
              ><span class="q">”</span>
            </label>
          </div>
          <p v-if="destMissing" class="warn"><Icon name="error" :size="16" /> A pasta escolhida não está disponível (pendrive removido?). Vai baixar pelo navegador.</p>
          <template v-else-if="destination">
            <p class="dest-path ellipsis" :title="destination">
              <template v-if="mixed">Músicas: </template>{{ destLabel }}<template v-if="destLocation?.free != null"> • {{ formatBytes(destLocation.free) }} livres</template>
            </p>
            <p v-if="mixed" class="dest-path ellipsis video-dest">Vídeos: {{ videoLabel }}</p>
          </template>
        </div>
      </div>
      <!-- avisos: veio de outro serviço / já baixado / interrompido -->
      <div class="notices">
        <p v-if="sourceName" class="notice src">
          <Icon name="search" :size="18" />
          <span>
            <b>{{ info.source === 'text' ? 'Lista colada' : `Do ${sourceName}` }}:</b> cada música é procurada no YouTube
            (versão oficial, com a duração conferida) e salva com o nome, artista e capa {{ info.source === 'text' ? 'da lista' : `do ${sourceName}` }}.
          </span>
        </p>
        <div v-for="r in check?.resumable ?? []" :key="r.id" class="notice resume">
          <Icon name="refresh" :size="18" />
          <span><b>Download interrompido:</b> {{ r.format.toUpperCase() }} parou em {{ r.done }} de {{ r.total }}.</span>
          <button class="btn-green small" @click="resumeOld(r.id)">Retomar de onde parou</button>
        </div>
        <div v-if="partlyDownloaded.length" class="notice have">
          <Icon name="check" :size="18" />
          <span>
            <b>{{ fullyDownloaded.length === info.tracks.length ? 'Você já baixou tudo isso' : `${partlyDownloaded.length} de ${info.tracks.length} já baixad${partlyDownloaded.length > 1 ? 'as' : 'a'}` }}</b>
            ({{ formatKeys.map(f => `${f.toUpperCase()}: ${info!.tracks.filter(t => check?.existing[t.id]?.[f]).length}`).join(' • ') }}).
          </span>
          <div v-if="!isSearch" class="seg">
            <button :class="{ on: mode === 'missing' }" @click="mode = 'missing'">Baixar só o que falta</button>
            <button :class="{ on: mode === 'replace' }" @click="mode = 'replace'">Baixar de novo e substituir</button>
          </div>
        </div>
      </div>

      <div v-if="info.type === 'channel'" class="filters">
        <button class="chip" :class="{ active: section === 'all' }" @click="section = 'all'">Tudo ({{ info.tracks.length }})</button>
        <button v-for="sct in sections" :key="sct.name" class="chip" :class="{ active: section === sct.name }" @click="section = sct.name">
          {{ sct.name }} ({{ sct.count }})
        </button>
        <div class="find">
          <Icon name="search" :size="16" />
          <input v-model="filter" placeholder="Filtrar vídeos do canal">
        </div>
      </div>

      <div v-if="isPreList" class="filters">
        <span class="pre-hint">Desmarcadas não são baixadas e continuam na pré-lista.</span>
        <button
          class="chip" :disabled="selected.size === info.tracks.length"
          @click="removeFromPreList(info.tracks.filter(t => !selected.has(t.id)).map(t => t.id))"
        >
          Tirar as desmarcadas
        </button>
        <button class="chip" @click="removeFromPreList(info.tracks.map(t => t.id))">Esvaziar pré-lista</button>
      </div>

      <TrackTable
        :tracks="shownTracks"
        :selected="info.type !== 'video' ? selected : undefined"
        :existing="existingMap"
        preview
        @toggle="toggle" @toggle-all="toggleAll" @preview="listen"
      />
    </template>

    <!-- tela inicial -->
    <section v-else class="welcome">
      <h1>{{ greeting }}</h1>

      <!-- atalhos estilo Spotify: favoritas + últimas tocadas -->
      <div v-if="me.favorites.value.length || me.recent.value.length" class="quick">
        <button v-if="me.favorites.value.length" class="q-item" @click="view = 'favorites'">
          <span class="q-cover fav"><svg viewBox="0 0 24 24" width="22" height="22" fill="#fff"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.5 8.2 3.4 4.5 7 4.5c2.1 0 3.6 1.2 5 3 1.4-1.8 2.9-3 5-3 3.6 0 5.5 3.7 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2Z" /></svg></span>
          <strong class="ellipsis">Favoritas</strong>
        </button>
        <button
          v-for="r in recentShelf" :key="r.path" class="q-item" :class="{ off: r.exists === false }"
          :title="r.exists === false ? 'Indisponível agora' : `Tocar ${r.title || r.name}`" @click="playRecent(r)"
        >
          <img v-if="r.hasCover && r.exists !== false && !brokenCovers.has(r.path)" :src="coverUrl(r.path)" alt="" class="q-cover" loading="lazy" @error="brokenCovers.add(r.path)">
          <span v-else class="q-cover none"><Icon name="music" :size="22" /></span>
          <strong class="ellipsis">{{ r.title || r.name.replace(/\.[^.]+$/, '') }}</strong>
          <span class="q-play"><Icon name="play" :size="18" /></span>
        </button>
      </div>

      <p class="lead">
        Cole um link do YouTube, Spotify ou Deezer — música, playlist, álbum ou canal — ou busque pelo nome de uma música, artista ou gênero.
        As músicas que você marcar nas buscas vão para a <b>pré-lista</b>, para baixar tudo junto.
      </p>
      <div class="cards">
        <button class="card" @click="paste">
          <span class="card-icon" style="--c: #1ed760"><Icon name="link" :size="28" /></span>
          <strong>Colar da área de transferência</strong>
          <span>Lê o link copiado e já busca</span>
        </button>
        <button class="card" @click="listOpen = true">
          <span class="card-icon" style="--c: #ff9900"><Icon name="edit" :size="28" /></span>
          <strong>Colar lista de músicas</strong>
          <span>Amazon Music ou qualquer lista "Artista - Música"</span>
        </button>
        <div class="card">
          <span class="card-icon" style="--c: #e8115b"><Icon name="music" :size="28" /></span>
          <strong>YouTube, Spotify e Deezer</strong>
          <span>Músicas, playlists, álbuns e canais inteiros</span>
        </div>
        <div class="card">
          <span class="card-icon" style="--c: #8d67ab"><Icon name="library" :size="28" /></span>
          <strong>Playlist</strong>
          <span>youtube.com/playlist?list=… — baixa tudo num .zip</span>
        </div>
        <div class="card">
          <span class="card-icon" style="--c: #e1118c"><Icon name="download" :size="28" /></span>
          <strong>Formatos</strong>
          <span>MP3, M4A, OPUS, FLAC, WAV ou MP4</span>
        </div>
      </div>
    </section>

    <!-- colar lista -->
    <Teleport to="body">
      <div v-if="listOpen" class="backdrop" @mousedown.self="listOpen = false">
        <form class="dialog" @submit.prevent="searchList">
          <h2>Colar lista de músicas</h2>
          <p class="d-hint">
            Uma música por linha, no formato <b>Artista - Música</b>. Serve para Amazon Music (abra a playlist, selecione os nomes e copie)
            ou qualquer outra lista. Cada uma é procurada no YouTube.
          </p>
          <textarea v-model="listText" rows="10" placeholder="Toto - Africa&#10;a-ha - Take On Me&#10;Gabriela Rocha - Me Atraiu" />
          <div class="d-buttons">
            <button type="button" class="btn-text" @click="listOpen = false">Cancelar</button>
            <button type="submit" class="btn-green d-go" :disabled="!listText.trim()">Procurar músicas</button>
          </div>
        </form>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.topbar {
  position: sticky; top: 0; z-index: 5; height: 64px;
  display: flex; align-items: center; gap: 12px; padding: 0 24px;
  background: rgba(18, 18, 18, .92); backdrop-filter: blur(12px);
}
.search {
  flex: 1; max-width: 560px; height: 48px; display: flex; align-items: center; gap: 12px;
  background: var(--elevated); border-radius: 999px; padding: 0 12px 0 16px;
  border: 2px solid transparent; transition: border-color .15s, background .15s;
}
.search:hover { background: var(--highlight); border-color: #333; }
.search:focus-within { border-color: #fff; }
.s-icon { color: var(--subdued); }
.search input { flex: 1; min-width: 0; background: none; border: 0; outline: 0; font-size: 16px; }
.search input::placeholder { color: var(--muted); }
.searches { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 12px 24px 4px; }
.pre-chip {
  display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 14px; border-radius: 999px;
  background: var(--green); color: #000; font-size: 14px; font-weight: 700;
}
.pre-chip b { background: rgba(0, 0, 0, .2); border-radius: 999px; padding: 0 7px; font-size: 12px; }
.pre-chip:hover { background: var(--green-hover); }
.pre-chip.on { outline: 2px solid #fff; outline-offset: 2px; }
.searches { flex-wrap: nowrap; }
.pre-chip { flex: none; }
/* uma linha só, rolando de lado (sem quebrar o texto dos botões) */
.s-row {
  display: flex; align-items: center; gap: 8px; min-width: 0; overflow-x: auto; scrollbar-width: none;
  mask-image: linear-gradient(to right, #000 calc(100% - 32px), transparent);
}
.s-row::-webkit-scrollbar { display: none; }
.s-label { flex: none; font-size: 12px; color: var(--muted); margin-left: 4px; }
.s-chip {
  flex: none; display: inline-flex; align-items: center; height: 32px; border-radius: 999px;
  background: var(--elevated); font-size: 13px; white-space: nowrap; transition: background .15s;
}
.s-chip:hover { background: var(--highlight); }
.s-q { display: inline-flex; align-items: center; gap: 6px; padding: 0 2px 0 10px; height: 100%; color: #fff; max-width: 240px; min-width: 0; }
.s-clock { color: var(--muted); flex: none; }
.s-q b { color: var(--green); font-size: 12px; flex: none; }
.s-x { display: grid; place-items: center; width: 28px; height: 100%; color: var(--muted); opacity: 0; transition: opacity .15s; }
.s-chip:hover .s-x { opacity: 1; }
.s-x:hover { color: #fff; }

/* lista de buscas recentes embaixo do campo */
.search { position: relative; }
.search.open { border-radius: 24px 24px 0 0; border-color: #fff; background: var(--highlight); }
.recent-pop {
  position: absolute; top: calc(100% + 2px); left: -2px; right: -2px; z-index: 20;
  background: #242424; border: 2px solid #fff; border-top: 1px solid #3e3e3e; border-radius: 0 0 16px 16px;
  padding: 6px 0 8px; box-shadow: 0 16px 32px rgba(0, 0, 0, .5);
}
.rp-head { display: flex; justify-content: space-between; align-items: center; padding: 6px 16px 8px; font-size: 12px; font-weight: 700; color: var(--subdued); }
.rp-clear { font-size: 12px; color: var(--muted); }
.rp-clear:hover { color: #fff; text-decoration: underline; }
.rp-item { display: flex; align-items: center; gap: 12px; padding: 8px 8px 8px 16px; cursor: pointer; }
.rp-item.hi { background: rgba(255, 255, 255, .08); }
.rp-icon { color: var(--muted); flex: none; }
.rp-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; font-size: 14px; color: #fff; }
.rp-text small { font-size: 12px; color: var(--muted); }
.rp-text small b { color: var(--green); font-weight: 600; }
.rp-x { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; color: var(--muted); opacity: 0; }
.rp-item.hi .rp-x { opacity: 1; }
.rp-x:hover { color: #fff; background: rgba(255, 255, 255, .1); }
.pre-hint { font-size: 13px; color: var(--subdued); max-width: 560px; }
/* o navegador põe um X azul próprio no campo de busca; já temos o nosso */
.search input::-webkit-search-cancel-button { appearance: none; display: none; }
.clear { color: var(--subdued); display: grid; place-items: center; }
.clear:hover { color: #fff; }
.go { height: 48px; padding: 0 28px; font-size: 16px; min-width: 104px; }

.error { margin: 16px 24px 0; padding: 12px 16px; border-radius: 6px; background: rgba(243, 114, 127, .12); color: var(--red); display: flex; align-items: center; gap: 8px; font-size: 14px; }

.actions { display: flex; align-items: center; gap: 24px; padding: 24px; background: linear-gradient(rgba(0, 0, 0, .25), transparent 120px); }
.big { width: 64px; height: 64px; flex: none; }
.actions-text { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.dest { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dest .chip { display: inline-flex; align-items: center; gap: 6px; max-width: 260px; overflow: hidden; text-overflow: ellipsis; }
.dest .chip.usb:not(.active) { color: var(--green); }
.dest-label { font-size: 14px; color: var(--subdued); margin-right: 4px; }
.sub { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; min-width: 0; font-size: 14px; color: var(--subdued); cursor: pointer; margin-left: 4px; }
.sub input { accent-color: var(--green); }
/* parece texto ("Criar pasta “Nome”"); ao passar o mouse/clicar mostra que dá para editar */
.sub .folder-name {
  field-sizing: content; min-width: 4ch; max-width: min(520px, 60vw);
  padding: 0 0 1px; margin: 0; border: 0; border-bottom: 1px dashed transparent; border-radius: 0;
  background: transparent; color: inherit; font: inherit; cursor: text; text-overflow: ellipsis;
}
.sub .folder-name::placeholder { color: inherit; opacity: .6; }
.sub .folder-name:hover { border-bottom-color: rgba(255, 255, 255, .35); }
.sub .folder-name:focus { outline: none; color: #fff; border-bottom: 1px solid var(--green); }
.sub .q { margin-left: -6px; }
.sub .q:first-of-type { margin: 0 -6px 0 0; }
.dest-path { margin: -4px 0 0; font-size: 12px; color: var(--muted); max-width: 640px; }
.video-dest { margin-top: -8px; color: #b49bff; }
.warn { margin: 0; font-size: 13px; color: #ffa42b; display: flex; align-items: center; gap: 6px; }

.skeleton { display: flex; gap: 24px; align-items: flex-end; padding: 72px 24px 24px; }
.sk-cover { width: 232px; height: 232px; border-radius: 6px; background: var(--elevated); animation: pulse 1.2s infinite; }
.sk-lines { flex: 1; display: flex; flex-direction: column; gap: 12px; }
.sk-lines div { height: 16px; border-radius: 8px; background: var(--elevated); animation: pulse 1.2s infinite; width: 20%; }
.sk-lines div:nth-child(2) { height: 56px; width: 70%; }
.sk-lines div:nth-child(3) { width: 35%; }
@keyframes pulse { 50% { opacity: .5; } }

.welcome { padding: 32px 24px; }
.welcome h1 { font-size: 32px; margin: 8px 0; letter-spacing: -.5px; }
.quick { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px; margin: 16px 0 32px; }
.q-item {
  display: flex; align-items: center; gap: 12px; height: 56px; padding-right: 12px; border-radius: 4px; overflow: hidden;
  background: rgba(255, 255, 255, .07); text-align: left; transition: background .2s; position: relative; min-width: 0;
}
.q-item:hover { background: rgba(255, 255, 255, .16); }
.q-item.off { opacity: .45; cursor: default; }
.q-cover { width: 56px; height: 56px; object-fit: cover; flex: none; display: grid; place-items: center; }
.q-cover.fav { background: linear-gradient(135deg, #450af5, #c4efd9); }
.q-cover.none { background: #333; color: var(--muted); }
.q-item strong { flex: 1; min-width: 0; font-size: 14px; }
.q-play {
  width: 32px; height: 32px; border-radius: 50%; background: var(--green); color: #000; display: grid; place-items: center;
  flex: none; opacity: 0; transform: translateY(4px); transition: opacity .2s, transform .2s; box-shadow: 0 8px 8px rgba(0, 0, 0, .3);
}
.q-item:not(.off):hover .q-play { opacity: 1; transform: none; }
.lead { color: var(--subdued); margin: 0 0 32px; max-width: 640px; line-height: 1.5; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; }
.card {
  background: var(--elevated); border-radius: var(--radius); padding: 20px; text-align: left;
  display: flex; flex-direction: column; gap: 6px; transition: background .2s;
}
.card:hover { background: var(--highlight); }
.card strong { font-size: 16px; margin-top: 12px; }
.card span:last-child { color: var(--subdued); font-size: 14px; line-height: 1.4; word-break: break-word; }
.card-icon { width: 56px; height: 56px; border-radius: 6px; display: grid; place-items: center; background: var(--c); color: #000; box-shadow: 0 8px 24px rgba(0, 0, 0, .5); }

@media (max-width: 860px) {
  .topbar { padding: 0 12px; }
  .go { padding: 0 16px; min-width: 0; }
  .actions { padding: 16px; gap: 16px; align-items: flex-start; }
}
.notices { display: flex; flex-direction: column; gap: 8px; padding: 0 24px 16px; }
.notice { margin: 0; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 12px 14px; border-radius: 6px; font-size: 14px; line-height: 1.45; }
.notice > span { flex: 1; min-width: 240px; }
.notice b { color: #fff; }
.notice.src { background: rgba(46, 119, 208, .15); color: #a9c8f5; }
.notice.resume { background: rgba(255, 164, 43, .12); color: #ffc46b; }
.notice.have { background: rgba(30, 215, 96, .1); color: #9be7b5; }
.small { padding: 6px 14px; font-size: 13px; }
.seg { display: flex; background: var(--elevated); border-radius: 999px; padding: 3px; }
.seg button { padding: 6px 12px; border-radius: 999px; font-size: 13px; color: var(--subdued); font-weight: 600; }
.seg button.on { background: #fff; color: #000; }
.filters { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 0 24px 16px; }
.find { display: flex; align-items: center; gap: 8px; margin-left: auto; background: var(--elevated); border-radius: 999px; padding: 6px 12px; color: var(--subdued); }
.find input { background: none; border: 0; outline: 0; font-size: 14px; width: 200px; }
.backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, .7); display: grid; place-items: center; z-index: 100; padding: 16px; }
.dialog { width: min(560px, 100%); background: #282828; border-radius: 8px; padding: 24px; display: flex; flex-direction: column; gap: 14px; }
.dialog h2 { margin: 0; font-size: 22px; }
.d-hint { margin: 0; color: var(--subdued); font-size: 14px; line-height: 1.5; }
.d-hint b { color: #fff; }
.dialog textarea { background: #3e3e3e; border: 1px solid transparent; border-radius: 4px; padding: 10px 12px; color: #fff; font: inherit; font-size: 14px; resize: vertical; outline: 0; }
.dialog textarea:focus { border-color: #fff; }
.d-buttons { display: flex; justify-content: flex-end; gap: 8px; }
.btn-text { padding: 10px 16px; font-weight: 700; color: var(--subdued); }
.btn-text:hover { color: #fff; }
.d-go { padding: 12px 24px; }
</style>
