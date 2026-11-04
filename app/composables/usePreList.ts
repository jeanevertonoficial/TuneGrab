import type { Track } from './useDownloads'

export interface PreTrack extends Track {
  /** busca de onde a música veio */
  query: string
  addedAt: number
}

export interface SearchEntry {
  q: string
  at: number
  /** quantos resultados a busca trouxe */
  count: number
}

const LIST_KEY = 'tunegrab:prelist'
const HISTORY_KEY = 'tunegrab:searches'
const MAX_HISTORY = 30
let loaded = false

/**
 * Pré-lista: músicas marcadas em várias buscas por nome, juntas para baixar de uma vez (ou não).
 * Fica salva neste navegador junto com o histórico das buscas.
 */
export function usePreList() {
  const tracks = useState<PreTrack[]>('preList', () => [])
  const history = useState<SearchEntry[]>('searchHistory', () => [])
  const ids = computed(() => new Set(tracks.value.map(t => t.id)))

  function load() {
    if (import.meta.server || loaded) return
    loaded = true
    try {
      tracks.value = JSON.parse(localStorage.getItem(LIST_KEY) || '[]')
      history.value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
    }
    catch {}
    watch(tracks, v => save(LIST_KEY, v), { deep: true })
    watch(history, v => save(HISTORY_KEY, v), { deep: true })
  }

  function save(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    }
    catch {}
  }

  const has = (id: string) => ids.value.has(id)

  function add(list: Track[], query: string) {
    const fresh = list.filter(t => !has(t.id)).map(t => ({ ...t, query, addedAt: Date.now() }))
    if (fresh.length) tracks.value = [...tracks.value, ...fresh]
  }

  function remove(idList: string[]) {
    const gone = new Set(idList)
    tracks.value = tracks.value.filter(t => !gone.has(t.id))
  }

  function clear() {
    tracks.value = []
  }

  /** guarda a busca no topo do histórico (sem repetir) */
  function remember(q: string, count: number) {
    const key = q.trim().toLowerCase()
    if (!key) return
    history.value = [{ q: q.trim(), at: Date.now(), count }, ...history.value.filter(h => h.q.toLowerCase() !== key)].slice(0, MAX_HISTORY)
  }

  function forgetSearch(q: string) {
    history.value = history.value.filter(h => h.q !== q)
  }

  function clearHistory() {
    history.value = []
  }

  /** quantas músicas da pré-lista vieram de cada busca */
  const countByQuery = computed(() => {
    const m = new Map<string, number>()
    for (const t of tracks.value) m.set(t.query.toLowerCase(), (m.get(t.query.toLowerCase()) ?? 0) + 1)
    return m
  })

  return { tracks, history, has, load, add, remove, clear, remember, forgetSearch, clearHistory, countByQuery }
}
