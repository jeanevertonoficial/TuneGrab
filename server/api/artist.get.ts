import { jsonStore } from '../utils/store'
import { runYtdlp } from '../utils/ytdlp'

/**
 * Canal do YouTube de um artista, pelo nome (usado no cabeçalho da pasta do artista):
 * foto do canal, link e inscritos. Só aceita canal com o mesmo nome (ignorando acentos/maiúsculas,
 * o "- Topic" e títulos como "Pr"/"Oficial"); entre homônimos, o verificado e depois o de mais
 * inscritos. Guardado 30 dias ("não achei": 1 dia).
 */
interface Artist { id: string, name: string, url: string, avatar: string | null, subscribers: number | null }

const store = jsonStore<Record<string, { at: number, value: Artist | null }>>('artists-v2', {}) // v2: escolha nova (verificado primeiro)
const HIT_TTL = 1000 * 60 * 60 * 24 * 30
const MISS_TTL = 1000 * 60 * 60 * 24

const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\s*-\s*topic$/, '').replace(/vevo$/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** títulos que vêm antes do nome no canal oficial ("Pr Marcus Salles", "Ministério X", "Banda X") */
const PREFIX = /^(?:pr|pra|pastor|pastora|ap|apostolo|bispo|bispa|missionario|missionaria|cantor|cantora|banda|ministerio|dj|mc|padre|irma|irmao)\s+/
/** "oficial"/"official" no fim do nome do canal */
const SUFFIX = /\s+(?:oficial|official|music|musica)$/

/** o canal é deste artista: mesmo nome, aceitando um título antes ou "Oficial" depois */
function sameArtist(channel: string, key: string) {
  const n = norm(channel)
  return n === key || n.replace(PREFIX, '').replace(SUFFIX, '') === key.replace(PREFIX, '').replace(SUFFIX, '')
}

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
      .filter(e => e?.id && !/ - topic$/i.test(e.title ?? '') && sameArtist(e.title || e.channel || '', key))
      // homônimos são comuns (fã-clubes, contas pessoais): o verificado primeiro, depois o de mais inscritos
      .sort((a, b) => Number(!!b.channel_is_verified) - Number(!!a.channel_is_verified)
        || (b.channel_follower_count ?? 0) - (a.channel_follower_count ?? 0))[0]
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
