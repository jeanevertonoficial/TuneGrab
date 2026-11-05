import { existingFile } from '../utils/downloaded'
import { FORMATS, listJobs } from '../utils/jobs'

/**
 * Antes de baixar: o que desse link já existe no disco (por formato)
 * e se há um download anterior dele que ficou pela metade.
 */
export default defineEventHandler(async (event) => {
  const { url, tracks, formats } = await readBody<{ url?: string, tracks: string[], formats: string[] }>(event)
  if (!Array.isArray(tracks) || !Array.isArray(formats)) throw createError({ statusCode: 400, statusMessage: 'Dados inválidos' })

  const existing: Record<string, Record<string, string>> = {}
  for (const id of tracks.slice(0, 5000)) {
    for (const f of formats) {
      const path = existingFile(id, f)
      if (path) (existing[id] ??= {})[f] = path
    }
  }

  // em QUALQUER formato (não só nos escolhidos agora): a lista mostra "✓ MP4" mesmo com MP3 selecionado
  const have: Record<string, string[]> = {}
  for (const id of tracks.slice(0, 5000)) {
    const fs = Object.keys(FORMATS).filter(f => existingFile(id, f))
    if (fs.length) have[id] = fs
  }

  // downloads parados (cancelados ou interrompidos) do mesmo link / mesmas faixas
  const wanted = new Set(tracks)
  // não oferece retomar o que não adianta: faixas que já existem no disco (baixadas por outro download)
  // e músicas que a busca não achou no YouTube (falhariam de novo)
  const NOT_FOUND = 'Não encontrei essa música no YouTube'
  const resumable = listJobs()
    .filter(j => j.status !== 'running' && formats.includes(j.format))
    .map((j) => {
      const left = j.items.filter(i => i.status !== 'done' && i.error !== NOT_FOUND && !existingFile(i.id, j.format))
      // mesmo link, ou a maior parte do download antigo é deste link
      // (um vídeo solto não oferece retomar uma playlist inteira em que ele aparece)
      const overlap = j.items.filter(i => wanted.has(i.id)).length
      const related = (url && j.sourceUrl === url) || overlap >= Math.max(1, j.items.length / 2)
      return { job: j, left: left.length, related }
    })
    .filter(x => x.related && x.left > 0)
    .map(({ job: j, left }) => ({ id: j.id, format: j.format, title: j.title, done: j.items.length - left, total: j.items.length }))
    .slice(0, 3)

  return { existing, have, resumable }
})
