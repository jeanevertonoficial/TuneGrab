import { basename, dirname, join } from 'node:path'
import { existingFile } from '../../utils/downloaded'
import { assertWritable, isLocationRoot } from '../../utils/drives'
import { createJob, FORMATS, publicJob, type FormatId, type VideoCodec } from '../../utils/jobs'
import { safeName } from '../../utils/names'
import type { Track } from '../../utils/ytdlp'

interface Body {
  title: string
  type: 'video' | 'playlist' | 'channel'
  thumbnail: string | null
  /** vários formatos de uma vez (ex.: MP3 + MP4) */
  formats?: { format: FormatId, quality: string, codec?: VideoCodec }[]
  /** formato único (compatibilidade) */
  format?: FormatId
  quality?: string
  tracks: Track[]
  destination?: string | null
  subfolder?: boolean
  /** nome da pasta nova (editado na tela); padrão: o título */
  folderName?: string
  sourceUrl?: string
  /** pula, por formato, as faixas que já foram baixadas e ainda existem no disco */
  skipExisting?: boolean
  /** baixa de novo e substitui o arquivo existente */
  replace?: boolean
}

/** TOTO -> TOTO_VIDEO (ao lado); na raiz de uma unidade, cria a pasta VIDEO dentro dela */
async function videoFolder(dest: string) {
  if (await isLocationRoot(dest)) return join(dest, 'VIDEO')
  return join(dirname(dest), `${basename(dest)}_VIDEO`)
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Body>(event)
  const formats = body.formats?.length ? body.formats : [{ format: body.format!, quality: body.quality! }]
  for (const f of formats) {
    const fmt = FORMATS[f?.format]
    if (!fmt) throw createError({ statusCode: 400, statusMessage: 'Formato inválido' })
    if (!(fmt.qualities as readonly string[]).includes(f.quality))
      throw createError({ statusCode: 400, statusMessage: `Qualidade inválida para ${fmt.label}` })
  }
  if (new Set(formats.map(f => f.format)).size !== formats.length)
    throw createError({ statusCode: 400, statusMessage: 'Formato repetido' })

  // links válidos (ou busca no YouTube para Spotify/Deezer/lista) e sem faixas repetidas
  const seen = new Set<string>()
  const tracks = (body.tracks || []).filter((t) => {
    if (!t || typeof t.url !== 'string' || !(/^https?:\/\//.test(t.url) || t.url.startsWith('search:'))) return false
    if (seen.has(t.id)) return false
    seen.add(t.id)
    return true
  })
  if (!tracks.length) throw createError({ statusCode: 400, statusMessage: 'Nenhuma faixa selecionada' })

  // confere a pasta aqui (a lista de unidades da tela pode estar desatualizada)
  const base = body.destination ? await assertWritable(body.destination) : null
  // vídeo vai para a pasta _VIDEO só quando o pedido mistura áudio e vídeo
  const mixed = formats.some(f => FORMATS[f.format].kind === 'video') && formats.some(f => FORMATS[f.format].kind === 'audio')
  const title = String(body.title || tracks[0]!.title)

  const jobs = []
  for (const f of formats) {
    // "só o que falta": tira as faixas que já existem nesse formato
    const todo = body.skipExisting && !body.replace ? tracks.filter(t => !existingFile(t.id, f.format)) : tracks
    if (!todo.length) continue

    let destination: string | null = null
    if (base) {
      destination = mixed && FORMATS[f.format].kind === 'video' ? await videoFolder(base) : base
      if (body.subfolder) destination = join(destination, safeName(String(body.folderName || '').trim() || title || 'Playlist'))
    }
    jobs.push(createJob({
      title,
      type: body.type === 'video' ? 'video' : body.type === 'channel' ? 'channel' : 'playlist',
      thumbnail: body.thumbnail ?? null,
      format: f.format,
      quality: f.quality,
      codec: f.codec,
      tracks: todo,
      destination,
      sourceUrl: body.sourceUrl,
      replace: !!body.replace,
    }))
  }
  return jobs.map(publicJob)
})
