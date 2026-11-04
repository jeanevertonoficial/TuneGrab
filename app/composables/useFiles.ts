export interface DriveLocation {
  id: string
  name: string
  path: string
  kind: 'removable' | 'disk' | 'network' | 'folder'
  size: number | null
  free: number | null
}

export interface FsFile {
  name: string
  path: string
  size: number
  title: string | null
  artist: string | null
  album: string | null
  duration: number | null
  hasCover: boolean
  bitrate?: number | null
  /** data de modificação (ms); muda quando as tags são editadas */
  mtime?: number
  /** listagem rápida: tags ainda não lidas */
  pending?: boolean
}

export interface FsListing {
  path: string
  parent: string | null
  location: DriveLocation | null
  folders: { name: string, path: string }[]
  files: FsFile[]
}

/** A localização (unidade/pasta) mais específica que contém o caminho. */
export function locationOf(path: string, locations: DriveLocation[]) {
  const p = path.toLowerCase()
  return locations
    .filter((l) => {
      const root = l.path.toLowerCase().replace(/[\\/]$/, '')
      return p === root || p === `${root}\\` || p.startsWith(`${root}\\`) || p.startsWith(`${root}/`)
    })
    .sort((a, b) => b.path.length - a.path.length)[0] ?? null
}

/** "LINUX MINT (USB) › Músicas" em vez de \\?\Volume{…}\Músicas */
export function friendlyPath(path: string, locations: DriveLocation[]) {
  const loc = locationOf(path, locations)
  if (!loc) return path
  const rest = path.slice(loc.path.replace(/[\\/]$/, '').length).split(/[\\/]/).filter(Boolean)
  return [loc.name, ...rest].join(' › ')
}

export const locationIcon =(k: DriveLocation['kind']) => ({ removable: 'usb', disk: 'disk', network: 'network', folder: 'folder' })[k]

export function formatBytes(n: number | null | undefined) {
  if (!n && n !== 0) return ''
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(i >= 3 ? 1 : 0)} ${u[i]}`
}

export const errorMessage = (e: any, fallback = 'Algo deu errado') =>
  e?.data?.message || e?.data?.statusMessage || e?.statusMessage || fallback

/** Unidades e atalhos; atualiza sozinho para detectar pendrive conectado/removido. */
export function useDriveLocations() {
  const locations = useState<DriveLocation[]>('locations', () => [])
  const timer = useState<ReturnType<typeof setInterval> | null>('locationsTimer', () => null)
  const { notify } = useToast()

  async function refresh() {
    try {
      const next = await $fetch<DriveLocation[]>('/api/locations')
      // nada mudou: não troca a lista (senão todas as telas que dependem dela se redesenham a cada 5 s)
      if (JSON.stringify(next) === JSON.stringify(locations.value)) return
      const before = new Set(locations.value.map(l => l.id))
      const after = new Set(next.map(l => l.id))
      if (locations.value.length) {
        for (const l of next) if (l.kind === 'removable' && !before.has(l.id)) notify(`${l.name} conectado`)
        for (const l of locations.value) if (l.kind === 'removable' && !after.has(l.id)) notify(`${l.name} removido`)
      }
      locations.value = next
    }
    catch {}
  }

  function watch() {
    if (import.meta.server || timer.value) return
    void refresh()
    timer.value = setInterval(refresh, 5000)
  }

  return { locations, refresh, watch }
}

export function useToast() {
  const toasts = useState<{ id: number, text: string, error?: boolean }[]>('toasts', () => [])
  function notify(text: string, error = false) {
    const id = Date.now() + Math.random()
    toasts.value = [...toasts.value, { id, text, error }]
    setTimeout(() => (toasts.value = toasts.value.filter(t => t.id !== id)), 3500)
  }
  return { toasts, notify }
}

/** Ações de arquivo usadas pela tela de arquivos e pela biblioteca. */
export function useFsActions() {
  const { notify } = useToast()
  const { current, forget, release, reload } = usePlayer()
  const me = useMe()

  async function post<T = any>(url: string, body: object) {
    return await $fetch<T>(url, { method: 'POST', body })
  }

  async function mkdir(path: string, name: string) {
    try {
      const r = await post<{ path: string }>('/api/fs/mkdir', { path, name })
      notify('Pasta criada')
      return r.path
    }
    catch (e) {
      notify(errorMessage(e, 'Não foi possível criar a pasta'), true)
      return null
    }
  }

  // o player solta o arquivo antes (no Windows, arquivo aberto não pode ser renomeado/apagado)
  // e volta a tocar no mesmo ponto depois
  async function rename(path: string, name: string) {
    const playing = release([path])
    try {
      const r = await post<{ path: string }>('/api/fs/rename', { path, name })
      reload(playing, { from: path, to: r.path })
      notify('Renomeado')
      await me.load()
      return r.path
    }
    catch (e) {
      reload(playing)
      notify(errorMessage(e, 'Não foi possível renomear'), true)
      return null
    }
  }

  /** Exclui e devolve só o que foi apagado de verdade (o resto continua na tela). */
  async function remove(paths: string[]) {
    release(paths)
    const deleted: string[] = []
    for (const path of paths) {
      try {
        await post('/api/fs/delete', { path })
        deleted.push(path)
      }
      catch (e) {
        notify(errorMessage(e, 'Não foi possível excluir'), true)
      }
    }
    forget(deleted)
    if (deleted.length) {
      notify(deleted.length > 1 ? `${deleted.length} itens excluídos` : 'Item excluído')
      await me.load()
    }
    return deleted
  }

  async function transfer(paths: string[], dest: string, copy: boolean) {
    const playing = copy ? null : release(paths)
    try {
      const r = await post<{ results: { from: string, to?: string, error?: string }[] }>('/api/fs/move', { paths, dest, copy })
      const fails = r.results.filter(x => x.error)
      const done = r.results.length - fails.length
      if (!copy) {
        const moved = r.results.filter(x => x.to)
        const cur = moved.find(x => playing && current.value?.key.toLowerCase() === x.from.toLowerCase())
        if (cur) reload(playing, { from: cur.from, to: cur.to! })
        else forget(moved.map(x => x.from))
        if (moved.length) await me.load()
      }
      if (done) notify(`${done} ${done > 1 ? 'itens' : 'item'} ${copy ? 'copiado' : 'movido'}${done > 1 ? 's' : ''}`)
      for (const f of fails) notify(f.error!, true)
    }
    catch (e) {
      reload(playing)
      notify(errorMessage(e), true)
    }
  }

  async function saveTags(path: string, tags: { title: string, artist: string, album: string }) {
    const playing = release([path])
    try {
      await post('/api/fs/tags', { path, ...tags })
      notify('Informações salvas')
      return true
    }
    catch (e) {
      notify(errorMessage(e, 'Não foi possível salvar'), true)
      return false
    }
    finally {
      reload(playing)
    }
  }

  return { mkdir, rename, remove, transfer, saveTags }
}
