import type { PlayItem } from './usePlayer'

export interface Track {
  id: string
  url: string
  title: string
  artist: string
  duration: number | null
  thumbnail: string | null
  /** canal: aba de onde veio (Vídeos, Shorts, Ao vivo) */
  section?: string
  album?: string | null
}

export interface MediaInfo {
  type: 'video' | 'playlist' | 'channel'
  /** de onde veio a lista: youtube (padrão), spotify, deezer ou text (lista colada) */
  source?: 'youtube' | 'spotify' | 'deezer' | 'text' | 'search' | 'prelist' | 'other'
  /** playlist ou álbum (Spotify/Deezer) */
  kind?: 'playlist' | 'album'
  id: string
  title: string
  author: string
  thumbnail: string | null
  url: string
  tracks: Track[]
}

export interface FormatChoice {
  format: string
  quality: string
  /** só MP4: vp9 (leve, padrão) ou h264 (compatível com aparelhos antigos) */
  codec?: 'vp9' | 'h264'
}

export type ItemStatus = 'queued' | 'searching' | 'downloading' | 'converting' | 'saving' | 'done' | 'error' | 'canceled'

export interface JobItem extends Track {
  index: number
  status: ItemStatus
  progress: number
  error?: string
  fileName: string | null
  savedTo?: string
  /** Spotify/Deezer/lista: vídeo do YouTube escolhido na busca */
  matched?: { url: string, title: string, channel: string }
  /** pronta, mas o arquivo salvo não existe mais (excluído, movido ou pendrive fora) */
  missing?: boolean
}

export interface Job {
  id: string
  title: string
  type: 'video' | 'playlist' | 'channel'
  thumbnail: string | null
  format: string
  quality: string
  status: 'running' | 'done' | 'error' | 'canceled'
  createdAt: number
  codec?: 'vp9' | 'h264'
  sourceUrl?: string
  destination: string | null
  items: JobItem[]
}

export function formatDuration(s: number | null | undefined) {
  if (!s && s !== 0) return '–'
  s = Math.round(s)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

export function jobProgress(job: Job) {
  const active = job.items.filter(i => i.status !== 'canceled')
  if (!active.length) return 0
  return active.reduce((a, i) => a + (i.status === 'done' || i.status === 'error' ? 100 : i.progress), 0) / active.length
}

export function fileUrl(job: Job, index?: number) {
  return `/api/jobs/${job.id}/file${index !== undefined ? `?item=${index}` : ''}`
}

/** Faixas prontas de um download, no formato do player. */
export function jobPlayItems(job: Job): PlayItem[] {
  return job.items.filter(i => i.status === 'done' && !i.missing).map(i => ({
    video: job.format === 'mp4',
    key: i.savedTo ?? `${job.id}:${i.index}`,
    src: i.savedTo ? `/api/fs/stream?path=${encodeURIComponent(i.savedTo)}` : `${fileUrl(job, i.index)}&inline=1`,
    title: i.title,
    artist: i.artist,
    cover: i.thumbnail,
    // salvo numa pasta: dá para favoritar e entra nas "tocadas recentemente"
    file: i.savedTo
      ? { path: i.savedTo, name: i.savedTo.split(/[\\/]/).pop()!, title: i.title, artist: i.artist, album: null, duration: i.duration, hasCover: true }
      : undefined,
  }))
}

/** Dispara o download no navegador sem sair da página. */
export function triggerDownload(url: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = ''
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export function useDownloads() {
  const jobs = useState<Job[]>('jobs', () => [])
  const currentJobId = useState<string | null>('currentJobId', () => null)
  const autoSaved = useState<Record<string, boolean>>('autoSaved', () => ({}))
  const timer = useState<ReturnType<typeof setTimeout> | null>('jobsTimer', () => null)
  const loaded = useState('jobsLoaded', () => false)

  const currentJob = computed(() => jobs.value.find(j => j.id === currentJobId.value) ?? jobs.value[0] ?? null)

  async function refresh() {
    try {
      jobs.value = await $fetch<Job[]>('/api/jobs')
    }
    catch { /* servidor reiniciando, tenta de novo */ }

    // ao abrir a página, não baixa de novo o que já tinha terminado
    if (!loaded.value) {
      loaded.value = true
      for (const job of jobs.value) if (job.status !== 'running') autoSaved.value[job.id] = true
    }
    // quando um download termina, salva o arquivo automaticamente
    for (const job of jobs.value) {
      if (job.status === 'done' && !autoSaved.value[job.id]) {
        autoSaved.value[job.id] = true
        // com pasta de destino, o arquivo já foi gravado lá; não precisa baixar pelo navegador
        if (!job.destination) triggerDownload(fileUrl(job))
      }
    }
    schedule()
  }

  function schedule() {
    if (import.meta.server) return
    if (timer.value) clearTimeout(timer.value)
    const busy = jobs.value.some(j => j.status === 'running')
    timer.value = setTimeout(refresh, busy ? 700 : 4000)
  }

  async function start(payload: { title: string, type: 'video' | 'playlist', thumbnail: string | null, formats: FormatChoice[], tracks: Track[], destination: string | null, subfolder: boolean, folderName?: string, sourceUrl?: string, skipExisting?: boolean, replace?: boolean }) {
    const created = await $fetch<Job[]>('/api/jobs', { method: 'POST', body: payload })
    if (!created.length) return created // tudo já existia ("só o que falta")
    jobs.value = [...created, ...jobs.value]
    currentJobId.value = created[0]!.id
    schedule()
    return created
  }

  async function resume(id: string) {
    const job = await $fetch<Job>(`/api/jobs/${id}/resume`, { method: 'POST' })
    jobs.value = jobs.value.map(j => (j.id === id ? job : j))
    autoSaved.value[id] = false // ao terminar, baixa pelo navegador de novo (se não tiver pasta)
    schedule()
  }

  async function cancel(id: string) {
    await $fetch(`/api/jobs/${id}/cancel`, { method: 'POST' })
    await refresh()
  }

  async function remove(id: string) {
    await $fetch(`/api/jobs/${id}`, { method: 'DELETE' })
    if (currentJobId.value === id) currentJobId.value = null
    await refresh()
  }

  return { jobs, currentJob, currentJobId, autoSaved, refresh, start, cancel, resume, remove }
}
