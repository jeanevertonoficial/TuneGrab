import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { deezerInfo, detectService, spotifyInfo } from './services'
import { BOT_MESSAGE, cookieArgs, disableCookies, isBotBlock } from './settings'

const isWin = process.platform === 'win32'

export function ytdlpPath() {
  if (process.env.YTDLP_PATH) return process.env.YTDLP_PATH
  // versão em pasta (inicia ~3x mais rápido) > versão arquivo único > yt-dlp do sistema
  const candidates = isWin
    ? [join(process.cwd(), 'bin', 'yt-dlp', 'yt-dlp.exe'), join(process.cwd(), 'bin', 'yt-dlp.exe')]
    : [join(process.cwd(), 'bin', 'yt-dlp')]
  return candidates.find(existsSync) ?? 'yt-dlp'
}

export function ffmpegPath(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH
  try {
    // resolve a partir do projeto para não depender do bundle do Nitro
    const req = createRequire(join(process.cwd(), 'package.json'))
    return req('ffmpeg-static') as string
  }
  catch {
    return 'ffmpeg'
  }
}

// força UTF-8 na saída do yt-dlp (no Windows o padrão é cp1252 e quebra títulos com acentos/CJK)
export const spawnEnv = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }

export const baseArgs = (useCookies = true) => [
  '--no-warnings',
  '--encoding', 'utf-8',
  '--js-runtimes', 'node',
  '--ffmpeg-location', ffmpegPath(),
  ...(useCookies ? cookieArgs() : []),
]

/** o yt-dlp não conseguiu ler o login do navegador (ex.: Chrome no Windows protege os cookies) */
export const isCookieReadError = (msg: string) => /could not (find|copy).*cookie|failed to decrypt|cookies? database|cookie.*(locked|permission)/i.test(msg)

export const COOKIE_MESSAGE = 'Não consegui ler o login do navegador escolhido'

// leitura de link/busca: se o YouTube não responder, desiste (antes a tela ficava carregando para sempre)
const INFO_TIMEOUT = 1000 * 120

function spawnYtdlp(args: string[], useCookies: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(ytdlpPath(), [...baseArgs(useCookies), ...args], { windowsHide: true, env: spawnEnv })
    let out = ''
    let err = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      p.kill()
    }, INFO_TIMEOUT)
    p.stdout.setEncoding('utf8')
    p.stdout.on('data', d => (out += d))
    p.stderr.on('data', d => (err = (err + d).slice(-8000)))
    p.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`Não foi possível executar o yt-dlp: ${e.message}`))
    })
    p.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) reject(new Error('O YouTube demorou demais para responder. Tente de novo em instantes.'))
      else if (code === 0) resolve(out)
      else reject(new Error(cleanError(err) || `yt-dlp saiu com código ${code}`))
    })
  })
}

export async function runYtdlp(args: string[]): Promise<string> {
  try {
    return await spawnYtdlp(args, true)
  }
  catch (e: any) {
    // login do navegador ilegível: não pode travar nada — desliga e tenta de novo sem login
    if (!e.message.startsWith(COOKIE_MESSAGE)) throw e
    disableCookies()
    return spawnYtdlp(args, false)
  }
}

export function cleanError(stderr: string) {
  const lines = stderr.split(/\r?\n/).filter(l => l.startsWith('ERROR'))
  const msg = (lines.at(-1) || stderr.trim().split(/\r?\n/).at(-1) || '').replace(/^ERROR:\s*/, '')
  if (isCookieReadError(msg))
    return `${COOKIE_MESSAGE} (${msg.replace(/^\[[^\]]+\]\s*/, '').replace(/\s*See\s+https?:\S+.*$/i, '').slice(0, 120)}).`
  if (isBotBlock(msg)) return BOT_MESSAGE
  return msg
}

export interface Track {
  id: string
  url: string
  title: string
  artist: string
  duration: number | null
  thumbnail: string | null
  /** canal: aba de onde veio (Vídeos, Shorts, Ao vivo) */
  section?: string
  /** Spotify/Deezer: álbum, gravado nas tags */
  album?: string | null
}

export interface MediaInfo {
  type: 'video' | 'playlist' | 'channel'
  /** de onde veio a lista (Spotify/Deezer/lista colada viram buscas no YouTube) */
  source?: 'youtube' | 'spotify' | 'deezer' | 'text' | 'search' | 'other'
  kind?: 'playlist' | 'album'
  id: string
  title: string
  author: string
  thumbnail: string | null
  url: string
  tracks: Track[]
  /** veio do oEmbed: falta a duração (buscar com getDetails) */
  partial?: boolean
}

function thumbFor(e: any): string | null {
  if (e.ie_key === 'Youtube' || e.extractor_key === 'Youtube')
    return `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`
  if (e.thumbnail) return e.thumbnail
  const list = e.thumbnails as { url: string }[] | undefined
  return list?.length ? list[list.length - 1]!.url : null
}

function toTrack(e: any): Track {
  return {
    id: e.id,
    url: e.webpage_url || e.url || `https://www.youtube.com/watch?v=${e.id}`,
    title: e.title || e.id,
    artist: e.artist || e.uploader || e.channel || '',
    duration: e.duration ?? null,
    thumbnail: thumbFor(e),
  }
}

export async function getInfo(url: string): Promise<MediaInfo> {
  const key = url.trim()
  const hit = infoCache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.info

  // Spotify/Deezer: lê a lista no serviço; cada faixa vira uma busca no YouTube na hora de baixar
  const service = detectService(key)
  if (service === 'amazon')
    throw new Error('O Amazon Music só mostra as músicas com login, então o link não pode ser lido. Use "Colar lista de músicas": abra a playlist na Amazon, copie os nomes e cole aqui.')
  if (service) {
    const info = service === 'spotify' ? await spotifyInfo(key) : await deezerInfo(key)
    infoCache.set(key, { at: Date.now(), info })
    return info
  }

  // vídeo único do YouTube: título e capa pelo oEmbed (~0,5 s); a duração vem depois em getDetails
  const vid = youtubeVideoId(key)
  if (vid) {
    const fast = await oembed(vid).catch(() => null)
    if (fast) {
      infoCache.set(key, { at: Date.now(), info: fast })
      return fast
    }
  }

  const info = await extractInfo(key)
  infoCache.set(key, { at: Date.now(), info })
  return info
}

const CACHE_TTL = 1000 * 60 * 30
const infoCache = new Map<string, { at: number, info: MediaInfo }>()

/** entrou/saiu da conta: listas privadas mudam */
export const clearInfoCache = () => infoCache.clear()

/** Só para links de vídeo único (sem playlist): watch?v=, youtu.be/, shorts/, music.youtube */
function youtubeVideoId(url: string) {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^(www|m|music)\./, '')
    if (u.searchParams.has('list')) return null
    if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null
    if (host !== 'youtube.com') return null
    if (u.pathname === '/watch') return u.searchParams.get('v')
    const m = u.pathname.match(/^\/(shorts|live|embed)\/([\w-]{6,})/)
    return m?.[2] ?? null
  }
  catch {
    return null
  }
}

async function oembed(id: string): Promise<MediaInfo> {
  const url = `https://www.youtube.com/watch?v=${id}`
  const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(4000) })
  if (!res.ok) throw new Error(`oEmbed ${res.status}`)
  const o = await res.json() as { title: string, author_name: string }
  const thumbnail = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
  const track: Track = { id, url, title: o.title, artist: o.author_name, duration: null, thumbnail }
  return { type: 'video', id, title: o.title, author: o.author_name, thumbnail, url, tracks: [track], partial: true }
}

/** Detalhes que o oEmbed não traz (duração). Usa um modo leve do yt-dlp, sem listar formatos. */
export async function getDetails(url: string): Promise<MediaInfo> {
  const key = url.trim()
  const hit = infoCache.get(key)
  if (hit && !hit.info.partial && Date.now() - hit.at < CACHE_TTL) return hit.info
  let info: MediaInfo
  try {
    const raw = JSON.parse(await runYtdlp(['-J', '--no-playlist', '--ignore-no-formats-error', '-f', 'bestaudio/best', '--extractor-args', 'youtube:player_skip=js;player_client=web_safari', key]))
    const track = toTrack(raw)
    info = { type: 'video', id: raw.id, title: track.title, author: track.artist, thumbnail: track.thumbnail, url: track.url, tracks: [track] }
  }
  catch {
    info = await extractInfo(key) // modo leve falhou: extração completa
  }
  infoCache.set(key, { at: Date.now(), info })
  return info
}

const TAB_NAMES: Record<string, string> = { videos: 'Vídeos', shorts: 'Shorts', streams: 'Ao vivo', releases: 'Lançamentos', podcasts: 'Podcasts' }
const tabOf = (url: string) => url.match(/\/(videos|shorts|streams|releases|podcasts)\/?$/)?.[1] ?? null
const isChannelUrl = (url: string) => /youtube\.com\/(@|channel\/|c\/|user\/)/.test(url)

/** vídeos válidos, sem repetir (Mix do YouTube às vezes traz a mesma música duas vezes) */
function cleanTracks(entries: any[], section?: string): Track[] {
  const seen = new Set<string>()
  const out: Track[] = []
  for (const e of entries ?? []) {
    if (!e?.id || e.title === '[Private video]' || e.title === '[Deleted video]' || seen.has(e.id)) continue
    if (e._type === 'playlist' || e.ie_key === 'YoutubeTab') continue
    seen.add(e.id)
    out.push({ ...toTrack(e), ...(section ? { section } : {}) })
  }
  return out
}

/** foto do canal (quadrada), se o YouTube mandar */
function channelAvatar(raw: any): string | null {
  const list = (raw.thumbnails ?? []) as { id?: string, url: string, width?: number, height?: number }[]
  return list.find(t => t.id === 'avatar_uncropped')?.url
    ?? list.filter(t => t.width && t.width === t.height).sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url
    ?? null
}

/** Mix/Rádio do YouTube (list=RD…): a lista não tem fim (500+ vídeos, ~1 min para ler) */
const isMix = (url: string) => /[?&]list=RD/i.test(url)
export const MIX_SIZE = 25

/** Busca por nome (música, artista, gênero…): os vídeos mais relevantes do YouTube. */
export async function searchInfo(query: string): Promise<MediaInfo> {
  const q = query.trim().slice(0, 200)
  const key = `search:${q.toLowerCase()}`
  const hit = infoCache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.info
  const raw = JSON.parse(await runYtdlp(['-J', '--flat-playlist', `ytsearch30:${q}`]))
  const tracks = cleanTracks(raw.entries)
  if (!tracks.length) throw new Error(`Nada encontrado para "${q}".`)
  const info: MediaInfo = {
    type: 'playlist', source: 'search', id: key, title: `Resultados para "${q}"`, author: 'Busca no YouTube',
    thumbnail: tracks[0]!.thumbnail, url: '', tracks,
  }
  infoCache.set(key, { at: Date.now(), info })
  return info
}

/** listas da conta: nome em português e um limite (curtidas e inscrições podem ter milhares de vídeos) */
const ACCOUNT_LISTS: { test: RegExp, title: string, limit: number }[] = [
  { test: /[?&]list=LL\b/, title: 'Músicas curtidas', limit: 500 },
  { test: /[?&]list=WL\b/, title: 'Assistir mais tarde', limit: 500 },
  { test: /\/feed\/subscriptions/, title: 'Inscrições: vídeos novos', limit: 100 },
]

async function extractInfo(url: string): Promise<MediaInfo> {
  const account = ACCOUNT_LISTS.find(l => l.test.test(url))
  // Mix: só os primeiros (como o YouTube mostra), em ~3 s em vez de ~1 min
  const limit = isMix(url) ? MIX_SIZE : account?.limit
  const raw = JSON.parse(await runYtdlp(['-J', '--flat-playlist', ...(limit ? ['--playlist-end', String(limit)] : []), url]))
  if (account) raw.title = account.title

  // canal: o YouTube devolve as ABAS (Vídeos, Shorts, Ao vivo). Abre cada uma e junta tudo.
  const entries: any[] = raw.entries ?? []
  // as abas podem vir como link (ie_key YoutubeTab) ou já preenchidas (_type playlist com entries)
  const tabUrl = (e: any) => e?.url ?? e?.webpage_url ?? ''
  const tabs = entries.filter(e => (e?.ie_key === 'YoutubeTab' || e?._type === 'playlist') && tabOf(tabUrl(e)))
  if (raw._type === 'playlist' && tabs.length && tabs.length === entries.length) {
    const lists = await Promise.all(tabs.map(async (t) => {
      const section = TAB_NAMES[tabOf(tabUrl(t))!]
      if (Array.isArray(t.entries)) return cleanTracks(t.entries, section)
      try {
        const sub = JSON.parse(await runYtdlp(['-J', '--flat-playlist', '--playlist-end', '1500', tabUrl(t)]))
        return cleanTracks(sub.entries, section)
      }
      catch {
        return []
      }
    }))
    const seen = new Set<string>()
    const tracks = lists.flat().filter(t => !seen.has(t.id) && seen.add(t.id))
    return {
      type: 'channel',
      id: raw.id,
      title: raw.channel || raw.uploader || raw.title || 'Canal',
      author: raw.channel || raw.uploader || '',
      thumbnail: channelAvatar(raw) ?? tracks[0]?.thumbnail ?? null,
      url: raw.webpage_url || url,
      tracks,
    }
  }

  if (raw._type === 'playlist') {
    // link direto de uma aba do canal (…/videos, …/shorts): também é "canal"
    const tab = tabOf(raw.webpage_url || url)
    const channel = tab && isChannelUrl(raw.webpage_url || url)
    const tracks = cleanTracks(raw.entries, channel ? TAB_NAMES[tab!] : undefined)
    if (channel) {
      return {
        type: 'channel', id: raw.id, title: raw.channel || raw.uploader || raw.title || 'Canal', author: raw.channel || raw.uploader || '',
        thumbnail: channelAvatar(raw) ?? tracks[0]?.thumbnail ?? null, url: raw.webpage_url || url, tracks,
      }
    }
    return {
      type: 'playlist',
      id: raw.id,
      title: raw.title || 'Playlist',
      author: raw.uploader || raw.channel || '',
      thumbnail: tracks[0]?.thumbnail ?? thumbFor(raw),
      url: raw.webpage_url || url,
      tracks,
    }
  }
  const track = toTrack(raw)
  return { type: 'video', id: raw.id, title: track.title, author: track.artist, thumbnail: track.thumbnail, url: track.url, tracks: [track] }
}
