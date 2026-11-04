import { assertAllowed } from '../utils/drives'
import { getLyrics } from '../utils/lyrics'

/** Letra da música (do arquivo ou do LRCLIB), com o tempo de cada linha quando existir. */
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const title = String(q.title ?? '').trim().slice(0, 300)
  if (!title) throw createError({ statusCode: 400, statusMessage: 'Música sem título' })
  const path = q.path ? await assertAllowed(String(q.path)).catch(() => null) : null
  const duration = Number(q.duration) || null
  return getLyrics({ title, artist: String(q.artist ?? '').slice(0, 200), duration, path })
})
