import { assertAllowed } from '../../utils/drives'
import { readCover } from '../../utils/media'

export default defineEventHandler(async (event) => {
  const path = await assertAllowed(String(getQuery(event).path || ''))
  const pic = await readCover(path).catch(() => null)
  if (!pic) throw createError({ statusCode: 404, statusMessage: 'Sem capa' })
  setResponseHeaders(event, { 'Content-Type': pic.format || 'image/jpeg', 'Cache-Control': 'max-age=3600' })
  return Buffer.from(pic.data)
})
