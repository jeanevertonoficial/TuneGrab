<script setup lang="ts">
import type { FsFile, FsListing } from '~/composables/useFiles'

const filesPath = useState<string | null>('filesPath', () => null)
const scanRoots = useState<string[] | null>('scanRoots', () => null)
const view = useState<string>('view')
const { locations } = useDriveLocations()
const { prompt, confirm } = useDialog()
const fs = useFsActions()
const { playList, shuffle } = usePlayer()
const { notify } = useToast()
const formatTarget = ref<string | null>(null)

function formatted(letter: string) {
  filesPath.value = letter ? `${letter}:\\` : null
}

const listing = ref<FsListing | null>(null)
const loading = ref(false)
const error = ref('')
const selected = ref(new Set<string>())
const files = computed(() => listing.value?.files ?? [])

/** Pastas grandes chegam com parte das músicas sem tags; completa em lotes sem travar a tela. */
async function fillPending(path: string) {
  while (listing.value && filesPath.value === path) {
    const batch = listing.value.files.filter(f => f.pending).slice(0, 60).map(f => f.path)
    if (!batch.length) return
    const metas = await $fetch<Record<string, Partial<FsFile>>>('/api/fs/meta', { method: 'POST', body: { paths: batch } }).catch(() => ({}))
    if (!listing.value || filesPath.value !== path) return
    listing.value = {
      ...listing.value,
      files: listing.value.files.map(f => (batch.includes(f.path) ? { ...f, ...metas[f.path], pending: false } : f)),
    }
  }
}

async function load() {
  error.value = ''
  if (!filesPath.value) {
    listing.value = null
    return
  }
  loading.value = true
  const requested = filesPath.value
  try {
    const result = await $fetch<FsListing>('/api/fs/list', { query: { path: requested } })
    // trocou de pasta enquanto esta carregava: a resposta antiga não pode tomar o lugar da nova
    if (filesPath.value !== requested) return
    listing.value = result
    // mantém só a seleção que ainda existe
    const exists = new Set([...listing.value.files.map(f => f.path), ...listing.value.folders.map(f => f.path)])
    selected.value = new Set([...selected.value].filter(p => exists.has(p)))
    void fillPending(requested)
  }
  catch (e) {
    if (filesPath.value !== requested) return
    error.value = errorMessage(e, 'Não foi possível abrir a pasta')
    listing.value = null
  }
  finally {
    if (filesPath.value === requested) loading.value = false
  }
}

watch(filesPath, () => {
  selected.value = new Set()
  void load()
}, { immediate: true })

// se o pendrive aberto for removido, volta para a lista de unidades
watch(locations, (locs) => {
  const loc = listing.value?.location
  if (loc && !locs.some(l => l.id === loc.id)) filesPath.value = null
})

const cmd = useFileCommands({ files, reload: load })

function open(path: string | null) {
  filesPath.value = path
}

function toggle(path: string) {
  const s = new Set(selected.value)
  s.has(path) ? s.delete(path) : s.add(path)
  selected.value = s
}

function toggleAll() {
  const all = files.value.every(f => selected.value.has(f.path))
  selected.value = new Set(all ? [] : files.value.map(f => f.path))
}

async function newFolder() {
  const name = await prompt('Nova pasta', '', 'Criar')
  if (name && filesPath.value && await fs.mkdir(filesPath.value, name)) await load()
}

const folderMenu = [
  { id: 'open', label: 'Abrir', icon: 'folder' },
  { id: 'play', label: 'Tocar músicas da pasta', icon: 'play' },
  { id: 'rename', label: 'Renomear', icon: 'edit' },
  { id: 'move', label: 'Mover para…', icon: 'move' },
  { id: 'copy', label: 'Copiar para…', icon: 'copy' },
  { id: 'delete', label: 'Excluir', icon: 'trash', danger: true },
]

async function folderAction(id: string, f: { name: string, path: string }) {
  if (id === 'open') return open(f.path)
  if (id === 'play') {
    const l = await $fetch<FsListing>('/api/fs/scan', { query: { path: f.path } }).catch(() => null) as any
    if (l?.files?.length) playList(l.files.map(fileToPlayItem))
    else notify('Nenhuma música nessa pasta')
    return
  }
  if (id === 'rename') {
    const name = await prompt('Renomear pasta', f.name, 'Renomear')
    if (name && name !== f.name && await fs.rename(f.path, name)) await load()
    return
  }
  if (id === 'move') return cmd.transfer([f.path], false)
  if (id === 'copy') return cmd.transfer([f.path], true)
  if (id === 'delete') {
    const ok = await confirm(`Excluir a pasta "${f.name}"?`, 'A pasta e tudo que está dentro dela serão apagados permanentemente.', { confirmLabel: 'Excluir', danger: true })
    if (ok) {
      await fs.remove([f.path])
      await load()
    }
  }
}

function playAll(shuffled = false) {
  if (!files.value.length) return
  shuffle.value = shuffled
  playList(files.value.map(fileToPlayItem), shuffled ? Math.floor(Math.random() * files.value.length) : 0)
}

function scanHere() {
  scanRoots.value = [filesPath.value!]
  view.value = 'library'
}

const breadcrumb = computed(() => {
  const l = listing.value
  if (!l?.location) return []
  const root = l.location.path.replace(/[\\/]$/, '')
  const rest = l.path.slice(root.length).split(/[\\/]/).filter(Boolean)
  const sep = l.path.includes('\\') ? '\\' : '/'
  const crumbs = [{ name: l.location.name, path: l.location.path }]
  let acc = root
  for (const part of rest) {
    acc += sep + part
    crumbs.push({ name: part, path: acc })
  }
  return crumbs
})

const title = computed(() => breadcrumb.value.at(-1)?.name ?? '')
const totalDuration = computed(() => files.value.reduce((a, f) => a + (f.duration ?? 0), 0))
// ---- pasta de um artista (ex.: "Gerson Rufino"): foto do canal, link e novidades dele ----
interface Artist { id: string, name: string, url: string, avatar: string | null, subscribers: number | null }
const artist = ref<Artist | null>(null)
const avatarBroken = ref(false)
const plain = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** é pasta de artista se as músicas dela têm o nome da pasta (no título, artista ou arquivo) */
const artistName = computed(() => {
  const l = listing.value
  const name = title.value
  if (!l?.parent || !name || plain(name).length < 3 || !files.value.length) return null
  const key = plain(name)
  const hits = files.value.filter(f => [f.title, f.artist, f.name].some(v => v && plain(v).includes(key))).length
  return hits >= Math.min(2, files.value.length) ? name : null
})
watch(artistName, async (name) => {
  artist.value = null
  avatarBroken.value = false
  if (!name) return
  const found = await $fetch<Artist | null>('/api/artist', { query: { name } }).catch(() => null)
  if (artistName.value === name) artist.value = found
}, { immediate: true })

const formatSubs = (n: number) => n >= 1e6 ? `${(n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} mi` : n >= 1e3 ? `${Math.round(n / 1e3)} mil` : String(n)

/** novidades do artista na tela Baixar, já salvando nesta pasta (sem criar subpasta) */
function goDownloadHere(link: string) {
  useState<string | null>('destination').value = filesPath.value
  useState('subfolder').value = false
  // a tela Baixar lê o destino salvo ao abrir: grava lá também (senão voltaria o anterior)
  try { localStorage.setItem('tunegrab:dest', JSON.stringify({ path: filesPath.value, subfolder: false })) }
  catch {}
  useState<string | null>('openLink').value = link
  view.value = 'home'
}
const artistSearch = () => artist.value && goDownloadHere(artist.value.name)
const artistChannel = () => artist.value && goDownloadHere(artist.value.url)

const usedPct = computed(() => {
  const l = listing.value?.location
  return l?.size && l.free != null ? Math.round(((l.size - l.free) / l.size) * 100) : null
})
</script>

<template>
  <div>
    <div class="topbar">
      <button class="round" title="Voltar" :disabled="!filesPath" @click="open(listing?.parent ?? null)">
        <Icon name="prev" :size="16" style="transform: scaleX(.8)" />
      </button>
      <nav class="crumbs">
        <button @click="open(null)">Dispositivos</button>
        <template v-for="c in breadcrumb" :key="c.path">
          <span>›</span><button class="ellipsis" @click="open(c.path)">{{ c.name }}</button>
        </template>
      </nav>
      <button v-if="filesPath" class="icon-btn" title="Atualizar" @click="load"><Icon name="refresh" :size="20" /></button>
    </div>

    <!-- lista de unidades -->
    <section v-if="!filesPath" class="devices">
      <h1>Dispositivos e pastas</h1>
      <p class="lead">Pendrives e HDs externos aparecem aqui sozinhos quando você conecta.</p>
      <div class="grid">
        <button v-for="l in locations" :key="l.id" class="dev" :class="l.kind" @click="open(l.path)">
          <span class="dev-icon"><Icon :name="locationIcon(l.kind)" :size="36" /></span>
          <strong class="ellipsis">{{ l.name }}</strong>
          <span class="dev-sub">
            {{ { removable: 'Removível', disk: 'Disco', network: 'Rede', folder: 'Pasta' }[l.kind] }}
            <template v-if="l.free != null"> • {{ formatBytes(l.free) }} livres</template>
          </span>
          <span v-if="l.size && l.free != null" class="meter"><i :style="{ width: `${Math.round(((l.size - l.free) / l.size) * 100)}%` }" /></span>
        </button>
      </div>
      <p v-if="!locations.some(l => l.kind === 'removable')" class="tip">
        <Icon name="usb" :size="18" /> Nenhum pendrive conectado. Conecte um e ele aparece aqui em alguns segundos.
      </p>
      <p class="tip muted">Celulares conectados por cabo (modo MTP) não ganham letra de unidade no Windows e não aparecem aqui. Use um cartão de memória ou ative o modo "armazenamento USB".</p>
    </section>

    <template v-else>
      <p v-if="error" class="error"><Icon name="error" :size="18" /> {{ error }}</p>

      <header v-if="listing" class="hero" :class="{ artist: !!artist }">
        <!-- pasta de um artista: a foto do canal dele -->
        <img v-if="artist?.avatar && !avatarBroken" :src="artist.avatar" alt="" class="hero-avatar" referrerpolicy="no-referrer" @error="avatarBroken = true">
        <div v-else class="hero-icon" :class="listing.location?.kind">
          <Icon :name="listing.parent ? 'folder' : locationIcon(listing.location?.kind ?? 'folder')" :size="96" />
        </div>
        <div class="hero-info">
          <span class="kind">
            <template v-if="artist"><Icon name="check" :size="14" class="verified" /> Artista · pasta</template>
            <template v-else>{{ listing.parent ? 'Pasta' : { removable: 'Pendrive', disk: 'Disco', network: 'Unidade de rede', folder: 'Pasta' }[listing.location?.kind ?? 'folder'] }}</template>
          </span>
          <h1 class="ellipsis">{{ title }}</h1>
          <p class="meta">
            <span>{{ listing.folders.length }} pasta{{ listing.folders.length === 1 ? '' : 's' }}</span> •
            <span>{{ files.length }} música{{ files.length === 1 ? '' : 's' }}</span>
            <template v-if="totalDuration"> • <span>{{ formatDuration(totalDuration) }}</span></template>
            <template v-if="listing.location?.free != null"> • <span>{{ formatBytes(listing.location.free) }} livres</span></template>
            <template v-if="artist?.subscribers"> • <span>{{ formatSubs(artist.subscribers) }} inscritos no YouTube</span></template>
          </p>
          <span v-if="usedPct != null" class="meter usage" :title="`${usedPct}% usado`"><i :style="{ width: `${usedPct}%` }" /></span>
        </div>
      </header>

      <div v-if="listing" class="actions">
        <button class="btn-green big" :disabled="!files.length" title="Tocar tudo" @click="playAll()"><Icon name="play" :size="28" /></button>
        <button class="icon-btn" :disabled="!files.length" title="Tocar em ordem aleatória" @click="playAll(true)"><Icon name="shuffle" :size="28" /></button>
        <!-- pasta de artista: novidades dele, salvando direto nesta pasta -->
        <template v-if="artist">
          <button class="btn-ghost artist-btn" title="Busca as músicas do artista: ouça, marque para a pré-lista e baixe nesta pasta" @click="artistSearch">
            <Icon name="search" :size="16" /> Músicas do artista
          </button>
          <button class="btn-ghost" title="Todos os vídeos do canal (Vídeos, Shorts, Ao vivo), para baixar nesta pasta" @click="artistChannel">
            <Icon name="library" :size="16" /> Todos os vídeos do canal
          </button>
          <a class="btn-ghost" :href="artist.url" target="_blank" rel="noopener" title="Abre o canal no YouTube">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="#f00" d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.3 5 12 5 12 5s-6.3 0-7.8.4a2.5 2.5 0 0 0-1.8 1.8C2 8.7 2 12 2 12s0 3.3.4 4.8c.2.9.9 1.6 1.8 1.8C5.7 19 12 19 12 19s6.3 0 7.8-.4c.9-.2 1.6-.9 1.8-1.8.4-1.5.4-4.8.4-4.8s0-3.3-.4-4.8Z" /><path fill="#fff" d="m10 15 5.2-3L10 9v6Z" /></svg>
            Canal no YouTube
          </a>
        </template>
        <button class="btn-ghost" @click="newFolder"><Icon name="folderPlus" :size="16" /> Nova pasta</button>
        <button class="btn-ghost" title="Procura músicas nesta pasta e em todas as subpastas" @click="scanHere"><Icon name="search" :size="16" /> Procurar músicas aqui</button>
        <button v-if="listing.location?.kind === 'removable' && !listing.parent" class="btn-ghost danger-ghost" @click="formatTarget = listing.location.path">
          <Icon name="usb" :size="16" /> Formatar pendrive
        </button>
      </div>

      <!-- ações em lote -->
      <div v-if="selected.size" class="bulk">
        <strong>{{ selected.size }} selecionado{{ selected.size > 1 ? 's' : '' }}</strong>
        <button class="btn-ghost" @click="cmd.transfer([...selected], false)"><Icon name="move" :size="16" /> Mover</button>
        <button class="btn-ghost" @click="cmd.transfer([...selected], true)"><Icon name="copy" :size="16" /> Copiar</button>
        <button class="btn-ghost danger" @click="cmd.remove([...selected])"><Icon name="trash" :size="16" /> Excluir</button>
        <button class="clear" title="Limpar seleção" @click="selected = new Set()"><Icon name="close" :size="18" /></button>
      </div>

      <div v-if="loading && !listing" class="hint">Carregando…</div>

      <template v-if="listing">
        <div v-if="listing.folders.length" class="folders">
          <div v-for="f in listing.folders" :key="f.path" class="folder" :class="{ sel: selected.has(f.path) }" @click="open(f.path)">
            <input type="checkbox" :checked="selected.has(f.path)" title="Selecionar" @click.stop @change="toggle(f.path)">
            <Icon name="folder" :size="40" class="f-icon" />
            <span class="ellipsis f-name" :title="f.name">{{ f.name }}</span>
            <RowMenu :items="folderMenu" @select="id => folderAction(id, f)" />
          </div>
        </div>

        <FileTable
          v-if="files.length" :files="files" :selected="selected"
          @play="cmd.play" @toggle="toggle" @toggle-all="toggleAll" @action="cmd.action"
        />
        <p v-else-if="!listing.folders.length" class="hint empty">Pasta vazia. Baixe músicas para cá escolhendo esta pasta como destino na tela Início.</p>
      </template>
    </template>

    <FormatUsbDialog v-model="formatTarget" @done="formatted" />
  </div>
</template>

<style scoped>
.topbar {
  position: sticky; top: 0; z-index: 5; height: 64px;
  display: flex; align-items: center; gap: 12px; padding: 0 24px;
  background: rgba(18, 18, 18, .92); backdrop-filter: blur(12px);
}
.round { width: 32px; height: 32px; border-radius: 50%; background: rgba(0, 0, 0, .7); display: grid; place-items: center; flex: none; }
.round:disabled { opacity: .4; cursor: default; }
.crumbs { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1; font-size: 14px; color: var(--subdued); overflow: hidden; }
.crumbs button { color: var(--subdued); max-width: 220px; font-weight: 700; }
.crumbs button:hover { color: #fff; }
.crumbs button:last-child { color: #fff; }
.icon-btn { color: var(--subdued); display: grid; place-items: center; padding: 4px; }
.icon-btn:hover:not(:disabled) { color: #fff; transform: scale(1.06); }
.icon-btn:disabled { opacity: .4; }

.devices { padding: 16px 24px 32px; }
.devices h1 { font-size: 32px; margin: 8px 0; letter-spacing: -.5px; }
.lead { color: var(--subdued); margin: 0 0 24px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 16px; }
.dev { background: var(--elevated); border-radius: 8px; padding: 16px; display: flex; flex-direction: column; align-items: stretch; justify-content: flex-start; gap: 6px; text-align: left; transition: background .2s; min-width: 0; }
.dev strong { display: block; width: 100%; }
.dev.folder .meter { display: none; }
.dev:hover { background: var(--highlight); }
.dev-icon { width: 100%; aspect-ratio: 1.4; border-radius: 6px; display: grid; place-items: center; background: linear-gradient(135deg, #3a3a3a, #232323); color: #bbb; margin-bottom: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, .4); }
.dev.removable .dev-icon { background: linear-gradient(135deg, #1ed760, #0f7a37); color: #000; }
.dev.folder .dev-icon { background: linear-gradient(135deg, #5038a0, #2a1f57); color: #e8dfff; }
.dev.network .dev-icon { background: linear-gradient(135deg, #0d73ec, #083e80); color: #fff; }
.dev-sub { font-size: 13px; color: var(--subdued); }
.meter { display: block; height: 4px; background: #4d4d4d; border-radius: 2px; overflow: hidden; margin-top: 4px; }
.meter i { display: block; height: 100%; background: #fff; }
.meter.usage { width: 240px; margin-top: 10px; }
.tip { display: flex; align-items: center; gap: 8px; color: var(--subdued); font-size: 14px; margin: 24px 0 0; }
.tip.muted { color: var(--muted); font-size: 13px; margin-top: 8px; line-height: 1.5; }

.error { margin: 16px 24px 0; padding: 12px 16px; border-radius: 6px; background: rgba(243, 114, 127, .12); color: var(--red); display: flex; align-items: center; gap: 8px; font-size: 14px; }

.hero { display: flex; align-items: flex-end; gap: 24px; padding: 40px 24px 24px; background: linear-gradient(#3d3d3d, #121212); }
.hero-icon { width: 192px; height: 192px; flex: none; border-radius: 6px; display: grid; place-items: center; background: linear-gradient(135deg, #5038a0, #2a1f57); color: #e8dfff; box-shadow: 0 4px 60px rgba(0, 0, 0, .5); }
.hero-icon.removable { background: linear-gradient(135deg, #1ed760, #0f7a37); color: #000; }
.hero-icon.disk { background: linear-gradient(135deg, #535353, #282828); color: #ddd; }
.hero-icon.network { background: linear-gradient(135deg, #0d73ec, #083e80); color: #fff; }
/* pasta de artista: foto do canal redonda, como a página de artista */
.hero.artist { background: linear-gradient(#2d4a3a, #121212); }
.hero-avatar { width: 192px; height: 192px; flex: none; border-radius: 50%; object-fit: cover; box-shadow: 0 4px 60px rgba(0, 0, 0, .5); }
.verified { color: #3d91ff; vertical-align: -2px; }
.artist-btn { border-color: var(--green); color: #fff; }
a.btn-ghost { display: inline-flex; align-items: center; gap: 8px; text-decoration: none; }
.hero-info { min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.kind { font-size: 14px; font-weight: 500; }
.hero h1 { margin: 0; font-size: clamp(32px, 5vw, 64px); font-weight: 800; letter-spacing: -2px; line-height: 1.1; }
.meta { margin: 0; font-size: 14px; color: rgba(255, 255, 255, .8); }

.actions { display: flex; align-items: center; gap: 20px; padding: 24px; flex-wrap: wrap; }
.big { width: 56px; height: 56px; flex: none; }

.bulk {
  position: sticky; top: 64px; z-index: 4; margin: 0 24px 12px; padding: 10px 16px; border-radius: 8px;
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap; background: #2a2a2a; box-shadow: 0 8px 24px rgba(0, 0, 0, .4);
}
.bulk strong { margin-right: auto; }
.danger-ghost { color: var(--red); border-color: rgba(243, 114, 127, .5); }
.bulk .danger { color: var(--red); border-color: rgba(243, 114, 127, .5); }
.clear { color: var(--subdued); display: grid; place-items: center; }
.clear:hover { color: #fff; }

.folders { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; padding: 0 24px 24px; }
.folder { display: flex; align-items: center; gap: 10px; padding: 10px 8px 10px 12px; border-radius: 6px; background: var(--elevated); cursor: pointer; min-width: 0; }
.folder:hover { background: var(--highlight); }
.folder.sel { background: #3a3a3a; outline: 1px solid rgba(255, 255, 255, .2); }
.folder input { accent-color: var(--green); width: 16px; height: 16px; opacity: .5; }
.folder:hover input, .folder.sel input { opacity: 1; }
.f-icon { color: #e8b84a; flex: none; }
.f-name { flex: 1; min-width: 0; font-weight: 500; }
.hint { color: var(--subdued); padding: 0 24px; }
.empty { padding: 24px; }

@media (max-width: 860px) {
  .hero { flex-direction: column; align-items: flex-start; }
  .hero-icon, .hero-avatar { width: 128px; height: 128px; }
}
</style>
