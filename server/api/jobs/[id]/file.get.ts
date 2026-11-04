import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import { ZipArchive } from 'archiver'
import { getJob } from '../../../utils/jobs'
import { disposition, sendFile } from '../../../utils/media'

export default defineEventHandler((event) => {
  const job = getJob(getRouterParam(event, 'id')!)
  if (!job) throw createError({ statusCode: 404, statusMessage: 'Download não encontrado' })

  const { item, inline } = getQuery(event)
  // a cópia temporária some depois de 3 h; se foi salvo numa pasta, usa o arquivo de lá
  const fileOf = (i: (typeof job.items)[number]) => [i.file, i.savedTo].find(p => p && existsSync(p))
  const done = job.items.filter(i => i.status === 'done' && fileOf(i)).sort((a, b) => a.index - b.index)
  const selected = item !== undefined ? done.filter(i => i.index === Number(item)) : done
  if (!selected.length) throw createError({ statusCode: 404, statusMessage: 'Arquivo ainda não está pronto' })

  if (selected.length === 1) return sendFile(event, fileOf(selected[0]!)!, { inline: !!inline })

  const zipName = `${job.title.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'playlist'}.zip`
  setResponseHeaders(event, {
    'Content-Type': 'application/zip',
    'Content-Disposition': disposition(zipName),
  })
  // áudio já é comprimido, então "store" é bem mais rápido
  const zip = new ZipArchive({ store: true })
  for (const i of selected) zip.file(fileOf(i)!, { name: basename(fileOf(i)!) })
  void zip.finalize()
  return sendStream(event, zip)
})
