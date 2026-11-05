import { jsonStore } from '../utils/store'
import { runYtdlp } from '../utils/ytdlp'

/**
 * Canal do YouTube de um artista, pelo nome (usado no cabeçalho da pasta do artista):
 * foto do canal, link e inscritos. Só aceita canal com o nome EXATO (ignorando acentos/maiúsculas
 * e o "- Topic"); entre homônimos, o de mais inscritos. Guardado 30 dias ("não achei": 1 dia).
 */
interface Artist { id: string, name: string, url: string, avatar: string | null, subscribers: number | null }

const store = jsonStore<Record<string, { at: number, value: Artist | null }>>('artists', {})
const HIT_TTL = 1000 * 60 * 60 * 24 * 30
const MISS_TTL = 1000 * 60 * 60 * 24

const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\s*-\s*topic$/, '').replace(/vevo$/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

export default defineEventHandler(async (event) => {
  const name = String(getQuery(event).name ?? '').trim().slice(0, 100)
  if (name.length < 2) throw createError({ statusCode: 400, statusMessage: 'Nome inválido' })
  const key = norm(name)
  const hit = store.get()[key]
  if (hit && Date.now() - hit.at < (hit.value ? HIT_TTL : MISS_TTL)) return hit.value

  let value: Artist | null = null
  try {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(name)}&sp=EgIQAg%253D%253D` // filtro: canais
    const raw = JSON.parse(await runYtdlp(['-J', '--flat-playlist', '--playlist-end', '8', url]))
    const best = ((raw.entries ?? []) as any[])
      .filter(e => e?.id && norm(e.title || e.channel || '') === key && !/ - topic$/i.test(e.title ?? ''))
      .sort((a, b) => (b.channel_follower_count ?? 0) - (a.channel_follower_count ?? 0))[0]
    if (best) {
      const thumb = (best.thumbnails ?? []).at(-1)?.url as string | undefined
      value = {
        id: best.id,
        name: best.title || best.channel,
        url: `https://www.youtube.com/channel/${best.id}`,
        // foto maior (a da busca vem em 88 px) e com https
        avatar: thumb ? thumb.replace(/^\/\//, 'https://').replace(/=s\d+-/, '=s512-') : null,
        subscribers: best.channel_follower_count ?? null,
      }
    }
  }
  catch {
    return null // sem internet / YouTube fora: não guarda o "não achei"
  }
  store.set({ ...store.get(), [key]: { at: Date.now(), value } })
  return value
})
