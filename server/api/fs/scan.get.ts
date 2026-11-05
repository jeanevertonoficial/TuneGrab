import { assertAllowed } from '../../utils/drives'
import { describe, findMedia, type MediaFile } from '../../utils/scan'
import { currentFsVersion } from '../../utils/store'

// varreduras recentes: trocar de tela ou recarregar a página não procura tudo de novo
const TTL = 1000 * 60 * 5
const cache = new Map<string, { at: number, version: number, value: { root: string, files: MediaFile[], truncated: boolean } }>()

/**
 * Músicas e vídeos de uma pasta (com subpastas).
 * ?kind=audio | video: só esse tipo — a Biblioteca mostra as músicas primeiro e procura os vídeos depois,
 * sem ler as tags dos vídeos antes de mostrar as músicas. Sem kind: tudo (como antes).
 */
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const root = await assertAllowed(String(q.path || ''))
  const kind = q.kind === 'audio' || q.kind === 'video' ? q.kind : undefined
  const key = `${root.toLowerCase()}|${kind ?? 'all'}`
  const hit = cache.get(key)
  // "Procurar de novo" manda fresh=1; o app também invalida quando altera arquivos
  if (!q.fresh && hit && hit.version === currentFsVersion() && Date.now() - hit.at < TTL) return hit.value

  const { found, truncated } = await findMedia(root, kind)
  const value = { root, files: await describe(found), truncated }
  cache.set(key, { at: Date.now(), version: currentFsVersion(), value })
  return value
})
