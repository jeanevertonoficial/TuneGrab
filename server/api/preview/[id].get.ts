import { runYtdlp } from '../../utils/ytdlp'

/**
 * Ouvir antes de baixar: toca o áudio de um vídeo do YouTube direto do YouTube (nada é salvo).
 * O endereço do áudio vale algumas horas; fica guardado para avançar/voltar sem perguntar de novo.
 */
const cache = new Map<string, { url: string, at: number }>()
const TTL = 1000 * 60 * 60 * 2

// o "preparar" (mouse em cima) e o play da mesma música esperam a mesma consulta
const pending = new Map<string, Promise<string>>()

function audioUrl(id: string, fresh = false): Promise<string> {
  const hit = cache.get(id)
  if (!fresh && hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.url)
  if (!fresh && pending.has(id)) return pending.get(id)!
  const p = lookup(id).finally(() => pending.delete(id))
  pending.set(id, p)
  return p
}

async function lookup(id: string) {
  const out = await runYtdlp(['-g', '--no-playlist', '-f', 'bestaudio[ext=m4a]/bestaudio', `https://www.youtube.com/watch?v=${id}`])
  const url = out.trim().split(/\r?\n/)[0]
  if (!url) throw new Error('O YouTube não devolveu o áudio')
  cache.set(id, { url, at: Date.now() })
  if (cache.size > 300) cache.delete(cache.keys().next().value!)
  return url
}

// O YouTube demora ~12 s para começar a responder um pedido "até o fim do arquivo",
// mas responde na hora um pedaço de tamanho definido (o yt-dlp também baixa assim).
// Então o áudio é buscado em pedaços seguidos e entregue ao player como um fluxo só.
const CHUNK = 1024 * 1024

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  if (!/^[\w-]{11}$/.test(id)) throw createError({ statusCode: 400, statusMessage: 'Vídeo inválido' })

  // ?warm=1: só prepara o endereço (mouse em cima da música), para o play começar na hora
  if (getQuery(event).warm) {
    await audioUrl(id).catch(() => null)
    return { ok: true }
  }

  // o player cancela pedidos ao avançar/trocar de faixa: cancela também a conexão com o YouTube
  const ac = new AbortController()
  event.node.res.once('close', () => ac.abort())

  const m = /bytes=(\d+)-(\d*)/.exec(getRequestHeader(event, 'range') ?? '')
  const start = m ? Number(m[1]) : 0
  const wantedEnd = m?.[2] ? Number(m[2]) : null

  const piece = (url: string, from: number, to: number) =>
    fetch(url, { headers: { range: `bytes=${from}-${to}` }, signal: ac.signal })

  let url: string
  let first: Response
  try {
    url = await audioUrl(id)
    first = await piece(url, start, Math.min(wantedEnd ?? Infinity, start + CHUNK - 1))
    if (first.status === 403 || first.status === 410) { // endereço venceu: pede outro
      url = await audioUrl(id, true)
      first = await piece(url, start, Math.min(wantedEnd ?? Infinity, start + CHUNK - 1))
    }
  }
  catch (e: any) {
    if (ac.signal.aborted) return null
    throw createError({ statusCode: 502, statusMessage: e.message || 'Não foi possível tocar' })
  }
  if (first.status === 416) {
    setResponseStatus(event, 416)
    return null
  }
  if (!first.ok || !first.body) throw createError({ statusCode: 502, statusMessage: `YouTube respondeu ${first.status}` })

  const total = Number(/\/(\d+)$/.exec(first.headers.get('content-range') ?? '')?.[1]) || null
  const end = Math.min(wantedEnd ?? Infinity, total ? total - 1 : Infinity)

  setResponseStatus(event, total ? 206 : first.status)
  setResponseHeaders(event, {
    'Content-Type': first.headers.get('content-type') ?? 'audio/mp4',
    'Accept-Ranges': 'bytes',
    ...(total ? { 'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Length': String(end - start + 1) } : {}),
  })
  if (!total) return sendStream(event, first.body)

  // entrega o 1º pedaço e vai buscando os próximos conforme o player consome
  let reader = first.body.getReader()
  let next = start + CHUNK
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (!done) return controller.enqueue(value)
          if (next > end) return controller.close()
          const res = await piece(url, next, Math.min(end, next + CHUNK - 1))
          if (!res.ok || !res.body) throw new Error(`YouTube respondeu ${res.status}`)
          reader = res.body.getReader()
          next += CHUNK
        }
      }
      catch (e) {
        controller.error(e)
      }
    },
    cancel() {
      ac.abort()
    },
  })
  return sendStream(event, stream)
})
