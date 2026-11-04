import type { MediaInfo, Track } from './ytdlp'
import { runYtdlp } from './ytdlp'

/**
 * Spotify, Deezer e listas coladas: esses serviços têm DRM, então daqui só sai a LISTA
 * (título, artista, duração, capa). Cada faixa vira uma busca no YouTube na hora de baixar
 * (url "search:Artista - Título") e o arquivo é salvo com as informações originais.
 */

const UA = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
}

export type Service = 'spotify' | 'deezer' | 'amazon'

export function detectService(url: string): Service | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    if (host === 'open.spotify.com' || host === 'spotify.link' || host === 'spotify.app.link') return 'spotify'
    if (host === 'deezer.com' || host.endsWith('.deezer.com') || host === 'deezer.page.link' || host === 'link.deezer.com') return 'deezer'
    if (host.startsWith('music.amazon.') || host === 'amazon.com' || host.endsWith('.amazon.com.br')) return 'amazon'
  }
  catch {}
  return null
}

const searchUrl = (artist: string, title: string) => `search:${[artist, title].filter(Boolean).join(' - ')}`

/** links curtos (spotify.link, deezer.page.link) -> link completo */
async function expand(url: string) {
  const host = new URL(url).hostname
  if (!/\.link$|page\.link$|link\.deezer\.com$/.test(host)) return url
  const res = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(10000) })
  return res.url
}

// ---------------- Spotify (página pública de "embed", sem login) ----------------

export async function spotifyInfo(rawUrl: string): Promise<MediaInfo> {
  const url = await expand(rawUrl)
  const m = new URL(url).pathname.match(/\/(?:intl-[a-z-]+\/)?(track|album|playlist)\/([A-Za-z0-9]+)/)
  if (!m) throw new Error('Link do Spotify não reconhecido. Use um link de música, álbum ou playlist.')
  const [, kind, id] = m
  const html = await (await fetch(`https://open.spotify.com/embed/${kind}/${id}`, { headers: UA, signal: AbortSignal.timeout(15000) })).text()
  const json = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/s)?.[1]
  const entity = json ? JSON.parse(json)?.props?.pageProps?.state?.data?.entity : null
  if (!entity) throw new Error('Não consegui ler esse link do Spotify (é privado ou foi removido?).')

  // capa: i.scdn.co (playlists) ou image-cdn-*.spotifycdn.com (álbuns/músicas); a maior vem por último
  const covers = JSON.stringify(entity).match(/https:\/\/(?:i\.scdn\.co|image-cdn-[a-z]+\.spotifycdn\.com)\/image\/[a-z0-9]+/gi) ?? []
  const cover = covers.find(u => /ab67616d0000b273|ab67706c0000da84|ab67706f00000002/.test(u)) ?? covers.at(-1) ?? null
  const source = `https://open.spotify.com/${kind}/${id}`

  if (kind === 'track') {
    const artist = (entity.artists ?? []).map((a: any) => a.name).join(', ')
    const track: Track = {
      id: `spotify:${id}`, url: searchUrl(artist, entity.title ?? entity.name), title: entity.title ?? entity.name, artist,
      duration: entity.duration ? Math.round(entity.duration / 1000) : null, thumbnail: cover, album: null,
    }
    return { type: 'video', source: 'spotify', id: track.id, title: track.title, author: artist, thumbnail: cover, url: source, tracks: [track] }
  }

  const tracks: Track[] = (entity.trackList ?? []).map((t: any) => {
    const tid = String(t.uri ?? '').split(':').pop() || t.uid
    return {
      id: `spotify:${tid}`,
      url: searchUrl(t.subtitle ?? '', t.title),
      title: t.title,
      artist: t.subtitle ?? '',
      duration: t.duration ? Math.round(t.duration / 1000) : null,
      thumbnail: cover,
      album: kind === 'album' ? (entity.name ?? entity.title) : null,
    }
  })
  return {
    type: 'playlist', kind: kind as 'album' | 'playlist', source: 'spotify', id: `spotify:${id}`,
    title: entity.name ?? entity.title ?? 'Spotify', author: entity.subtitle ?? '', thumbnail: cover, url: source, tracks,
  }
}

// ---------------- Deezer (API pública, sem login) ----------------

async function deezerApi(path: string) {
  const r = await (await fetch(`https://api.deezer.com/${path}`, { signal: AbortSignal.timeout(15000) })).json() as any
  if (r?.error) throw new Error(`Deezer: ${r.error.message ?? 'não encontrado'}`)
  return r
}

const deezerTrack = (t: any, album?: any): Track => ({
  id: `deezer:${t.id}`,
  url: searchUrl(t.artist?.name ?? '', t.title),
  title: t.title,
  artist: t.artist?.name ?? '',
  duration: t.duration ?? null,
  thumbnail: (t.album ?? album)?.cover_xl ?? (t.album ?? album)?.cover_big ?? null,
  album: (t.album ?? album)?.title ?? null,
})

export async function deezerInfo(rawUrl: string): Promise<MediaInfo> {
  const url = await expand(rawUrl)
  const m = new URL(url).pathname.match(/\/(?:[a-z]{2}\/)?(track|album|playlist)\/(\d+)/)
  if (!m) throw new Error('Link do Deezer não reconhecido. Use um link de música, álbum ou playlist.')
  const [, kind, id] = m
  const source = `https://www.deezer.com/${kind}/${id}`

  if (kind === 'track') {
    const t = await deezerApi(`track/${id}`)
    const track = deezerTrack(t)
    return { type: 'video', source: 'deezer', id: track.id, title: t.title, author: track.artist, thumbnail: track.thumbnail, url: source, tracks: [track] }
  }
  const meta = await deezerApi(`${kind}/${id}`)
  // playlists grandes vêm em páginas
  const items: any[] = []
  let next: string | null = `${kind}/${id}/tracks?limit=100`
  while (next && items.length < 2000) {
    const page = await deezerApi(next)
    items.push(...(page.data ?? []))
    next = page.next ? page.next.replace('https://api.deezer.com/', '') : null
  }
  const tracks = items.map(t => deezerTrack(t, kind === 'album' ? meta : undefined))
  return {
    type: 'playlist', kind: kind as 'album' | 'playlist', source: 'deezer', id: `deezer:${id}`,
    title: meta.title, author: meta.artist?.name ?? meta.creator?.name ?? 'Deezer',
    thumbnail: meta.cover_xl ?? meta.picture_xl ?? tracks[0]?.thumbnail ?? null, url: source, tracks,
  }
}

// ---------------- lista colada ("Artista - Música" por linha) ----------------

export function textInfo(text: string): MediaInfo {
  const lines = String(text ?? '').split(/\r?\n/).map(l => l
    .replace(/^\s*\d{1,4}\s*[.)\-–]\s*/, '') // "1. " / "01 - "
    .replace(/\s+\d{1,2}:\d{2}(:\d{2})?\s*$/, '') // duração no fim
    .trim()).filter(l => l.length > 1).slice(0, 500)
  if (!lines.length) throw new Error('Cole pelo menos uma música, uma por linha.')
  const seen = new Set<string>()
  const tracks: Track[] = []
  for (const line of lines) {
    const key = line.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const parts = line.split(/\s+[-–—]\s+/)
    const artist = parts.length > 1 ? parts[0]! : ''
    const title = parts.length > 1 ? parts.slice(1).join(' - ') : line
    tracks.push({ id: `text:${key}`, url: searchUrl(artist, title), title, artist, duration: null, thumbnail: null, album: null })
  }
  return { type: 'playlist', source: 'text', id: `text:${Date.now()}`, title: 'Minha lista', author: 'Lista colada', thumbnail: null, url: '', tracks }
}

// ---------------- achar a música certa no YouTube ----------------

const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

const BAD: [RegExp, number][] = [
  [/\b(karaoke|karaokê|instrumental|playback)\b/, 45],
  [/\b(sped up|speed up|slowed|nightcore|8d audio|reverb)\b/, 45],
  [/\b(reaction|react|reagindo|tutorial|aula|como tocar)\b/, 45],
  [/\bcover\b/, 30],
  [/\b(live|ao vivo|en vivo)\b/, 22],
  [/\b(remix|mashup)\b/, 20],
  [/\b(lyrics?|letra|legendado)\b/, 3],
]

export interface SearchMatch { url: string, title: string, channel: string, duration: number | null }

/**
 * Busca "Artista - Título" no YouTube e escolhe o melhor resultado:
 * duração próxima, canal do artista / "Topic" / VEVO, "Official Audio" (áudio) ou "Official Video" (clipe),
 * e evita ao vivo, cover, karaokê, acelerada… a não ser que o nome original peça isso.
 */
export async function resolveSearch(query: string, target: { title: string, artist: string, duration: number | null }, kind: 'audio' | 'video'): Promise<SearchMatch | null> {
  const out = await runYtdlp(['--flat-playlist', '-J', `ytsearch10:${query}${kind === 'video' ? ' official video' : ''}`])
  const entries: any[] = JSON.parse(out).entries ?? []
  const wantTitle = norm(target.title)
  const wantArtist = norm(target.artist.split(',')[0] ?? '')
  const original = `${wantTitle} ${wantArtist}`

  let best: { score: number, e: any } | null = null
  for (const e of entries) {
    if (!e?.id || !e.title) continue
    const title = norm(e.title)
    const channel = norm(e.channel ?? e.uploader ?? '')
    let score = 0

    // nome da música e do artista
    const words = wantTitle.split(' ').filter(w => w.length > 1)
    const hit = words.filter(w => title.includes(w)).length / Math.max(1, words.length)
    score += hit * 40
    // artista: precisa aparecer no título ou no canal (evita outra música com o mesmo nome)
    if (wantArtist) {
      if (title.includes(wantArtist) || channel.includes(wantArtist)) score += 15
      else score -= 35
      // canal oficial: "Artista", "ArtistaVEVO" ou "Artista - Topic"
      const ch = channel.replace(/ ?vevo$/, '').replace(/ topic$/, '').replace(/ oficial$| official$/, '').trim()
      if (ch === wantArtist || ch.replace(/ /g, '') === wantArtist.replace(/ /g, '')) score += 20
    }
    if (channel.endsWith(' topic')) score += kind === 'audio' ? 20 : 0
    if (/vevo$/.test(channel)) score += 8

    // tipo de upload
    if (kind === 'audio' && /official audio|audio oficial|áudio oficial/.test(e.title.toLowerCase())) score += 12
    if (kind === 'video' && /official (music )?video|clipe oficial|videoclipe|video oficial|vídeo oficial/.test(e.title.toLowerCase())) score += 25

    // versões diferentes (só penaliza se o original não for assim)
    for (const [re, pen] of BAD) if (re.test(title) && !re.test(original)) score -= pen

    // duração (clipes costumam ter introdução, então tolera mais)
    if (target.duration && e.duration) {
      const d = Math.abs(e.duration - target.duration)
      const tol = kind === 'video' ? 90 : 20
      score -= d > tol ? 60 : d * (kind === 'video' ? 0.3 : 1.2)
    }
    if (!best || score > best.score) best = { score, e }
  }
  if (!best || best.score < 5) return null
  return {
    url: `https://www.youtube.com/watch?v=${best.e.id}`,
    title: best.e.title,
    channel: best.e.channel ?? best.e.uploader ?? '',
    duration: best.e.duration ?? null,
  }
}
