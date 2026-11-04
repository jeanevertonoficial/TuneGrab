import type { FsFile } from './useFiles'

export interface SavedTrack extends FsFile {
  at: number
  /** arquivo acessível agora (o pendrive pode estar fora) */
  exists: boolean
}

type TrackLike = Pick<FsFile, 'path' | 'name' | 'title' | 'artist' | 'album' | 'duration' | 'hasCover'>

const snapshot = (f: TrackLike) => ({
  path: f.path, name: f.name, title: f.title, artist: f.artist, album: f.album, duration: f.duration, hasCover: f.hasCover,
})
const key = (p: string) => p.toLowerCase()

/** Favoritas e tocadas recentemente (salvas no servidor, em .data/state/me.json). */
export function useMe() {
  const favorites = useState<SavedTrack[]>('meFavorites', () => [])
  const recent = useState<SavedTrack[]>('meRecent', () => [])
  const loaded = useState('meLoaded', () => false)
  const { notify } = useToast()

  const favKeys = computed(() => new Set(favorites.value.map(f => key(f.path))))
  const isFavorite = (path: string) => favKeys.value.has(key(path))

  async function load() {
    try {
      const r = await $fetch<{ favorites: SavedTrack[], recent: SavedTrack[] }>('/api/me')
      favorites.value = r.favorites
      recent.value = r.recent
      loaded.value = true
    }
    catch {}
  }

  async function toggleFavorite(f: TrackLike) {
    const on = !isFavorite(f.path)
    // atualiza a tela na hora; o servidor grava em segundo plano
    favorites.value = on
      ? [{ ...snapshot(f), size: 0, at: Date.now(), exists: true } as SavedTrack, ...favorites.value]
      : favorites.value.filter(x => key(x.path) !== key(f.path))
    try {
      await $fetch('/api/me/favorite', { method: 'POST', body: { track: snapshot(f), on } })
      notify(on ? 'Adicionada às Favoritas' : 'Removida das Favoritas')
    }
    catch {
      notify('Não foi possível salvar a favorita', true)
      await load()
    }
  }

  function recordPlay(f: TrackLike) {
    recent.value = [{ ...snapshot(f), size: 0, at: Date.now(), exists: true } as SavedTrack, ...recent.value.filter(r => key(r.path) !== key(f.path))].slice(0, 100)
    void $fetch('/api/me/recent', { method: 'POST', body: { track: snapshot(f) } }).catch(() => {})
  }

  async function clearRecent() {
    recent.value = []
    await $fetch('/api/me/recent', { method: 'DELETE' }).catch(() => {})
  }

  return { favorites, recent, loaded, isFavorite, load, toggleFavorite, recordPlay, clearRecent }
}
