<script setup lang="ts">
import type { FsFile } from '~/composables/useFiles'

const { locations } = useDriveLocations()
const scanRoots = useState<string[] | null>('scanRoots', () => null)
const library = useState<{ roots: string[], files: (FsFile & { mtime: number })[], truncated: boolean } | null>('library', () => null)
const { playList, shuffle } = usePlayer()

const scanning = ref(false)
const progress = ref('')
const search = ref('')
const sort = ref<'title' | 'artist' | 'album' | 'recent'>('title')
const SORTS = [
  { value: 'title', label: 'Título' },
  { value: 'artist', label: 'Artista' },
  { value: 'album', label: 'Álbum' },
  { value: 'recent', label: 'Mais recentes' },
]
const selected = ref(new Set<string>())

// padrão: pendrives, pastas do usuário e unidades de rede (não o disco C: inteiro)
const defaultRoots = computed(() => locations.value.filter(l => l.kind !== 'disk').map(l => l.path))
const roots = computed(() => scanRoots.value ?? defaultRoots.value)

async function scan(fresh = false) {
  if (!roots.value.length) return
  scanning.value = true
  const all = new Map<string, FsFile & { mtime: number }>()
  let truncated = false
  for (const [i, root] of roots.value.entries()) {
    progress.value = `Procurando em ${nameOf(root)} (${i + 1}/${roots.value.length})…`
    try {
      const r = await $fetch<{ files: (FsFile & { mtime: number })[], truncated: boolean }>('/api/fs/scan', { query: { path: root, ...(fresh ? { fresh: 1 } : {}) } })
      // pastas podem se sobrepor (ex.: Documentos e C:\), então remove duplicados
      for (const f of r.files) all.set(f.path.toLowerCase(), f)
      truncated ||= r.truncated
    }
    catch { /* unidade removida no meio da busca */ }
  }
  library.value = { roots: [...roots.value], files: [...all.values()], truncated }
  scanning.value = false
  progress.value = ''
  selected.value = new Set()
}

function nameOf(path: string) {
  return locations.value.find(l => l.path === path)?.name ?? path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

function toggleRoot(path: string) {
  const set = new Set(roots.value)
  set.has(path) ? set.delete(path) : set.add(path)
  scanRoots.value = [...set]
}

// busca de novo quando muda o conjunto de pastas
watch(roots, (r) => {
  if (r.length && (!library.value || library.value.roots.join('|') !== r.join('|'))) void scan()
}, { immediate: true })

const files = computed(() => {
  const q = search.value.trim().toLowerCase()
  const list = (library.value?.files ?? []).filter(f => !q || [f.title, f.artist, f.album, f.name].some(v => v?.toLowerCase().includes(q)))
  const key = (f: FsFile) => (sort.value === 'title' ? f.title || f.name : sort.value === 'artist' ? f.artist || '~' : f.album || '~')
  return sort.value === 'recent'
    ? [...list].sort((a, b) => b.mtime - a.mtime)
    : [...list].sort((a, b) => key(a).localeCompare(key(b), 'pt-BR', { numeric: true, sensitivity: 'base' }))
})

const totalSize = computed(() => files.value.reduce((a, f) => a + f.size, 0))
const cmd = useFileCommands({ files, reload: scan })

function toggle(path: string) {
  const s = new Set(selected.value)
  s.has(path) ? s.delete(path) : s.add(path)
  selected.value = s
}
function toggleAll() {
  const all = files.value.every(f => selected.value.has(f.path))
  selected.value = new Set(all ? [] : files.value.map(f => f.path))
}

function playAll(shuffled = false) {
  if (!files.value.length) return
  shuffle.value = shuffled
  playList(files.value.map(fileToPlayItem), shuffled ? Math.floor(Math.random() * files.value.length) : 0)
}
</script>

<template>
  <div>
    <div class="topbar">
      <div class="search">
        <Icon name="search" class="s-icon" />
        <input v-model="search" placeholder="Buscar por música, artista ou álbum">
        <button v-if="search" class="x" title="Limpar busca" aria-label="Limpar busca" @click="search = ''"><Icon name="close" :size="18" /></button>
        <!-- ordenar: dentro do campo, à direita (menu do app, não a lista do Windows) -->
        <div class="sort">
          <SelectMenu v-model="sort" label="Ordenar por" :options="SORTS">
            <template #icon>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h13M3 12h9M3 18h5M18 9V20m0 0 3-3m-3 3-3-3" /></svg>
            </template>
          </SelectMenu>
        </div>
      </div>
    </div>

    <header class="hero">
      <div class="cover"><Icon name="music" :size="80" /></div>
      <div class="info">
        <span class="kind">Biblioteca</span>
        <h1>Todas as músicas</h1>
        <p class="meta">
          <template v-if="scanning">{{ progress }}</template>
          <template v-else-if="library">
            {{ files.length }} música{{ files.length === 1 ? '' : 's' }} • {{ formatBytes(totalSize) }}
            <template v-if="library.truncated"> • mostrando as primeiras 5.000 por pasta</template>
          </template>
        </p>
      </div>
    </header>

    <div class="roots">
      <span class="roots-label">Procurar em:</span>
      <button
        v-for="l in locations" :key="l.id"
        class="chip" :class="{ active: roots.includes(l.path) }" @click="toggleRoot(l.path)"
      >
        <Icon :name="locationIcon(l.kind)" :size="14" /> {{ l.name }}
      </button>
      <button v-for="r in roots.filter(r => !locations.some(l => l.path === r))" :key="r" class="chip active" @click="toggleRoot(r)">
        <Icon name="folder" :size="14" /> {{ nameOf(r) }}
      </button>
    </div>

    <div class="actions">
      <button class="btn-green big" :disabled="!files.length" title="Tocar tudo" @click="playAll()"><Icon name="play" :size="28" /></button>
      <button class="icon-btn" :disabled="!files.length" title="Aleatório" @click="playAll(true)"><Icon name="shuffle" :size="28" /></button>
      <button class="btn-ghost" :disabled="scanning" @click="scan(true)">
        <Icon name="refresh" :size="16" :class="{ spin: scanning }" /> {{ scanning ? 'Procurando…' : 'Procurar de novo' }}
      </button>
    </div>

    <div v-if="selected.size" class="bulk">
      <strong>{{ selected.size }} selecionada{{ selected.size > 1 ? 's' : '' }}</strong>
      <button class="btn-ghost" @click="cmd.transfer([...selected], false)"><Icon name="move" :size="16" /> Mover</button>
      <button class="btn-ghost" @click="cmd.transfer([...selected], true)"><Icon name="copy" :size="16" /> Copiar</button>
      <button class="btn-ghost danger" @click="cmd.remove([...selected])"><Icon name="trash" :size="16" /> Excluir</button>
      <button class="clear" @click="selected = new Set()"><Icon name="close" :size="18" /></button>
    </div>

    <FileTable
      v-if="files.length" :files="files" :selected="selected" show-folder
      @play="cmd.play" @toggle="toggle" @toggle-all="toggleAll" @action="cmd.action"
    />
    <p v-else-if="!scanning && library" class="empty">
      {{ search ? 'Nada encontrado para essa busca.' : 'Nenhuma música encontrada nessas pastas.' }}
    </p>
  </div>
</template>

<style scoped>
.topbar {
  position: sticky; top: 0; z-index: 5; height: 64px; display: flex; align-items: center; gap: 12px; padding: 0 24px;
  background: rgba(18, 18, 18, .92); backdrop-filter: blur(12px);
}
.search {
  flex: 1; max-width: 520px; height: 44px; display: flex; align-items: center; gap: 10px;
  background: var(--elevated); border-radius: 999px; padding: 0 14px; border: 2px solid transparent;
}
/* borda branca só quando está digitando na busca (não ao abrir o menu de ordenar) */
.search:has(input:focus) { border-color: #fff; }
.s-icon { color: var(--subdued); }
.search input { flex: 1; min-width: 0; background: none; border: 0; outline: 0; font-size: 15px; }
.x { color: var(--subdued); display: grid; }
.x:hover { color: #fff; }
/* ordenar dentro do campo: separado por uma linha fina */
.sort { flex: none; display: flex; align-items: center; height: 28px; margin-right: -8px; padding-left: 8px; border-left: 1px solid rgba(255, 255, 255, .14); }

.hero { display: flex; align-items: flex-end; gap: 24px; padding: 40px 24px 24px; background: linear-gradient(#4b2fa6, #121212); }
.cover { width: 192px; height: 192px; border-radius: 6px; display: grid; place-items: center; background: linear-gradient(135deg, #450af5, #c4efd9); color: #fff; box-shadow: 0 4px 60px rgba(0, 0, 0, .5); flex: none; }
.info { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.kind { font-size: 14px; font-weight: 500; }
h1 { margin: 0; font-size: clamp(32px, 5vw, 72px); font-weight: 800; letter-spacing: -2px; line-height: 1.05; }
.meta { margin: 0; font-size: 14px; color: rgba(255, 255, 255, .8); min-height: 20px; }

.roots { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 20px 24px 0; }
.roots-label { color: var(--subdued); font-size: 14px; margin-right: 4px; }
.chip { display: inline-flex; align-items: center; gap: 6px; }

.actions { display: flex; align-items: center; gap: 20px; padding: 20px 24px; }
.big { width: 56px; height: 56px; }
.icon-btn { color: var(--subdued); display: grid; place-items: center; }
.icon-btn:hover:not(:disabled) { color: #fff; }
.icon-btn:disabled { opacity: .4; }

.bulk {
  position: sticky; top: 64px; z-index: 4; margin: 0 24px 12px; padding: 10px 16px; border-radius: 8px;
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap; background: #2a2a2a; box-shadow: 0 8px 24px rgba(0, 0, 0, .4);
}
.bulk strong { margin-right: auto; }
.bulk .danger { color: var(--red); border-color: rgba(243, 114, 127, .5); }
.clear { color: var(--subdued); display: grid; }
.empty { color: var(--subdued); padding: 24px; }

@media (max-width: 860px) {
  .hero { flex-direction: column; align-items: flex-start; }
  .cover { width: 128px; height: 128px; }
}
</style>
