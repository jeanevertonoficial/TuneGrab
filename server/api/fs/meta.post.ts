import { assertAllowed } from '../../utils/drives'
import { isMedia, readMeta } from '../../utils/media'

/** Tags de vários arquivos de uma vez (usado para completar listagens grandes aos poucos). */
export default defineEventHandler(async (event) => {
  const { paths } = await readBody<{ paths: string[] }>(event)
  if (!Array.isArray(paths)) throw createError({ statusCode: 400, statusMessage: 'paths obrigatório' })
  const out: Record<string, unknown> = {}
  const list = paths.slice(0, 100)
  for (let i = 0; i < list.length; i += 16) {
    await Promise.all(list.slice(i, i + 16).map(async (p) => {
      try {
        const full = await assertAllowed(p)
        if (isMedia(full)) out[p] = await readMeta(full)
      }
      catch { /* arquivo sumiu ou fora das pastas permitidas */ }
    }))
  }
  return out
})
