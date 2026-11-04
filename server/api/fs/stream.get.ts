import { assertAllowed } from '../../utils/drives'
import { isMedia, sendFile } from '../../utils/media'

export default defineEventHandler(async (event) => {
  const path = await assertAllowed(String(getQuery(event).path || ''))
  if (!isMedia(path)) throw createError({ statusCode: 400, statusMessage: 'Não é um arquivo de mídia' })
  return sendFile(event, path, { inline: true })
})
