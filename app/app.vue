<script setup lang="ts">
// primeiro: lê tela/pasta/busca da URL (antes de qualquer outro useState com essas chaves)
const { view, filesPath } = useUrlState()
const { jobs, currentJobId, refresh, remove, resume } = useDownloads()
const { locations, watch: watchLocations } = useDriveLocations()
const { toasts } = useToast()
const me = useMe()
const player = usePlayer()
// também aberto pelo aviso de bloqueio do YouTube (JobView)
const settingsOpen = useState('settingsOpen', () => false)
const { open: lyricsOpen, mini: lyricsMini } = useLyrics()
const pwa = usePwa()

// letra aberta e a pessoa foi para outra tela (menu, pasta, download, outra busca): a letra encolhe para o canto
const homeUrl = useState<string>('homeUrl')
watch([view, filesPath, currentJobId, homeUrl], () => {
  if (lyricsOpen.value && !lyricsMini.value) lyricsMini.value = true
})

// título da aba/janela: o que está tocando; parado, só "TuneGrab"
const windowTitle = computed(() => {
  const cur = player.current.value
  if (cur && player.playing.value) return `${cur.title}${cur.artist ? ` · ${cur.artist}` : ''} — TuneGrab`
  return 'TuneGrab' // parado: só o nome (a tela atual já aparece no próprio app)
})
useHead({ title: windowTitle })

// clicou na música do player: depois de abrir a tela de origem, rola até a linha dela e pisca
watch(player.revealReq, async (req) => {
  if (!req) return
  const sel = `[data-play-key="${CSS.escape(req.key)}"]`
  // a tela pode estar carregando (pasta, busca…): procura por até 5 s
  for (let i = 0; i < 50 && player.revealReq.value === req; i++) {
    await new Promise(r => setTimeout(r, 100))
    const row = document.querySelector<HTMLElement>(sel)
    if (!row) continue
    row.scrollIntoView({ block: 'center', behavior: 'smooth' })
    row.classList.remove('flash')
    void row.offsetWidth // reinicia a animação
    row.classList.add('flash')
    setTimeout(() => row.classList.remove('flash'), 1800)
    return
  }
})

// cada faixa tocada que está no disco entra em "Tocadas recentemente"
setPlayListener((item) => {
  if (item.file) me.recordPlay(item.file)
})

onMounted(() => {
  void refresh()
  void me.load()
  watchLocations()
  player.restore()
})

function openJob(id: string) {
  currentJobId.value = id
  view.value = 'job'
}

function openLocation(path: string) {
  filesPath.value = path
  view.value = 'files'
}

const devices = computed(() => locations.value.filter(l => l.kind !== 'folder'))
</script>

<template>
  <!-- barra de título do programa instalado (na cor do app; arrastar move a janela).
       Só ocupa espaço quando o Windows põe os botões da janela por cima (programa / app instalado) -->
  <div class="titlebar" aria-hidden="true">
    <img src="/logo.svg" alt="" class="tb-logo">
    <span class="ellipsis tb-title">{{ windowTitle }}</span>
  </div>
  <div class="shell">
    <aside class="sidebar">
      <nav class="panel nav">
        <div class="brand">
          <img src="/logo.svg" alt="" class="logo">
          <span>Tune<span class="grab">Grab</span></span>
          <button v-if="pwa.canInstall.value" class="install" title="Instalar o TuneGrab como aplicativo (ícone na área de trabalho, janela própria)" @click="pwa.install()">
            <Icon name="download" :size="14" /> Instalar
          </button>
          <button class="gear" title="Configurações" @click="settingsOpen = true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1c.5.4 1.1.7 1.7 1l.4 2.6h4l.4-2.6c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.5L19.4 13ZM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z" transform="translate(-1 0)" /></svg>
          </button>
        </div>
        <button class="nav-item" :class="{ active: view === 'home' || view === 'job' }" @click="view = 'home'">
          <Icon name="home" /> <span>Baixar</span>
        </button>
        <button class="nav-item" :class="{ active: view === 'library' }" @click="view = 'library'">
          <Icon name="music" /> <span>Biblioteca</span>
        </button>
        <button class="nav-item" :class="{ active: view === 'files' }" @click="view = 'files'; filesPath = null">
          <Icon name="folder" /> <span>Arquivos</span>
        </button>
        <button class="nav-item" :class="{ active: view === 'duplicates' }" @click="view = 'duplicates'">
          <Icon name="copy" /> <span>Repetidas</span>
        </button>
        <div class="nav-sep" />
        <button class="nav-item" :class="{ active: view === 'favorites' }" @click="view = 'favorites'">
          <span class="nav-badge fav"><svg viewBox="0 0 24 24" width="14" height="14" fill="#fff"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.5 8.2 3.4 4.5 7 4.5c2.1 0 3.6 1.2 5 3 1.4-1.8 2.9-3 5-3 3.6 0 5.5 3.7 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2Z" /></svg></span>
          <span>Favoritas</span><small v-if="me.favorites.value.length">{{ me.favorites.value.length }}</small>
        </button>
        <button class="nav-item" :class="{ active: view === 'recent' }" @click="view = 'recent'">
          <span class="nav-badge rec"><Icon name="clock" :size="14" /></span>
          <span>Recentes</span>
        </button>
      </nav>

      <section class="panel library">
        <YoutubeAccount />
        <header class="lib-head">
          <Icon name="usb" />
          <span>Dispositivos</span>
        </header>
        <div class="dev-list">
          <button v-for="l in devices" :key="l.id" class="dev" :class="{ active: view === 'files' && filesPath === l.path }" @click="openLocation(l.path)">
            <span class="dev-icon" :class="l.kind"><Icon :name="locationIcon(l.kind)" :size="20" /></span>
            <span class="lib-meta">
              <span class="ellipsis lib-title">{{ l.name }}</span>
              <span class="ellipsis lib-sub">{{ l.free != null ? `${formatBytes(l.free)} livres` : '' }}</span>
            </span>
          </button>
          <p v-if="!devices.some(d => d.kind === 'removable')" class="dev-hint">Conecte um pendrive e ele aparece aqui.</p>
        </div>

        <header class="lib-head">
          <Icon name="library" />
          <span>Seus downloads</span>
        </header>
        <div class="lib-list">
          <p v-if="!jobs.length" class="lib-empty">
            Nada por aqui ainda. Cole um link do YouTube para começar.
          </p>
          <div
            v-for="job in jobs" :key="job.id"
            class="lib-item" :class="{ active: view === 'job' && currentJobId === job.id }"
            @click="openJob(job.id)"
          >
            <img v-if="job.thumbnail" :src="job.thumbnail" alt="" class="lib-cover" referrerpolicy="no-referrer">
            <div v-else class="lib-cover placeholder"><Icon name="music" /></div>
            <div class="lib-meta">
              <span class="ellipsis lib-title" :class="{ playing: job.status === 'running' }">{{ job.title }}</span>
              <span class="ellipsis lib-sub">
                {{ job.type === 'playlist' ? 'Playlist' : 'Música' }} • {{ job.format.toUpperCase() }}
                <template v-if="job.type === 'playlist'"> • {{ job.items.length }} faixas</template>
              </span>
            </div>
            <Icon v-if="job.status === 'running'" name="loader" :size="16" class="spin lib-state" />
            <template v-else>
              <button
                v-if="job.items.some(i => i.status !== 'done')" class="lib-resume"
                :title="`Retomar: faltam ${job.items.filter(i => i.status !== 'done').length}`" @click.stop="resume(job.id)"
              >
                <Icon name="refresh" :size="16" />
              </button>
              <button class="lib-remove" title="Remover da lista" @click.stop="remove(job.id)">
                <Icon name="close" :size="16" />
              </button>
            </template>
          </div>
        </div>
      </section>
    </aside>

    <main class="panel main">
      <HomeView v-if="view === 'home'" @started="openJob" />
      <JobView v-else-if="view === 'job'" @back="view = 'home'" />
      <FilesView v-else-if="view === 'files'" />
      <LibraryView v-else-if="view === 'library'" />
      <DuplicatesView v-else-if="view === 'duplicates'" />
      <CollectionView v-else-if="view === 'favorites'" key="fav" mode="favorites" />
      <CollectionView v-else-if="view === 'recent'" key="rec" mode="recent" />
    </main>

    <!-- letra: por cima da tela atual (que continua do jeito que estava embaixo) -->
    <LyricsPanel v-if="lyricsOpen" />

    <PlayerBar @open-job="openJob" />
    <VideoPanel />

    <DialogHost />
    <SettingsDialog v-model="settingsOpen" />
    <ClientOnly><UpdateBanner /></ClientOnly>
    <div class="toasts">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="{ error: t.error }">{{ t.text }}</div>
    </div>
  </div>
</template>

<style scoped>
.shell {
  height: 100vh;
  display: grid;
  grid-template-columns: 320px 1fr;
  grid-template-rows: minmax(0, 1fr) auto;
  gap: 8px;
  padding: 8px;
  /* programa instalado: abre espaço para a barra de título (no navegador o valor é 0) */
  padding-top: max(8px, env(titlebar-area-height, 0px));
}
.titlebar {
  position: fixed; z-index: 100; top: env(titlebar-area-y, 0); left: env(titlebar-area-x, 0);
  width: env(titlebar-area-width, 0); height: env(titlebar-area-height, 0); overflow: hidden;
  display: flex; align-items: center; gap: 8px; padding: 0 12px;
  background: var(--bg); color: var(--muted); font-size: 12px; font-weight: 600;
  app-region: drag; -webkit-app-region: drag; user-select: none;
}
.tb-logo { width: 14px; height: 17px; flex: none; }
.tb-title { min-width: 0; }
.panel { background: var(--panel); border-radius: var(--radius); }
.sidebar { display: flex; flex-direction: column; gap: 8px; min-height: 0; grid-column: 1; grid-row: 1; }
.nav { padding: 16px 12px; display: flex; flex-direction: column; gap: 4px; }
.brand { display: flex; align-items: center; gap: 10px; font-size: 22px; font-weight: 800; padding: 0 12px 12px; letter-spacing: -.5px; }
.gear { margin-left: auto; color: var(--subdued); display: grid; place-items: center; padding: 4px; border-radius: 50%; }
.gear:hover { color: #fff; background: var(--highlight); }
.logo { width: 30px; height: 36px; flex: none; }
.grab { color: #0aed7c; }
.install {
  margin-left: auto; display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 10px; border-radius: 999px;
  font-size: 12px; font-weight: 700; letter-spacing: 0; color: #000; background: #fff;
}
.install:hover { transform: scale(1.04); }
.install + .gear { margin-left: 4px; }
.nav-item { display: flex; align-items: center; gap: 20px; padding: 8px 12px; font-weight: 700; color: var(--subdued); transition: color .15s; text-align: left; }
.nav-item:hover, .nav-item.active { color: var(--text); }
.nav-item small { margin-left: auto; font-size: 12px; color: var(--muted); font-weight: 600; }
.nav-sep { height: 1px; background: #282828; margin: 6px 12px; }
.nav-badge { width: 24px; height: 24px; border-radius: 4px; display: grid; place-items: center; flex: none; }
.nav-badge.fav { background: linear-gradient(135deg, #450af5, #c4efd9); }
.nav-badge.rec { background: linear-gradient(135deg, #0d73ec, #1ed760); color: #fff; }

.library { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow-y: auto; }
.lib-head { display: flex; align-items: center; gap: 12px; padding: 16px 24px 8px; color: var(--subdued); font-weight: 700; }
.dev-list { padding: 0 8px 8px; }
.dev { display: flex; align-items: center; gap: 12px; width: 100%; padding: 8px; border-radius: 6px; text-align: left; }
.dev:hover { background: var(--highlight); }
.dev.active { background: #333; }
.dev-icon { width: 40px; height: 40px; border-radius: 4px; display: grid; place-items: center; background: #333; color: #ddd; flex: none; }
.dev-icon.removable { background: var(--green); color: #000; }
.dev-icon.network { background: #0d73ec; color: #fff; }
.dev-hint { margin: 4px 8px 0; font-size: 13px; color: var(--muted); }

.lib-list { padding: 8px; }
.lib-empty { color: var(--subdued); font-size: 14px; padding: 16px; margin: 8px; border-radius: var(--radius); background: var(--elevated); line-height: 1.5; }
.lib-item { display: flex; align-items: center; gap: 12px; padding: 8px; border-radius: 6px; cursor: pointer; }
.lib-item:hover { background: var(--highlight); }
.lib-item.active { background: #333; }
.lib-cover { width: 48px; height: 48px; border-radius: 4px; object-fit: cover; flex: none; }
.lib-cover.placeholder { display: grid; place-items: center; background: #333; color: var(--muted); }
.lib-meta { display: flex; flex-direction: column; min-width: 0; flex: 1; gap: 2px; }
.lib-title { font-weight: 500; }
.lib-title.playing { color: var(--green); }
.lib-sub { font-size: 14px; color: var(--subdued); }
.lib-state { color: var(--green); }
.lib-remove { color: var(--subdued); opacity: 0; padding: 4px; }
.lib-item:hover .lib-remove { opacity: 1; }
.lib-remove:hover { color: #fff; }
.lib-resume { color: #ffa42b; padding: 4px; display: grid; }
.lib-resume:hover { color: #fff; }

/* posição fixa: o painel de letra ocupa o mesmo lugar, por cima */
.main { overflow-y: auto; position: relative; min-width: 0; grid-column: 2; grid-row: 1; }

.toasts { position: fixed; left: 50%; bottom: 96px; transform: translateX(-50%); display: flex; flex-direction: column; gap: 8px; align-items: center; z-index: 200; pointer-events: none; }
.toast { background: #2e77d0; color: #fff; padding: 10px 18px; border-radius: 8px; font-size: 14px; font-weight: 600; box-shadow: 0 8px 24px rgba(0, 0, 0, .5); animation: pop .2s ease-out; max-width: 80vw; }
.toast.error { background: #e91429; }
@keyframes pop { from { opacity: 0; transform: translateY(8px); } }

@media (max-width: 860px) {
  .shell { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr) auto; }
  .sidebar { flex-direction: row; }
  .library { display: none; }
  .main { grid-column: 1; grid-row: 2; }
  .nav { flex-direction: row; align-items: center; flex: 1; padding: 8px 12px; overflow-x: auto; }
  .nav-item { gap: 8px; }
  .nav-item span { display: none; }
  .brand { padding: 0 12px 0 0; }
}
</style>
