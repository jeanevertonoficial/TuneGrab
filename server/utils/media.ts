import { createReadStream, statSync } from 'node:fs'
import { access } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import type { H3Event } from 'h3'
import { parseFile } from 'music-metadata'
import { jsonStore } from './store'

export const MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  opus: 'audio/ogg',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  webm: 'video/webm',
}

/** Windows: arquivo excluído mas ainda aberto por alguém (abrir dá EPERM). Para o app, já não existe. */
export async function deletePending(file: string) {
  if (process.platform !== 'win32') return false
  return access(file).then(() => false, (e: any) => e.code === 'EPERM')
}

export const isMedia =(name: string) => extname(name).slice(1).toLowerCase() in MIME

export function mimeOf(path: string) {
  return MIME[extname(path).slice(1).toLowerCase()] ?? 'application/octet-stream'
}

export function disposition(name: string, inline = false) {
  const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '\'')
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

/**
 * Abre o arquivo e FECHA quando a conexão acaba — inclusive quando o player cancela no meio
 * (avançar, trocar de faixa). Sem isso o arquivo ficava aberto e, no Windows, excluir deixava
 * ele "pendente": some do app mas continua na pasta até o servidor fechar.
 */
function openStream(event: H3Event, file: string, opts?: { start: number, end: number }) {
  const stream = createReadStream(file, opts)
  const close = () => stream.destroy()
  event.node.res.once('close', close)
  event.node.req.once('aborted', close)
  stream.once('close', () => event.node.res.off('close', close))
  return stream
}

/** Envia um arquivo com suporte a Range, para o player conseguir avançar/voltar. */
export function sendFile(event: H3Event, file: string, opts: { inline?: boolean } = {}) {
  let size: number
  try {
    size = statSync(file).size
  }
  catch {
    // excluído, movido ou pendrive fora: "não encontrado", não erro do servidor
    throw createError({ statusCode: 404, statusMessage: 'Arquivo não encontrado' })
  }
  const range = getRequestHeader(event, 'range')
  setResponseHeaders(event, {
    'Content-Type': mimeOf(file),
    'Accept-Ranges': 'bytes',
    'Content-Disposition': disposition(basename(file), opts.inline),
  })
  const m = range && /bytes=(\d*)-(\d*)/.exec(range)
  if (m) {
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]))
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
    if (start >= size || start > end) {
      setResponseStatus(event, 416)
      setResponseHeader(event, 'Content-Range', `bytes */${size}`)
      return ''
    }
    setResponseStatus(event, 206)
    setResponseHeaders(event, {
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
    })
    return sendStream(event, openStream(event, file, { start, end }))
  }
  setResponseHeader(event, 'Content-Length', String(size))
  return sendStream(event, openStream(event, file))
}

export interface TrackMeta {
  title: string | null
  artist: string | null
  album: string | null
  duration: number | null
  /** kbps */
  bitrate: number | null
  hasCover: boolean
}

// cache de tags salvo em disco: abrir de novo uma pasta grande não relê os arquivos
const metaStore = jsonStore<Record<string, { mtime: number, size: number, meta: TrackMeta }>>('meta-cache', {})
const MAX_CACHE = 60000

/** Tags já conhecidas (sem tocar no arquivo), ou null. */
export function cachedMeta(file: string, mtime: number, size: number): TrackMeta | null {
  const hit = metaStore.get()[file]
  return hit && hit.mtime === mtime && hit.size === size ? hit.meta : null
}

let cacheSize = Object.keys(metaStore.get()).length

function remember(file: string, mtime: number, size: number, meta: TrackMeta) {
  const all = metaStore.get()
  if (!(file in all)) cacheSize++
  all[file] = { mtime, size, meta }
  // limpa em lote (contar as chaves a cada música deixava varreduras grandes lentas)
  if (cacheSize > MAX_CACHE + 2000) {
    const keys = Object.keys(all)
    for (const k of keys.slice(0, keys.length - MAX_CACHE)) delete all[k]
    cacheSize = MAX_CACHE
  }
  metaStore.set(all)
}

export async function readMeta(file: string): Promise<TrackMeta> {
  const st = statSync(file)
  const hit = cachedMeta(file, st.mtimeMs, st.size)
  if (hit) return hit
  let meta: TrackMeta = { title: null, artist: null, album: null, duration: null, bitrate: null, hasCover: false }
  try {
    const m = await parseFile(file, { duration: false })
    meta = {
      title: m.common.title ?? null,
      artist: m.common.artist ?? null,
      album: m.common.album ?? null,
      duration: m.format.duration ?? null,
      bitrate: m.format.bitrate ? Math.round(m.format.bitrate / 1000) : null,
      hasCover: !!m.common.picture?.length,
    }
  }
  catch { /* arquivo sem tags ou corrompido: mostra só o nome */ }
  remember(file, st.mtimeMs, st.size, meta)
  return meta
}

// capas recentes na memória: rolar listas grandes não relê o arquivo toda hora
const coverCache = new Map<string, { format: string, data: Uint8Array } | null>()

export async function readCover(file: string) {
  const key = `${file}|${statSync(file).mtimeMs}`
  if (coverCache.has(key)) return coverCache.get(key)!
  const m = await parseFile(file, { skipPostHeaders: true })
  const pic = m.common.picture?.[0]
  const value = pic ? { format: pic.format, data: pic.data } : null
  coverCache.set(key, value)
  if (coverCache.size > 400) coverCache.delete(coverCache.keys().next().value!)
  return value
}
