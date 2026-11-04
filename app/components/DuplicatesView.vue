<script setup lang="ts">
interface DupFile {
  name: string
  path: string
  size: number
  mtime: number
  title: string | null
  artist: string | null
  album: string | null
  duration: number | null
  bitrate: number | null
  hasCover: boolean
  /** cópia exata (mesmo conteúdo) de outro arquivo do grupo */
  identical?: boolean
}
interface DupGroup { type: 'identical' | 'similar', kind: 'audio' | 'video', title: string, files: DupFile[] }
interface Result { scanned: number, truncated: boolean, wasted: number, groups: DupGroup[] }

const { locations } = useDriveLocations()
const { playList, current, playing, toggle } = usePlayer()
const { confirm } = useDialog()
const fs = useFsActions()
const { notify } = useToast()

const chosen = useState<string[] | null>('dupRoots', () => null)
const result = useState<Result | null>('dupResult', () => null)
/** caminho que fica em cada grupo; todos os outros vão para a exclusão */
const keep = useState<Record<number, string>>('dupKeep', () => ({}))
const scanning = ref(false)
const filter = ref<'all' | 'audio' | 'video'>('all')

const roots = computed(() => chosen.value ?? locations.value.filter(l => l.kind !== 'disk').map(l => l.path))

function toggleRoot(path: string) {
  const s = new Set(roots.value)
  s.has(path) ? s.delete(path) : s.add(path)
  chosen.value = [...s]
}

/** A "melhor" cópia: maior bitrate, depois maior arquivo, depois caminho mais curto. */
function best(files: DupFile[]) {
  return [...files].sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0) || b.size - a.size || a.path.length - b.path.length)[0]!.path
}

async function scan() {
  if (!roots.value.length) return
  scanning.value = true
  try {
    result.value = await $fetch<Result>('/api/fs/duplicates', { method: 'POST', body: { roots: roots.value } })
    keep.value = Object.fromEntries(result.value.groups.map((g, i) => [i, best(g.files)]))
  }
  catch (e) {
    notify(errorMessage(e, 'Não foi possível procurar'), true)
  }
  finally {
    scanning.value = false
  }
}

const groups = computed(() => (result.value?.groups ?? []).map((g, i) => ({ ...g, i })).filter(g => filter.value === 'all' || g.kind === filter.value))

/** arquivos marcados para excluir (todos menos o "manter" de cada grupo visível) */
const toDelete = computed(() => groups.value.flatMap(g => g.files.filter(f => f.path !== keep.value[g.i]).map(f => f.path)))
const toDeleteSize = computed(() => groups.value.flatMap(g => g.files.filter(f => f.path !== keep.value[g.i])).reduce((a, f) => a + f.size, 0))

const ext = (name: string) => name.split('.').pop()!.toUpperCase()
const folder = (path: string) => friendlyPath(path.replace(/[\\/][^\\/]+$/, ''), locations.value)

function play(f: DupFile) {
  if (current.value?.key === f.path) return toggle()
  playList([fileToPlayItem(f)])
}

async function removeGroup(g: { i: number, files: DupFile[] }) {
  const paths = g.files.filter(f => f.path !== keep.value[g.i]).map(f => f.path)
  const ok = await confirm(`Excluir ${paths.length} cópia${paths.length > 1 ? 's' : ''}?`, `Fica só "${keep.value[g.i]!.split(/[\\/]/).pop()}". As outras são apagadas do disco permanentemente.`, { confirmLabel: 'Excluir', danger: true })
  if (!ok) return
  dropDeleted(await fs.remove(paths))
}

async function removeAll() {
  const paths = toDelete.value
  if (!paths.length) return
  const ok = await confirm(
    `Excluir ${paths.length} arquivo${paths.length > 1 ? 's' : ''} repetido${paths.length > 1 ? 's' : ''}?`,
    `Libera ${formatBytes(toDeleteSize.value)}. Em cada grupo fica só a versão marcada como "Manter". Não dá para desfazer.`,
    { confirmLabel: 'Excluir tudo', danger: true },
  )
  if (!ok) return
  // só some da tela o que foi apagado de verdade (um arquivo aberto em outro programa fica)
  dropDeleted(await fs.remove(paths))
}

/** tira da tela o que foi apagado e some com grupos que ficaram com um só arquivo */
function dropDeleted(paths: string[]) {
  if (!result.value) return
  const gone = new Set(paths)
  const kept: DupGroup[] = []
  const newKeep: Record<number, string> = {}
  result.value.groups.forEach((g, i) => {
    const files = g.files.filter(f => !gone.has(f.path))
    if (files.length > 1) {
      newKeep[kept.length] = files.some(f => f.path === keep.value[i]) ? keep.value[i]! : best(files)
      kept.push({ ...g, files })
    }
  })
  result.value = { ...result.value, groups: kept }
  keep.value = newKeep
}
</script>

<template>
  <div>
    <header class="hero">
      <div class="cover"><Icon name="copy" :size="80" /></div>
      <div class="info">
        <span class="kind">Ferramenta</span>
        <h1>Repetidas</h1>
        <p class="meta">
          <template v-if="scanning">Procurando e comparando arquivos…</template>
          <template v-else-if="result">
            {{ result.scanned }} arquivos analisados • {{ result.groups.length }} grupo{{ result.groups.length === 1 ? '' : 's' }} de repetidas
            <template v-if="result.wasted"> • até {{ formatBytes(result.wasted) }} para liberar</template>
          </template>
          <template v-else>Encontra músicas e vídeos repetidos, mesmo com nome, formato ou qualidade diferente.</template>
        </p>
      </div>
    </header>

    <div class="roots">
      <span class="label">Procurar em:</span>
      <button v-for="l in locations" :key="l.id" class="chip" :class="{ active: roots.includes(l.path) }" @click="toggleRoot(l.path)">
        <Icon :name="locationIcon(l.kind)" :size="14" /> {{ l.name }}
      </button>
    </div>

    <div class="actions">
      <button class="btn-green go" :disabled="scanning || !roots.length" @click="scan">
        <Icon v-if="scanning" name="loader" :size="18" class="spin" />
        <span v-else>{{ result ? 'Procurar de novo' : 'Procurar repetidas' }}</span>
      </button>
      <template v-if="result?.groups.length">
        <div class="seg">
          <button :class="{ on: filter === 'all' }" @click="filter = 'all'">Tudo</button>
          <button :class="{ on: filter === 'audio' }" @click="filter = 'audio'">Músicas</button>
          <button :class="{ on: filter === 'video' }" @click="filter = 'video'">Vídeos</button>
        </div>
        <button class="btn-ghost danger" :disabled="!toDelete.length" @click="removeAll">
          <Icon name="trash" :size="16" /> Excluir {{ toDelete.length }} cópia{{ toDelete.length === 1 ? '' : 's' }} ({{ formatBytes(toDeleteSize) }})
        </button>
      </template>
    </div>

    <p v-if="result && !result.groups.length && !scanning" class="empty">Nenhuma repetida encontrada nessas pastas. 🎉</p>
    <p v-if="result?.truncated" class="note">Alguma pasta tinha mais de 5.000 arquivos; só os primeiros foram comparados.</p>

    <section v-for="g in groups" :key="g.i" class="group">
      <header class="g-head">
        <span class="badge" :class="g.type">{{ g.type === 'identical' ? 'Idênticas' : 'Parecidas' }}</span>
        <span class="badge kind">{{ g.kind === 'video' ? 'Vídeo' : 'Música' }}</span>
        <strong class="ellipsis">{{ g.title }}</strong>
        <button class="btn-ghost small" @click="removeGroup(g)"><Icon name="trash" :size="14" /> Excluir as outras</button>
      </header>
      <div v-for="f in g.files" :key="f.path" class="file" :class="{ keep: keep[g.i] === f.path }">
        <label class="radio" :title="keep[g.i] === f.path ? 'Esta fica' : 'Manter esta'">
          <input v-model="keep[g.i]" type="radio" :name="`g${g.i}`" :value="f.path">
          <span>{{ keep[g.i] === f.path ? 'Manter' : 'Excluir' }}</span>
        </label>
        <button class="play" :title="current?.key === f.path && playing ? 'Pausar' : 'Ouvir'" @click="play(f)">
          <Icon :name="current?.key === f.path && playing ? 'pause' : 'play'" :size="16" />
        </button>
        <div class="names">
          <span class="ellipsis fname" :title="f.path">{{ f.name }}</span>
          <span class="ellipsis fpath">{{ folder(f.path) }}</span>
        </div>
        <span class="tag" :class="{ same: f.identical }" :title="f.identical ? 'Cópia exata de outro arquivo deste grupo' : ''">{{ ext(f.name) }}{{ f.identical ? ' =' : '' }}</span>
        <span class="num">{{ f.bitrate ? `${f.bitrate} kbps` : '' }}</span>
        <span class="num">{{ formatDuration(f.duration) }}</span>
        <span class="num">{{ formatBytes(f.size) }}</span>
      </div>
    </section>
  </div>
</template>

<style scoped>
.hero { display: flex; align-items: flex-end; gap: 24px; padding: 40px 24px 24px; background: linear-gradient(#8c1932, #121212); }
.cover { width: 192px; height: 192px; border-radius: 6px; display: grid; place-items: center; background: linear-gradient(135deg, #e91429, #f59b23); color: #fff; box-shadow: 0 4px 60px rgba(0, 0, 0, .5); flex: none; }
.info { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.kind { font-size: 14px; font-weight: 500; }
h1 { margin: 0; font-size: clamp(32px, 5vw, 72px); font-weight: 800; letter-spacing: -2px; line-height: 1.05; }
.meta { margin: 0; font-size: 14px; color: rgba(255, 255, 255, .8); }

.roots { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 20px 24px 0; }
.label { color: var(--subdued); font-size: 14px; margin-right: 4px; }
.chip { display: inline-flex; align-items: center; gap: 6px; }

.actions { display: flex; align-items: center; gap: 16px; padding: 20px 24px; flex-wrap: wrap; }
.go { height: 44px; padding: 0 24px; min-width: 120px; }
.seg { display: flex; background: var(--elevated); border-radius: 999px; padding: 3px; }
.seg button { padding: 6px 14px; border-radius: 999px; font-size: 14px; color: var(--subdued); font-weight: 600; }
.seg button.on { background: #fff; color: #000; }
.danger { color: var(--red); border-color: rgba(243, 114, 127, .5); }
.btn-ghost:disabled { opacity: .4; }
.empty, .note { color: var(--subdued); padding: 0 24px; }
.note { font-size: 13px; color: var(--muted); }

.group { margin: 0 24px 16px; background: #181818; border-radius: 8px; padding: 8px; }
.g-head { display: flex; align-items: center; gap: 8px; padding: 8px 8px 12px; min-width: 0; }
.g-head strong { flex: 1; min-width: 0; font-size: 16px; }
.badge { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .5px; padding: 3px 8px; border-radius: 4px; flex: none; }
.badge.identical { background: #e91429; }
.badge.similar { background: #f59b23; color: #000; }
.badge.kind { background: #333; color: var(--subdued); }
.small { padding: 4px 12px; font-size: 13px; }

.file {
  display: grid; grid-template-columns: 96px 32px minmax(0, 1fr) 52px 72px 52px 72px; align-items: center; gap: 12px;
  padding: 8px; border-radius: 6px; font-size: 14px; color: var(--subdued); opacity: .7;
}
.file.keep { opacity: 1; background: rgba(30, 215, 96, .08); }
.file:hover { background: rgba(255, 255, 255, .06); opacity: 1; }
.radio { display: flex; align-items: center; gap: 8px; cursor: pointer; font-weight: 700; font-size: 13px; }
.radio input { accent-color: var(--green); width: 16px; height: 16px; }
.file.keep .radio span { color: var(--green); }
.file:not(.keep) .radio span { color: var(--red); }
.play { width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; background: #2a2a2a; color: #fff; }
.play:hover { background: var(--green); color: #000; }
.names { display: flex; flex-direction: column; min-width: 0; }
.fname { color: #fff; }
.fpath { font-size: 12px; color: var(--muted); }
.tag.same { background: #5a1d26; color: #ff8a95; }
.tag { font-size: 11px; font-weight: 800; background: #333; border-radius: 4px; padding: 2px 6px; text-align: center; }
.num { text-align: right; font-variant-numeric: tabular-nums; font-size: 13px; white-space: nowrap; }

@media (max-width: 860px) {
  .hero { flex-direction: column; align-items: flex-start; }
  .cover { width: 128px; height: 128px; }
  .file { grid-template-columns: 84px 32px minmax(0, 1fr) 64px; }
  .tag, .file .num:nth-of-type(1), .file .num:nth-of-type(2) { display: none; }
}
</style>
