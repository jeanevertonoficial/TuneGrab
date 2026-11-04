export interface LyricLine { t: number, text: string }
export interface Lyrics {
  lines: LyricLine[] | null
  plain: string | null
  source: 'arquivo' | 'LRCLIB' | null
  unavailable?: boolean
}

/** Letra da música que está tocando (busca quando o painel de letra está aberto). */
export function useLyrics() {
  const open = useState('lyricsOpen', () => false)
  const data = useState<Lyrics | null>('lyricsData', () => null)
  const forKey = useState<string | null>('lyricsKey', () => null)
  const loading = useState('lyricsLoading', () => false)
  const { current, duration } = usePlayer()

  async function load(force = false) {
    const item = current.value
    if (!item) {
      data.value = null
      forKey.value = null
      return
    }
    if (!force && forKey.value === item.key && data.value) return
    forKey.value = item.key
    loading.value = true
    data.value = null
    const key = item.key
    const res = await $fetch<Lyrics>('/api/lyrics', {
      query: {
        title: item.file?.title || item.title,
        artist: item.file?.artist || item.artist,
        duration: item.file?.duration || duration.value || undefined,
        path: item.file?.path,
      },
    }).catch(() => ({ lines: null, plain: null, source: null, unavailable: true }) as Lyrics)
    if (forKey.value !== key) return // trocou de música enquanto buscava
    data.value = res
    loading.value = false
  }

  return { open, data, loading, load }
}
