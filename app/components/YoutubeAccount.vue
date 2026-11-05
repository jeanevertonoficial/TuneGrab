<script setup lang="ts">
/** Conta do YouTube na barra lateral: entrar (login guiado), perfil e as listas da conta. */
const { status, busy, connected, refresh, start, cancel, logout, renew } = useYoutubeLogin()
const view = useState<string>('view')
const openLink = useState<string | null>('openLink', () => null)
const homeUrl = useState('homeUrl', () => '')

interface AccountList { id: string, title: string, url: string, thumbnail: string | null }
const playlists = ref<AccountList[]>([])
const loadingLists = ref(false)
// muitas playlists empurrariam Dispositivos e downloads para baixo: mostra poucas e "Mais…"
const FEW = 4
const showAll = ref(false)
const shownPlaylists = computed(() => (showAll.value ? playlists.value : playlists.value.slice(0, FEW)))
const broken = reactive(new Set<string>())

const fixed = [
  { id: 'LL', title: 'Músicas curtidas', url: 'https://www.youtube.com/playlist?list=LL', icon: 'heart', color: 'linear-gradient(135deg, #0aed7c, #03532e)' },
  { id: 'WL', title: 'Assistir mais tarde', url: 'https://www.youtube.com/playlist?list=WL', icon: 'clock', color: 'linear-gradient(135deg, #e8115b, #ff9900)' },
  { id: 'subs', title: 'Inscrições', url: 'https://www.youtube.com/feed/subscriptions', icon: 'library', color: 'linear-gradient(135deg, #0d73ec, #0aed7c)' },
]

const menu = [
  { id: 'renew', label: 'Renovar login', icon: 'refresh' },
  { id: 'switch', label: 'Trocar de conta', icon: 'edit' },
  { id: 'logout', label: 'Sair da conta', icon: 'close', danger: true },
]

onMounted(refresh)

async function loadLists(fresh = false) {
  if (!connected.value) {
    playlists.value = []
    return
  }
  loadingLists.value = true
  playlists.value = await $fetch<AccountList[]>('/api/youtube/playlists', { query: fresh ? { fresh: 1 } : {} }).catch(() => [])
  loadingLists.value = false
}
watch(connected, () => void loadLists(), { immediate: true })

/** abre a lista na tela Baixar (dá para ouvir, mandar para a pré-lista e baixar) */
function openList(url: string) {
  openLink.value = url
  view.value = 'home'
}
const isOpen = (url: string) => view.value === 'home' && homeUrl.value === url

async function onMenu(id: string) {
  if (id === 'renew') return renew()
  if (id === 'logout') return logout()
  if (id === 'switch') {
    await logout()
    return start()
  }
}
</script>

<template>
  <div class="yt">
    <header class="yt-head">
      <span class="yt-logo"><svg viewBox="0 0 24 24" width="14" height="14"><path fill="#fff" d="M9.5 7.5v9l7-4.5z" /></svg></span>
      Seu YouTube
      <button v-if="connected" class="yt-refresh" title="Atualizar playlists" @click="loadLists(true)">
        <Icon name="refresh" :size="16" :class="{ spin: loadingLists }" />
      </button>
    </header>

    <!-- sem login -->
    <div v-if="status.state === 'none'" class="yt-card">
      <p>Entre com a sua conta para o YouTube não pedir <b>"não sou um robô"</b> e para ver suas curtidas e playlists aqui.</p>
      <button class="btn-green small" :disabled="busy" @click="start">
        <Icon v-if="busy" name="loader" :size="16" class="spin" /> Entrar no YouTube
      </button>
      <small>Abre uma janela do Chrome só do TuneGrab. Sua senha fica só nela; o app guarda apenas a sessão, neste computador.</small>
    </div>

    <!-- janela de login aberta -->
    <div v-else-if="status.state === 'waiting' && status.reading" class="yt-card waiting">
      <p><Icon name="loader" :size="16" class="spin" /> Lendo sua sessão…</p>
      <small>Leva alguns segundos.</small>
    </div>
    <div v-else-if="status.state === 'waiting'" class="yt-card waiting">
      <p><Icon name="loader" :size="16" class="spin" /> <span>Entre na sua conta na janela do <b>{{ status.browser ?? 'navegador' }}</b> que abriu.</span></p>
      <small>Quando aparecer a página inicial do YouTube já com a sua conta, <b>feche a janela</b>. O app lê a sessão e você aparece aqui.</small>
      <button class="btn-text small" @click="cancel">Cancelar</button>
    </div>

    <!-- conectado -->
    <template v-else>
      <div class="profile">
        <img v-if="status.account?.photo" :src="status.account.photo" alt="" class="avatar" referrerpolicy="no-referrer">
        <span v-else class="avatar none">{{ (status.account?.name ?? '?').slice(0, 1).toUpperCase() }}</span>
        <span class="lib-meta">
          <span class="ellipsis p-name">{{ status.account?.name }}</span>
          <span class="ellipsis p-sub"><i class="dot" /> Conectado{{ status.account?.handle ? ` • ${status.account.handle}` : '' }}</span>
        </span>
        <RowMenu :items="menu" @select="onMenu" />
      </div>

      <button v-for="l in fixed" :key="l.id" class="yt-item" :class="{ active: isOpen(l.url) }" @click="openList(l.url)">
        <span class="yt-cover" :style="{ background: l.color }"><Icon :name="l.icon" :size="18" /></span>
        <span class="ellipsis">{{ l.title }}</span>
      </button>
      <button v-for="p in shownPlaylists" :key="p.id" class="yt-item" :class="{ active: isOpen(p.url) }" :title="p.title" @click="openList(p.url)">
        <img v-if="p.thumbnail && !broken.has(p.id)" :src="p.thumbnail" alt="" class="yt-cover" referrerpolicy="no-referrer" @error="broken.add(p.id)">
        <span v-else class="yt-cover"><Icon name="music" :size="18" /></span>
        <span class="ellipsis">{{ p.title }}</span>
      </button>
      <button v-if="playlists.length > FEW" class="yt-more" @click="showAll = !showAll">
        {{ showAll ? 'Mostrar menos' : `Mais ${playlists.length - FEW} playlists` }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.yt { padding: 0 8px 8px; }
.yt-head { display: flex; align-items: center; gap: 10px; padding: 16px 16px 8px; color: var(--subdued); font-weight: 700; }
.yt-logo { width: 22px; height: 16px; border-radius: 4px; background: #f00; display: grid; place-items: center; }
.yt-refresh { margin-left: auto; color: var(--muted); display: grid; padding: 4px; }
.yt-refresh:hover { color: #fff; }
.yt-card { margin: 4px 8px; padding: 14px; border-radius: 8px; background: var(--elevated); display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
.yt-card p { margin: 0; font-size: 13px; line-height: 1.45; color: var(--text); }
.yt-card.waiting p { display: flex; gap: 8px; align-items: flex-start; }
.yt-card.waiting p .spin { flex: none; margin-top: 2px; }
.yt-card small { font-size: 11px; color: var(--muted); line-height: 1.4; }
.yt-card .btn-green { display: inline-flex; align-items: center; gap: 6px; }
.yt-card.waiting { border: 1px solid var(--green); }
.profile { display: flex; align-items: center; gap: 12px; padding: 8px; border-radius: 6px; }
.profile:hover { background: var(--highlight); }
.avatar { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; flex: none; }
.avatar.none { display: grid; place-items: center; background: #c2185b; color: #fff; font-weight: 800; }
.lib-meta { display: flex; flex-direction: column; min-width: 0; flex: 1; gap: 2px; }
.p-name { font-weight: 700; }
.p-sub { font-size: 12px; color: var(--subdued); display: flex; align-items: center; gap: 5px; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--green); flex: none; }
.yt-item { display: flex; align-items: center; gap: 12px; width: 100%; padding: 6px 8px; border-radius: 6px; text-align: left; font-size: 14px; color: var(--text); }
.yt-item:hover { background: var(--highlight); }
.yt-item.active { background: #333; }
.yt-more { padding: 6px 8px 6px 52px; font-size: 13px; font-weight: 700; color: var(--subdued); }
.yt-more:hover { color: #fff; text-decoration: underline; }
.yt-cover { width: 32px; height: 32px; border-radius: 4px; object-fit: cover; flex: none; display: grid; place-items: center; background: #333; color: #fff; }
.spin { animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
