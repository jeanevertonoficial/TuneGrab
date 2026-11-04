import { parseFile } from 'music-metadata'
import { jsonStore } from './store'

/**
 * Letras das músicas. Ordem: o que já está gravado no arquivo (MP3 pode ter até a sincronizada),
 * depois o LRCLIB (acervo aberto e gratuito, sem cadastro), que tem muitas letras com o tempo de cada linha.
 */

export interface LyricLine { t: number, text: string }
export interface Lyrics {
  /** linhas com tempo (segundos); null = só a letra corrida */
  lines: LyricLine[] | null
  plain: string | null
  source: 'arquivo' | 'LRCLIB' | null
  /** o acervo não respondeu (sem internet ou ocupado): vale tentar de novo */
  unavailable?: boolean
}

const NONE: Lyrics = { lines: null, plain: null, source: null }
const API = 'https://lrclib.net/api'
// o LRCLIB pede que o app se identifique (só o nome do app, nada da pessoa)
const HEADERS = { 'user-agent': 'TuneGrab (app pessoal de música)' }

// letras já encontradas ficam guardadas (abrem na hora da próxima vez); "não achei" vale 1 dia
const store = jsonStore<Record<string, { at: number, value: Lyrics }>>('lyrics', {})
const MISS_TTL = 1000 * 60 * 60 * 24

const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/**
 * Título de vídeo do YouTube -> artista e música:
 * "01 - Toto - Africa (Official HD Video)" -> Toto / Africa;
 * "Clayton Queiroz feat. Mattos Nascimento | SOU FELIZ (AO VIVO)" -> Clayton Queiroz / SOU FELIZ
 */
export function cleanTrack(title: string, artist: string) {
  let t = title.replace(/^\s*\d{1,3}\s*[-._)]\s*/, '') // número da faixa
  let a = artist.replace(/\s*-\s*topic$/i, '').replace(/vevo$/i, '').trim()
  // "Artista | Música" ou "Música | Artista": fica com a parte que não é o artista
  if (t.includes('|')) {
    const parts = t.split('|').map(s => s.trim()).filter(Boolean)
    const notArtist = parts.find(p => !norm(p).includes(norm(a.split(/feat|ft\.|,|&/i)[0]!)))
    t = notArtist ?? parts.at(-1)!
    if (!a) a = parts[0]!
  }
  // "Artista - Música"
  const dash = t.split(/\s+[-–—]\s+/)
  if (dash.length > 1) {
    a = dash[0]!.trim()
    t = dash.slice(1).join(' - ')
  }
  t = t
    .replace(/[([][^)\]]*(official|oficial|video|vídeo|clipe|clip|lyric|letra|audio|áudio|hd|4k|remaster|visualizer|ao vivo|live|ft\.|feat)[^)\]]*[)\]]/gi, ' ')
    .replace(/\b(ft\.?|feat\.?)\s.+$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  // só o artista principal ("A feat. B", "A e B", "A, B", "A & B")
  a = a.replace(/\s*(,|&|\s(feat\.?|ft\.?|e|x)\s).*$/i, '').trim()
  return { title: t || title, artist: a }
}

/** "[01:23.45] texto" -> linhas com tempo */
export function parseLrc(lrc: string): LyricLine[] {
  const out: LyricLine[] = []
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)]
    if (!stamps.length) continue
    const text = raw.replace(/\[[^\]]*\]/g, '').trim()
    for (const s of stamps) {
      const frac = s[3] ? Number(s[3]) / 10 ** s[3].length : 0
      out.push({ t: Number(s[1]) * 60 + Number(s[2]) + frac, text })
    }
  }
  return out.sort((a, b) => a.t - b.t)
}

async function lrclib(path: string) {
  // o servidor deles às vezes responde "ocupado" (503): tenta de novo
  for (let i = 0; i < 4; i++) {
    const res = await fetch(`${API}${path}`, { headers: HEADERS, signal: AbortSignal.timeout(8000) })
    if (res.status === 404) return null
    if (res.ok) return res.json()
    if (res.status !== 503 && res.status !== 429) throw new Error(`LRCLIB ${res.status}`)
    await new Promise(r => setTimeout(r, 1000 * (i + 1)))
  }
  throw new Error('LRCLIB ocupado')
}

interface LrcEntry { trackName: string, artistName: string, duration: number, instrumental: boolean, plainLyrics: string | null, syncedLyrics: string | null }

const toLyrics = (e: LrcEntry): Lyrics => ({
  lines: e.syncedLyrics ? parseLrc(e.syncedLyrics) : null,
  plain: e.plainLyrics ?? null,
  source: 'LRCLIB',
})

async function fromLrclib(title: string, artist: string, duration: number | null): Promise<Lyrics | null> {
  const q = new URLSearchParams({ track_name: title, artist_name: artist })
  // 1) exato (artista + música + duração)
  if (artist && duration) {
    const hit = await lrclib(`/get?${q}&duration=${Math.round(duration)}`) as LrcEntry | null
    if (hit && !hit.instrumental && (hit.syncedLyrics || hit.plainLyrics)) return toLyrics(hit)
  }
  // 2) busca: prefere duração parecida e letra sincronizada
  const list = (await lrclib(artist ? `/search?${q}` : `/search?q=${encodeURIComponent(title)}`) ?? []) as LrcEntry[]
  const wantT = norm(title)
  const wantA = norm(artist)
  const scored = list
    .filter(e => !e.instrumental && (e.syncedLyrics || e.plainLyrics))
    .map((e) => {
      let s = 0
      const nt = norm(e.trackName)
      if (nt === wantT) s += 30
      else if (nt.includes(wantT) || wantT.includes(nt)) s += 15
      else s -= 40
      if (wantA && (norm(e.artistName).includes(wantA) || wantA.includes(norm(e.artistName)))) s += 20
      if (duration && e.duration) s -= Math.min(40, Math.abs(e.duration - duration))
      if (e.syncedLyrics) s += 10
      return { e, s }
    })
    .sort((a, b) => b.s - a.s)
  const best = scored[0]
  // duração muito diferente: provavelmente outra música/versão
  if (!best || best.s < 0) return null
  return toLyrics(best.e)
}

/** Letra gravada no próprio arquivo (USLT/SYLT do MP3, ©lyr do M4A, LYRICS do FLAC/OPUS). */
async function fromFile(path: string): Promise<Lyrics | null> {
  try {
    const m = await parseFile(path, { duration: false, skipCovers: true })
    let lines: LyricLine[] | null = null
    let plain: string | null = null
    for (const l of (m.common.lyrics ?? []) as any[]) {
      if (typeof l === 'string') plain ??= l
      if (l?.syncText?.length) lines ??= l.syncText.map((s: any) => ({ t: (s.timestamp ?? 0) / 1000, text: s.text ?? '' }))
      if (l?.text) {
        // alguns programas gravam o LRC (com os tempos) no campo de texto
        const lrc = parseLrc(l.text)
        if (lrc.length > 3) lines ??= lrc
        else plain ??= l.text
      }
    }
    return lines || plain ? { lines, plain: plain ?? lines?.map(x => x.text).join('\n') ?? null, source: 'arquivo' } : null
  }
  catch {
    return null
  }
}

export async function getLyrics(opts: { title: string, artist: string, duration: number | null, path?: string | null }): Promise<Lyrics> {
  const { title, artist } = cleanTrack(opts.title, opts.artist)
  const key = `${norm(artist)}|${norm(title)}|${opts.duration ? Math.round(opts.duration / 5) : ''}`
  const own = opts.path ? await fromFile(opts.path) : null
  if (own?.lines) return own // sincronizada no arquivo: melhor impossível

  const hit = store.get()[key]
  if (hit && (hit.value.source || Date.now() - hit.at < MISS_TTL)) return hit.value.source ? hit.value : (own ?? NONE)

  let found: Lyrics | null = null
  try {
    found = await fromLrclib(title, artist, opts.duration)
  }
  catch {
    return own ?? { ...NONE, unavailable: true } // sem internet / LRCLIB fora: não guarda o "não achei"
  }
  store.set({ ...store.get(), [key]: { at: Date.now(), value: found ?? NONE } })
  return found ?? own ?? NONE
}
