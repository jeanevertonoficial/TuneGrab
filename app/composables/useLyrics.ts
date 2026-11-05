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
  /** letra aberta, mas pequena no canto (ao navegar para outra tela) */
  const mini = useState('lyricsMini', () => false)

  /** botão de letra / tecla L: fechada → grande; mini → grande; grande → fecha */
  function toggle() {
    if (open.value && mini.value) mini.value = false
    else {
      open.value = !open.value
      mini.value = false
    }
  }
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

  return { open, mini, toggle, data, loading, load }
}
