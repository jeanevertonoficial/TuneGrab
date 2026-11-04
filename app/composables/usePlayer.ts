export interface PlayItem {
  /** chave única (caminho do arquivo ou id do download) */
  key: string
  src: string
  title: string
  artist: string
  cover: string | null
  /** MP4/WebM: mostra o vídeo no painel */
  video?: boolean
  /** dados do arquivo no disco: usado para favoritar e para "tocadas recentemente" */
  file?: { path: string, name: string, title: string | null, artist: string | null, album: string | null, duration: number | null, hasCover: boolean }
}

/** Converte um arquivo listado pela API em item tocável. */
export function fileToPlayItem(f: { path: string, name: string, title?: string | null, artist?: string | null, album?: string | null, duration?: number | null, hasCover?: boolean, mtime?: number }): PlayItem {
  const q = encodeURIComponent(f.path)
  return {
    key: f.path,
    src: `/api/fs/stream?path=${q}`,
    title: f.title || f.name.replace(/\.[^.]+$/, ''),
    artist: f.artist || '',
    cover: f.hasCover ? coverUrl(f.path, f.mtime) : null,
    video: /\.(mp4|webm)$/i.test(f.name),
    file: { path: f.path, name: f.name, title: f.title ?? null, artist: f.artist ?? null, album: f.album ?? null, duration: f.duration ?? null, hasCover: !!f.hasCover },
  }
}

/** chave no player de uma música do YouTube ouvida antes de baixar */
export const previewKey = (id: string) => `yt:${id}`

/** Música do YouTube (busca, playlist…) tocada direto do YouTube, sem baixar. Não entra nas Recentes. */
export function trackToPreview(t: { id: string, title: string, artist: string, thumbnail: string | null }): PlayItem {
  return { key: previewKey(t.id), src: `/api/preview/${t.id}`, title: t.title, artist: t.artist, cover: t.thumbnail }
}

/** URL da capa; o "v" muda quando o arquivo é editado, para o navegador não mostrar a capa antiga */
export function coverUrl(path: string, mtime?: number) {
  return `/api/fs/cover?path=${encodeURIComponent(path)}${mtime ? `&v=${Math.round(mtime)}` : ''}`
}

let audio: HTMLVideoElement | null = null
let onPlay: ((item: PlayItem) => void) | null = null
let wantPlay = false
let restored = false
let lastRecorded: string | null = null
let pendingVideoMode: 'mini' | 'expanded' | null = null
let failures = 0
const SAVE_KEY = 'tunegrab:player'

/** De onde a fila foi tocada (para o clique na música do player voltar até lá). */
export interface PlayOrigin {
  view: string
  filesPath?: string | null
  jobId?: string | null
  homeUrl?: string
  /** tocada da pré-lista */
  prelist?: boolean
}

/** Avisado sempre que uma faixa começa (usado para "tocadas recentemente"). */
export function setPlayListener(fn: (item: PlayItem) => void) {
  onPlay = fn
}

/** O mesmo elemento toca áudio e vídeo; o VideoPanel o encaixa na tela. */
export function mediaElement() {
  return audio
}

export function usePlayer() {
  const queue = useState<PlayItem[]>('playerQueue', () => [])
  const index = useState('playerIndex', () => -1)
  const playing = useState('playerPlaying', () => false)
  const time = useState('playerTime', () => 0)
  const duration = useState('playerDuration', () => 0)
  const volume = useState('playerVolume', () => 0.8)
  const muted = useState('playerMuted', () => false)
  const shuffle = useState('playerShuffle', () => false)
  const repeat = useState<'off' | 'all' | 'one'>('playerRepeat', () => 'off')
  /** painel de vídeo: mini (canto), expandido (tela do app) ou escondido */
  const videoMode = useState<'mini' | 'expanded' | 'hidden'>('videoMode', () => 'mini')
  const buffering = useState('playerBuffering', () => false)
  const origin = useState<PlayOrigin | null>('playerOrigin', () => null)
  /** pedido de mostrar a música tocando na lista (as listas rolam até ela e piscam) */
  const revealReq = useState<{ key: string, at: number } | null>('playerReveal', () => null)

  const current = computed(() => queue.value[index.value] ?? null)

  function el() {
    if (import.meta.server) return null
    if (!audio) {
      audio = document.createElement('video')
      audio.preload = 'auto'
      audio.playsInline = true
      audio.volume = volume.value
      audio.addEventListener('timeupdate', () => (time.value = audio!.currentTime))
      audio.addEventListener('durationchange', () => (duration.value = audio!.duration || 0))
      audio.addEventListener('play', () => (playing.value = true))
      audio.addEventListener('pause', () => (playing.value = false))
      audio.addEventListener('ended', onEnded)
      audio.addEventListener('playing', () => {
        failures = 0
        buffering.value = false
      })
      // carregando (ex.: música do YouTube que o servidor ainda está buscando)
      audio.addEventListener('waiting', () => (buffering.value = true))
      audio.addEventListener('pause', () => (buffering.value = false))
      audio.addEventListener('error', () => {
        if (!audio!.getAttribute('src')) return // soltamos o arquivo de propósito (excluir/mover)
        // arquivo removido/ilegível: pula para o próximo (só se a pessoa estava ouvindo).
        // Para depois de falhar a fila inteira (senão, com "repetir tudo", ficava pulando sem fim)
        if (!wantPlay) return
        failures++
        if (queue.value.length > 1 && failures < queue.value.length) next()
        else useToast().notify('Não foi possível tocar: arquivo indisponível', true)
      })
    }
    return audio
  }

  function load(i: number, autoplay = true, startAt = 0) {
    const a = el()
    const item = queue.value[i]
    if (!a || !item) return
    index.value = i
    wantPlay = autoplay
    // só abre o painel de vídeo quando a pessoa manda tocar (restaurar a fila não abre nada)
    if (autoplay && item.video && videoMode.value === 'hidden') videoMode.value = 'mini'
    if (autoplay) {
      lastRecorded = item.key
      onPlay?.(item)
    }
    a.src = item.src
    buffering.value = autoplay
    time.value = startAt
    // música do YouTube: o servidor já prepara a próxima da fila (cada uma leva ~5 s para liberar)
    const upcoming = queue.value[i + 1]
    if (autoplay && upcoming?.key.startsWith('yt:')) void $fetch(upcoming.src, { query: { warm: 1 } }).catch(() => {})
    if (startAt) a.addEventListener('loadedmetadata', () => (a.currentTime = startAt), { once: true })
    if (autoplay) void a.play().catch(() => {})
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: item.title,
        artist: item.artist,
        artwork: item.cover ? [{ src: item.cover }] : [],
      })
      // teclas de mídia do teclado, fone Bluetooth e o controle de mídia do Windows
      const ms = navigator.mediaSession
      const set = (action: MediaSessionAction, fn: MediaSessionActionHandler) => {
        try {
          ms.setActionHandler(action, fn)
        }
        catch { /* ação não suportada neste navegador */ }
      }
      set('nexttrack', next)
      set('previoustrack', prev)
      set('play', () => el()?.paused && toggle())
      set('pause', () => el()?.pause())
      set('seekto', d => d.seekTime != null && seek(d.seekTime))
      set('seekbackward', d => seek(Math.max(0, (el()?.currentTime ?? 0) - (d.seekOffset ?? 10))))
      set('seekforward', d => seek((el()?.currentTime ?? 0) + (d.seekOffset ?? 10)))
    }
  }

  /** a tela atual (vira a origem da fila) */
  function here(): PlayOrigin {
    const info = useState<{ source?: string } | null>('homeInfo').value
    return {
      view: useState<string>('view').value,
      filesPath: useState<string | null>('filesPath').value,
      jobId: useState<string | null>('currentJobId').value,
      homeUrl: useState<string>('homeUrl').value,
      prelist: info?.source === 'prelist',
    }
  }

  /** Toca uma lista, começando pelo item `start`. `from`: de onde veio (padrão: a tela atual). */
  function playList(items: PlayItem[], start = 0, from?: PlayOrigin) {
    if (!items.length) return
    origin.value = from ?? here()
    failures = 0
    queue.value = items
    load(start)
  }

  function toggle() {
    const a = el()
    if (!a || !current.value) return
    if (a.paused) {
      wantPlay = true
      // faixa de vídeo restaurada: o painel volta como estava só quando der play
      if (pendingVideoMode && current.value.video) videoMode.value = pendingVideoMode
      pendingVideoMode = null
      // faixa restaurada após recarregar: conta como tocada quando a pessoa dá play
      if (lastRecorded !== current.value.key) {
        lastRecorded = current.value.key
        onPlay?.(current.value)
      }
      void a.play()
    }
    else a.pause()
  }

  /** Salva fila, faixa, posição e volume (para continuar de onde parou depois de recarregar). */
  function persist() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        queue: queue.value.slice(0, 1000),
        index: index.value,
        time: Math.floor(time.value),
        volume: volume.value,
        shuffle: shuffle.value,
        repeat: repeat.value,
        videoMode: videoMode.value,
        origin: origin.value,
      }))
    }
    catch {}
  }

  /** Chamado uma vez ao abrir o app: volta a faixa de antes, pausada no mesmo ponto. */
  function restore() {
    if (import.meta.server || restored) return
    restored = true
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null')
      if (s) {
        volume.value = s.volume ?? 0.8
        origin.value = s.origin ?? null
        shuffle.value = !!s.shuffle
        repeat.value = s.repeat ?? 'off'
        // depois de recarregar o painel fica fechado; reabre (como estava) ao dar play
        pendingVideoMode = s.videoMode === 'hidden' ? null : (s.videoMode ?? 'mini')
        videoMode.value = 'hidden'
        const a = el()
        if (a) a.volume = volume.value
        if (Array.isArray(s.queue) && s.queue.length && s.index >= 0) {
          queue.value = s.queue
          load(Math.min(s.index, s.queue.length - 1), false, s.time || 0)
        }
      }
    }
    catch {}
    watch([queue, index, volume, shuffle, repeat, videoMode, origin], persist)
    // posição: grava a cada ~5 s de música e ao sair da página
    let last = 0
    watch(time, (t) => {
      if (Math.abs(t - last) >= 5) {
        last = t
        persist()
      }
    })
    window.addEventListener('pagehide', persist)
  }

  function next() {
    const n = queue.value.length
    if (!n) return
    if (shuffle.value && n > 1) {
      let r = index.value
      while (r === index.value) r = Math.floor(Math.random() * n)
      return load(r)
    }
    if (index.value + 1 < n) load(index.value + 1)
    else if (repeat.value === 'all') load(0)
    else el()?.pause()
  }

  function prev() {
    const a = el()
    if (!a) return
    // como no Spotify: se já tocou um pouco, volta ao início da faixa
    if (a.currentTime > 3 || index.value <= 0) a.currentTime = 0
    else load(index.value - 1)
  }

  function onEnded() {
    if (repeat.value === 'one') {
      audio!.currentTime = 0
      void audio!.play()
    }
    else next()
  }

  function seek(t: number) {
    const a = el()
    if (a && Number.isFinite(t)) a.currentTime = t
  }

  function setVolume(v: number) {
    volume.value = v
    muted.value = v === 0
    const a = el()
    if (a) {
      a.volume = v
      a.muted = false
    }
  }

  function toggleMute() {
    muted.value = !muted.value
    const a = el()
    if (a) a.muted = muted.value
  }

  function cycleRepeat() {
    repeat.value = repeat.value === 'off' ? 'all' : repeat.value === 'all' ? 'one' : 'off'
  }

  /** o caminho é o arquivo ou está dentro da pasta? */
  const inside = (key: string, paths: string[]) => {
    const k = key.toLowerCase()
    return paths.some((p) => {
      const q = p.toLowerCase()
      return k === q || k.startsWith(`${q}\\`) || k.startsWith(`${q}/`)
    })
  }

  /**
   * Antes de excluir/mover/editar: se a faixa carregada (mesmo pausada) é um desses arquivos,
   * o player solta o arquivo. Senão o navegador segura a conexão aberta e o Windows não apaga.
   * Devolve a posição para voltar a tocar depois (editar tags/renomear).
   */
  function release(paths: string[]) {
    const cur = current.value
    if (!audio || !cur || !inside(cur.key, paths)) return null
    const state = { time: audio.currentTime, playing: !audio.paused }
    audio.pause()
    audio.removeAttribute('src')
    audio.load() // cancela o download em andamento: o servidor fecha o arquivo
    return state
  }

  /** Remove da fila arquivos que foram excluídos/movidos (ou tudo dentro de uma pasta excluída). */
  function forget(keys: string[]) {
    const cur = current.value?.key
    release(keys)
    queue.value = queue.value.filter(q => !inside(q.key, keys))
    index.value = queue.value.findIndex(q => q.key === cur)
  }

  /** Volta a tocar a faixa atual depois de release() (o arquivo pode ter mudado de nome). */
  function reload(state: { time: number, playing: boolean } | null, rename?: { from: string, to: string }) {
    if (!state || index.value < 0) return
    const item = queue.value[index.value]
    if (!item) return
    if (rename && item.key.toLowerCase() === rename.from.toLowerCase()) {
      const name = rename.to.split(/[\\/]/).pop()!
      queue.value[index.value] = { ...item, key: rename.to, src: `/api/fs/stream?path=${encodeURIComponent(rename.to)}`, file: item.file && { ...item.file, path: rename.to, name } }
    }
    load(index.value, state.playing, state.time)
  }

  /**
   * Volta para onde a música está tocando (pasta, download, busca, pré-lista, favoritas…)
   * e pede para a lista rolar até ela.
   */
  function reveal() {
    const o = origin.value
    const cur = current.value
    if (!o || !cur) return
    const view = useState<string>('view')
    view.value = o.view
    if (o.view === 'files') useState<string | null>('filesPath').value = o.filesPath ?? null
    if (o.view === 'job' && o.jobId) useState<string | null>('currentJobId').value = o.jobId
    if (o.view === 'home') {
      const info = useState<{ source?: string } | null>('homeInfo').value
      const homeUrl = useState<string>('homeUrl')
      if (o.prelist) {
        if (info?.source !== 'prelist') useState('openPreListReq', () => false).value = true
      }
      else if (o.homeUrl && (o.homeUrl !== homeUrl.value || !info)) useState<string | null>('openLink').value = o.homeUrl
    }
    revealReq.value = { key: cur.key, at: Date.now() }
  }

  return { origin, reveal, revealReq, el, restore, videoMode, buffering, queue, index, current, playing, time, duration, volume, muted, shuffle, repeat, playList, toggle, next, prev, seek, setVolume, toggleMute, cycleRepeat, forget, release, reload }
}
