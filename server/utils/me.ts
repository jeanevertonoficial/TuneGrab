import { existsSync } from 'node:fs'
import { jsonStore } from './store'

/** Retrato da música no momento em que foi favoritada/tocada (para mostrar mesmo com o pendrive fora). */
export interface SavedTrack {
  path: string
  name: string
  title: string | null
  artist: string | null
  album: string | null
  duration: number | null
  hasCover: boolean
  at: number
}

const MAX_RECENT = 100
const store = jsonStore<{ favorites: SavedTrack[], recent: SavedTrack[] }>('me', { favorites: [], recent: [] })

const key = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p)

export function sanitize(t: Partial<SavedTrack>): SavedTrack {
  if (typeof t?.path !== 'string' || !t.path) throw createError({ statusCode: 400, statusMessage: 'Música inválida' })
  const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 300) : null)
  return {
    path: t.path,
    name: str(t.name) ?? t.path.split(/[\\/]/).pop()!,
    title: str(t.title),
    artist: str(t.artist),
    album: str(t.album),
    duration: typeof t.duration === 'number' ? t.duration : null,
    hasCover: !!t.hasCover,
    at: Date.now(),
  }
}

export function getLibrary() {
  const { favorites, recent } = store.get()
  // "exists": arquivo acessível agora (pendrive pode estar desconectado)
  const mark = (l: SavedTrack[]) => l.map(t => ({ ...t, exists: existsSync(t.path) }))
  return { favorites: mark(favorites), recent: mark(recent) }
}

export function setFavorite(track: SavedTrack, on: boolean) {
  const s = store.get()
  const favorites = s.favorites.filter(f => key(f.path) !== key(track.path))
  if (on) favorites.unshift(track)
  store.set({ ...s, favorites })
}

export function addRecent(track: SavedTrack) {
  const s = store.get()
  const recent = [track, ...s.recent.filter(r => key(r.path) !== key(track.path))].slice(0, MAX_RECENT)
  store.set({ ...s, recent })
}

export function clearRecent() {
  store.set({ ...store.get(), recent: [] })
}

/** Tira das favoritas e recentes o que foi excluído (o arquivo ou qualquer coisa dentro da pasta). */
export function forgetPaths(paths: string[]) {
  const gone = paths.map(key)
  const keep = (t: SavedTrack) => !gone.some(g => key(t.path) === g || key(t.path).startsWith(`${g}\\`) || key(t.path).startsWith(`${g}/`))
  const s = store.get()
  store.set({ favorites: s.favorites.filter(keep), recent: s.recent.filter(keep) })
}

/** Mantém favoritas/recentes apontando para o arquivo certo depois de mover/renomear. */
export function renamePath(from: string, to: string) {
  const s = store.get()
  const fix = (l: SavedTrack[]) => l.map((t) => {
    const k = key(t.path)
    const f = key(from)
    if (k === f) return { ...t, path: to, name: to.split(/[\\/]/).pop()! }
    if (k.startsWith(`${f}\\`) || k.startsWith(`${f}/`)) return { ...t, path: to + t.path.slice(from.length) }
    return t
  })
  store.set({ favorites: fix(s.favorites), recent: fix(s.recent) })
}
