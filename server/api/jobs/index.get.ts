import { createHash } from 'node:crypto'
import { listJobs, publicJob } from '../../utils/jobs'

/**
 * Lista de downloads. A tela pergunta a cada 0,7–4 s: com o ETag, se nada mudou o navegador recebe
 * só um "304 – igual" (bytes) em vez da lista inteira de novo (~56 KB a cada vez).
 */
export default defineEventHandler((event) => {
  const body = JSON.stringify(listJobs().map(publicJob))
  const etag = `"${createHash('sha1').update(body).digest('base64url')}"`
  setResponseHeaders(event, { 'ETag': etag, 'Cache-Control': 'no-cache', 'Content-Type': 'application/json' })
  if (getRequestHeader(event, 'if-none-match') === etag) {
    setResponseStatus(event, 304)
    return null
  }
  return body
})
