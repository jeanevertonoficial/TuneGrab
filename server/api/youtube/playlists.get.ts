import { hasLogin } from '../../utils/settings'
import { runYtdlp } from '../../utils/ytdlp'

/** Playlists da conta conectada (inclusive as privadas). Guardadas por 10 min. */
let cache: { at: number, value: unknown[] } | null = null

export default defineEventHandler(async (event) => {
  if (!hasLogin()) return []
  if (!getQuery(event).fresh && cache && Date.now() - cache.at < 1000 * 60 * 10) return cache.value
  try {
    const raw = JSON.parse(await runYtdlp(['-J', '--flat-playlist', 'https://www.youtube.com/feed/playlists']))
    const value = (raw.entries ?? [])
      .map((e: any) => {
        const id = String(e.url ?? '').match(/[?&]list=([\w-]+)/)?.[1] ?? e.id
        if (!id || id === 'LL' || id === 'WL') return null // já aparecem fixas na lista
        const thumbs = (e.thumbnails ?? []) as { url: string }[]
        return { id, title: e.title || 'Playlist', url: `https://www.youtube.com/playlist?list=${id}`, thumbnail: thumbs.at(-1)?.url ?? null }
      })
      .filter(Boolean)
    cache = { at: Date.now(), value }
    return value
  }
  catch (e: any) {
    throw createError({ statusCode: 502, statusMessage: e.message })
  }
})
