<script setup lang="ts">
const props = defineProps<{ mode: 'favorites' | 'recent' }>()

const me = useMe()
const { playList, shuffle } = usePlayer()
const { confirm } = useDialog()

const selected = ref(new Set<string>())
const search = ref('')

onMounted(() => void me.load()) // atualiza "disponível/indisponível" (pendrive pode ter saído)

const all = computed(() => (props.mode === 'favorites' ? me.favorites.value : me.recent.value))
const files = computed(() => {
  const q = search.value.trim().toLowerCase()
  return q ? all.value.filter(f => [f.title, f.artist, f.album, f.name].some(v => v?.toLowerCase().includes(q))) : all.value
})
const playable = computed(() => files.value.filter(f => f.exists !== false))
const totalDuration = computed(() => files.value.reduce((a, f) => a + (f.duration ?? 0), 0))
const missing = computed(() => files.value.length - playable.value.length)

const cmd = useFileCommands({ files, reload: me.load })

function playAt(i: number) {
  const f = files.value[i]
  if (!f || f.exists === false) return
  // toca a lista sem as indisponíveis, começando pela clicada
  playList(playable.value.map(fileToPlayItem), playable.value.indexOf(f))
}

function playAll(shuffled = false) {
  if (!playable.value.length) return
  shuffle.value = shuffled
  playList(playable.value.map(fileToPlayItem), shuffled ? Math.floor(Math.random() * playable.value.length) : 0)
}

function toggle(path: string) {
  const s = new Set(selected.value)
  s.has(path) ? s.delete(path) : s.add(path)
  selected.value = s
}
function toggleAll() {
  const allSel = files.value.every(f => selected.value.has(f.path))
  selected.value = new Set(allSel ? [] : files.value.map(f => f.path))
}

async function unfavoriteSelected() {
  for (const p of selected.value) {
    const f = all.value.find(x => x.path === p)
    if (f && me.isFavorite(p)) await me.toggleFavorite(f)
  }
  selected.value = new Set()
}

async function clearHistory() {
  if (await confirm('Limpar o histórico?', 'Só apaga a lista de "Tocadas recentemente". As músicas continuam no disco.', { confirmLabel: 'Limpar' }))
    await me.clearRecent()
}

function when(ts: number) {
  const d = Date.now() - ts
  if (d < 60_000) return 'agora'
  if (d < 3_600_000) return `há ${Math.round(d / 60_000)} min`
  if (d < 86_400_000) return `há ${Math.round(d / 3_600_000)} h`
  return new Date(ts).toLocaleDateString('pt-BR')
}
</script>

<template>
  <div>
    <div class="topbar">
      <div class="search">
        <Icon name="search" class="s-icon" />
        <input v-model="search" :placeholder="mode === 'favorites' ? 'Buscar nas Favoritas' : 'Buscar nas recentes'">
      </div>
    </div>

    <header class="hero" :class="mode">
      <div class="cover">
        <svg v-if="mode === 'favorites'" viewBox="0 0 24 24" width="84" height="84" fill="#fff"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.5 8.2 3.4 4.5 7 4.5c2.1 0 3.6 1.2 5 3 1.4-1.8 2.9-3 5-3 3.6 0 5.5 3.7 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2Z" /></svg>
        <Icon v-else name="clock" :size="84" />
      </div>
      <div class="info">
        <span class="kind">Playlist</span>
        <h1>{{ mode === 'favorites' ? 'Favoritas' : 'Tocadas recentemente' }}</h1>
        <p class="meta">
          {{ files.length }} música{{ files.length === 1 ? '' : 's' }}
          <template v-if="totalDuration"> • {{ formatDuration(totalDuration) }}</template>
          <template v-if="missing"> • {{ missing }} indisponíve{{ missing === 1 ? 'l' : 'is' }} agora</template>
          <template v-if="mode === 'recent' && all[0]"> • última {{ when(all[0].at) }}</template>
        </p>
      </div>
    </header>

    <div class="actions">
      <button class="btn-green big" :disabled="!playable.length" title="Tocar" @click="playAll()"><Icon name="play" :size="28" /></button>
      <button class="icon-btn" :disabled="!playable.length" title="Aleatório" @click="playAll(true)"><Icon name="shuffle" :size="28" /></button>
      <button v-if="mode === 'recent' && all.length" class="btn-ghost" @click="clearHistory"><Icon name="trash" :size="16" /> Limpar histórico</button>
    </div>

    <div v-if="selected.size" class="bulk">
      <strong>{{ selected.size }} selecionada{{ selected.size > 1 ? 's' : '' }}</strong>
      <button v-if="mode === 'favorites'" class="btn-ghost" @click="unfavoriteSelected">Remover das Favoritas</button>
      <button class="btn-ghost" @click="cmd.transfer([...selected], true)"><Icon name="copy" :size="16" /> Copiar para…</button>
      <button class="clear" title="Desmarcar todas" aria-label="Desmarcar todas" @click="selected = new Set()"><Icon name="close" :size="18" /></button>
    </div>

    <FileTable
      v-if="files.length" :files="files" :selected="selected" show-folder
      @play="playAt" @toggle="toggle" @toggle-all="toggleAll" @action="cmd.action"
    />
    <div v-else class="empty">
      <template v-if="search">Nada encontrado.</template>
      <template v-else-if="mode === 'favorites'">
        <strong>Músicas que você curtir aparecem aqui</strong>
        <span>Toque no coração ♥ ao lado de qualquer música (ou no player) para salvar.</span>
      </template>
      <template v-else>
        <strong>Nada tocado ainda</strong>
        <span>As músicas que você ouvir aparecem aqui, da mais recente para a mais antiga.</span>
      </template>
    </div>
  </div>
</template>

<style scoped>
.topbar {
  position: sticky; top: 0; z-index: 5; height: 64px; display: flex; align-items: center; padding: 0 24px;
  background: rgba(18, 18, 18, .92); backdrop-filter: blur(12px);
}
.search {
  flex: 1; max-width: 420px; height: 44px; display: flex; align-items: center; gap: 10px;
  background: var(--elevated); border-radius: 999px; padding: 0 14px; border: 2px solid transparent;
}
.search:focus-within { border-color: #fff; }
.s-icon { color: var(--subdued); }
.search input { flex: 1; min-width: 0; background: none; border: 0; outline: 0; font-size: 15px; }

.hero { display: flex; align-items: flex-end; gap: 24px; padding: 40px 24px 24px; }
.hero.favorites { background: linear-gradient(#0b5e38, #121212); }
.hero.recent { background: linear-gradient(#1e5f74, #121212); }
.cover { width: 192px; height: 192px; border-radius: 6px; display: grid; place-items: center; color: #fff; box-shadow: 0 4px 60px rgba(0, 0, 0, .5); flex: none; }
.favorites .cover { background: linear-gradient(135deg, #0aed7c, #03532e); }
.recent .cover { background: linear-gradient(135deg, #0d73ec, #0aed7c); }
.info { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.kind { font-size: 14px; font-weight: 500; }
h1 { margin: 0; font-size: clamp(32px, 5vw, 72px); font-weight: 800; letter-spacing: -2px; line-height: 1.05; }
.meta { margin: 0; font-size: 14px; color: rgba(255, 255, 255, .8); }

.actions { display: flex; align-items: center; gap: 20px; padding: 24px; }
.big { width: 56px; height: 56px; }
.icon-btn { color: var(--subdued); display: grid; place-items: center; }
.icon-btn:hover:not(:disabled) { color: #fff; }
.icon-btn:disabled { opacity: .4; }

.bulk {
  position: sticky; top: 64px; z-index: 4; margin: 0 24px 12px; padding: 10px 16px; border-radius: 8px;
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap; background: #2a2a2a; box-shadow: 0 8px 24px rgba(0, 0, 0, .4);
}
.bulk strong { margin-right: auto; }
.clear { color: var(--subdued); display: grid; }

.empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 48px 24px; color: var(--subdued); text-align: center; }
.empty strong { color: #fff; font-size: 22px; }

@media (max-width: 860px) {
  .hero { flex-direction: column; align-items: flex-start; }
  .cover { width: 128px; height: 128px; }
}
</style>
