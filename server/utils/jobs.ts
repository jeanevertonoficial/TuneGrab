import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { constants, mkdirSync, rmSync, existsSync } from 'node:fs'
import { copyFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { existingFile, recordDownload, seedFromHistory } from './downloaded'
import { freeName } from './names'
import { resolveSearch } from './services'
import { BOT_MESSAGE, disableCookies, getSettings, hasLogin } from './settings'
import { bumpFs, currentFsVersion, jsonStore } from './store'
import { getLyrics } from './lyrics'
import { writeMp3Lyrics, writeTags } from './tagger'
import { baseArgs, cleanError, COOKIE_MESSAGE, spawnEnv, ytdlpPath, type Track } from './ytdlp'

export const FORMATS = {
  mp3: { label: 'MP3', kind: 'audio', qualities: ['320', '256', '192', '128'] },
  m4a: { label: 'M4A (AAC)', kind: 'audio', qualities: ['256', '192', '128'] },
  opus: { label: 'OPUS', kind: 'audio', qualities: ['160', '128', '96'] },
  flac: { label: 'FLAC', kind: 'audio', qualities: ['lossless'] },
  wav: { label: 'WAV', kind: 'audio', qualities: ['lossless'] },
  mp4: { label: 'MP4 (vídeo)', kind: 'video', qualities: ['1080', '720', '480', '360'] },
} as const

export type FormatId = keyof typeof FORMATS
export type VideoCodec = 'vp9' | 'h264'
export type ItemStatus = 'queued' | 'searching' | 'downloading' | 'converting' | 'saving' | 'done' | 'error' | 'canceled'

export interface JobItem extends Track {
  index: number
  status: ItemStatus
  progress: number
  file?: string
  savedTo?: string
  error?: string
  /** música do Spotify/Deezer/lista: vídeo do YouTube escolhido na busca */
  matched?: { url: string, title: string, channel: string }
}

export interface Job {
  id: string
  title: string
  type: 'video' | 'playlist' | 'channel'
  thumbnail: string | null
  format: FormatId
  quality: string
  /** só MP4: vp9 (leve, ~metade do tamanho) ou h264 (compatível com aparelhos antigos) */
  codec?: VideoCodec
  /** link original (para reconhecer o mesmo link depois) */
  sourceUrl?: string
  /** substituir arquivos que já existem em vez de criar "nome (2)" */
  replace?: boolean
  status: 'running' | 'done' | 'error' | 'canceled'
  createdAt: number
  dir: string
  /** pasta onde os arquivos prontos são gravados (pendrive, Músicas…); null = só pelo navegador */
  destination: string | null
  items: JobItem[]
}

const CONCURRENCY = 3

// limite GLOBAL de faixas baixando ao mesmo tempo (somando todos os downloads):
// muitas conexões simultâneas fazem o YouTube pedir "confirme que não é um robô".
// Sem login o ritmo é mais calmo (2 por vez e uma pausa entre músicas); com login, normal.
const maxActive = () => (hasLogin() ? 3 : 2)
const PAUSE_NO_LOGIN = 1500
let active = 0
const waiting: (() => void)[] = []

async function acquireSlot() {
  if (active < maxActive()) {
    active++
    return
  }
  await new Promise<void>(r => waiting.push(r)) // a vaga é repassada direto por releaseSlot
}

function releaseSlot() {
  // a vaga passa direto para quem espera (se o limite não diminuiu nesse meio-tempo)
  const next = active <= maxActive() ? waiting.shift() : undefined
  if (next) next()
  else active--
}
const TTL = 1000 * 60 * 60 * 3
const root = join(tmpdir(), 'tunegrab')

const MAX_HISTORY = 60

const jobs = new Map<string, Job>()
const procs = new Map<string, Set<ChildProcess>>()

// histórico salvo em disco: "Seus downloads" continua lá depois de fechar o app
const history = jsonStore<Job[]>('jobs', [])
for (const j of history.get()) {
  if (j.status === 'running') {
    j.status = j.items.some(i => i.status === 'done') ? 'done' : 'error'
    for (const i of j.items) {
      if (!['done', 'error', 'canceled'].includes(i.status)) {
        i.status = 'error'
        i.error = 'Interrompido: o app foi fechado durante o download'
      }
    }
  }
  jobs.set(j.id, j)
}
seedFromHistory([...jobs.values()])

function persist() {
  history.set(listJobs().slice(0, MAX_HISTORY))
}

setInterval(() => {
  const now = Date.now()
  for (const job of jobs.values()) {
    if (job.status === 'running' || now - job.createdAt < TTL) continue
    // arquivos temporários vencidos: some com eles; se foi salvo numa pasta, o registro continua no histórico
    const pending = job.items.some(i => i.status !== 'done')
    if (!pending && existsSync(job.dir)) rmSync(job.dir, { recursive: true, force: true })
    if (!job.destination && !pending) removeJob(job.id)
  }
}, 1000 * 60 * 10).unref()

export const listJobs = () => [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt)
export const getJob = (id: string) => jobs.get(id)

// a tela pergunta pelos downloads a cada 0,7 s: não confere no disco toda vez se cada arquivo ainda existe
const existsCache = new Map<string, { at: number, v: number, ok: boolean }>()
function stillThere(path: string) {
  const hit = existsCache.get(path)
  if (hit && hit.v === currentFsVersion() && Date.now() - hit.at < 5000) return hit.ok
  const ok = existsSync(path)
  existsCache.set(path, { at: Date.now(), v: currentFsVersion(), ok })
  if (existsCache.size > 5000) existsCache.delete(existsCache.keys().next().value!)
  return ok
}

export function publicJob(job: Job) {
  const { dir, ...rest } = job
  return {
    ...rest,
    items: rest.items.map(({ file, ...i }) => ({
      ...i,
      fileName: file ? basename(file) : null,
      // pronta, mas o arquivo salvo foi excluído/movido (ou o pendrive está fora)
      missing: i.status === 'done' && !!i.savedTo && !stillThere(i.savedTo),
    })),
  }
}

export function createJob(opts: {
  title: string
  type: Job['type']
  thumbnail: string | null
  format: FormatId
  quality: string
  codec?: VideoCodec
  tracks: Track[]
  destination: string | null
  sourceUrl?: string
  replace?: boolean
}) {
  const id = randomUUID()
  const dir = join(root, id)
  mkdirSync(dir, { recursive: true })
  const job: Job = {
    id,
    title: opts.title,
    type: opts.type,
    thumbnail: opts.thumbnail,
    format: opts.format,
    quality: opts.quality,
    codec: opts.format === 'mp4' ? (opts.codec ?? 'vp9') : undefined,
    sourceUrl: opts.sourceUrl,
    replace: opts.replace,
    status: 'running',
    createdAt: Date.now(),
    dir,
    destination: opts.destination,
    items: opts.tracks.map((t, index) => ({ ...t, index, status: 'queued', progress: 0 })),
  }
  jobs.set(id, job)
  procs.set(id, new Set())
  persist()
  void runJob(job)
  return job
}

export function cancelJob(id: string) {
  const job = jobs.get(id)
  // download que já terminou continua "Concluído" (antes virava "Cancelado")
  if (!job || job.status !== 'running') return
  for (const it of job.items) if (['queued', 'searching', 'downloading', 'converting'].includes(it.status)) it.status = 'canceled'
  for (const p of procs.get(id) ?? []) p.kill()
  job.status = 'canceled'
  persist()
}

/**
 * Retoma um download cancelado ou interrompido (app/computador desligou):
 * só as faixas que faltam; o que estava pela metade continua do ponto onde parou
 * (os arquivos .part ficam na pasta temporária do download).
 */
export function resumeJob(id: string) {
  const job = jobs.get(id)
  if (!job) throw new Error('Download não encontrado')
  if (job.status === 'running') return job
  const pending = job.items.filter(i => i.status !== 'done')
  if (!pending.length) throw new Error('Nada para retomar: todas as faixas já estão prontas')
  for (const i of pending) {
    i.status = 'queued'
    i.progress = 0
    i.error = undefined
  }
  mkdirSync(job.dir, { recursive: true })
  job.status = 'running'
  procs.set(id, procs.get(id) ?? new Set())
  persist()
  void runJob(job)
  return job
}

/** Arquivo movido/renomeado: o histórico continua apontando para ele (senão aparecia "Excluída"). */
export function renameJobPaths(from: string, to: string) {
  const f = from.toLowerCase()
  let changed = false
  for (const job of jobs.values()) {
    for (const i of job.items) {
      const p = i.savedTo?.toLowerCase()
      if (!p) continue
      if (p === f) i.savedTo = to
      else if (p.startsWith(`${f}\\`) || p.startsWith(`${f}/`)) i.savedTo = to + i.savedTo!.slice(from.length)
      else continue
      changed = true
    }
  }
  if (changed) persist()
}

export function removeJob(id: string) {
  cancelJob(id)
  const job = jobs.get(id)
  if (job && existsSync(job.dir)) rmSync(job.dir, { recursive: true, force: true })
  jobs.delete(id)
  procs.delete(id)
  persist()
}

async function runJob(job: Job) {
  const queue = job.items.filter(i => i.status === 'queued')
  let next = 0
  const worker = async () => {
    while (next < queue.length && job.status === 'running') {
      const item = queue[next++]!
      if (item.status !== 'queued') continue
      await acquireSlot()
      try {
        // pode ter sido cancelado (ou pausado pelo bloqueio) enquanto esperava a vaga
        if (item.status !== 'queued' || job.status !== 'running') continue
        await downloadItem(job, item)
      }
      finally {
        if (!hasLogin() && job.status === 'running') await new Promise(r => setTimeout(r, PAUSE_NO_LOGIN))
        releaseSlot()
      }
      if (item.status === 'done' && job.destination) await saveItem(job, item)
      // YouTube bloqueou: as próximas também falhariam. Pausa o resto para retomar depois.
      if (item.status === 'error' && item.error === BOT_MESSAGE) {
        for (const rest of queue) {
          if (rest.status === 'queued') {
            rest.status = 'error'
            rest.error = BOT_MESSAGE
          }
        }
        next = queue.length
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))
  if (job.status === 'running')
    job.status = job.items.some(i => i.status === 'done') ? 'done' : 'error'
  persist()
}

async function saveItem(job: Job, item: JobItem) {
  item.status = 'saving'
  try {
    mkdirSync(job.destination!, { recursive: true })
    const plain = join(job.destination!, basename(item.file!))
    // substituir: grava por cima do arquivo com o mesmo nome e apaga a versão antiga (se estava em outro lugar)
    const old = job.replace ? existingFile(item.id, job.format) : null
    let target = plain
    if (job.replace) await copyFile(item.file!, target)
    else {
      // dois downloads gravando o mesmo nome ao mesmo tempo: nunca sobrescreve, pega o próximo "(n)"
      for (let tries = 0; ; tries++) {
        target = freeName(job.destination!, basename(item.file!))
        try {
          await copyFile(item.file!, target, constants.COPYFILE_EXCL)
          break
        }
        catch (e: any) {
          if (e.code !== 'EEXIST' || tries > 20) throw e
        }
      }
    }
    if (old && old.toLowerCase() !== target.toLowerCase()) await rm(old, { force: true })
    item.savedTo = target
    recordDownload(item.id, job.format, target)
    bumpFs()
    item.status = 'done'
  }
  catch (e: any) {
    item.status = 'error'
    item.error = `Baixou, mas não conseguiu salvar na pasta: ${e.code === 'ENOSPC' ? 'sem espaço' : e.code || e.message}`
  }
  persist()
}

function formatArgs(format: FormatId, quality: string, codec: VideoCodec = 'vp9'): string[] {
  if (format === 'mp4') {
    const h = Number(quality) || 1080
    const v = `bv*[height<=${h}]`
    // VP9: mesma resolução com ~metade do tamanho (baixa ~2x mais rápido).
    // H.264: maior, mas abre em TV antiga e som de carro. Áudio sempre AAC (m4a) dentro do MP4.
    const order = codec === 'h264'
      ? [`${v}[vcodec^=avc1]+ba[ext=m4a]`, `${v}[ext=mp4]+ba[ext=m4a]`]
      : [`${v}[vcodec^=vp09][protocol^=https]+ba[ext=m4a]`, `${v}[vcodec=vp9][protocol^=https]+ba[ext=m4a]`, `${v}[vcodec^=avc1]+ba[ext=m4a]`]
    return [
      '-f', [...order, `${v}+ba`, `b[height<=${h}]`, 'b'].join('/'),
      '--merge-output-format', 'mp4',
      '--embed-metadata', '--embed-thumbnail',
    ]
  }
  // M4A/OPUS: pega o áudio que o YouTube já entrega nesse codec, assim só remuxa (sem reconverter)
  const source = format === 'm4a' ? 'bestaudio[ext=m4a]/bestaudio/best' : format === 'opus' ? 'bestaudio[acodec=opus]/bestaudio/best' : 'bestaudio/best'
  const args = ['-f', source, '-x', '--audio-format', format, '--embed-metadata']
  if (quality !== 'lossless') args.push('--audio-quality', `${quality}K`)
  if (format !== 'wav') args.push('--embed-thumbnail')
  // capa quadrada, como em players de música
  if (format !== 'wav') args.push('--convert-thumbnails', 'jpg', '--ppa', 'ThumbnailsConvertor+FFmpeg_o:-vf crop=ih:ih')
  return args
}

/** nome de arquivo literal dentro do template do yt-dlp (% precisa virar %%) */
const literal = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/%/g, '%%').replace(/\s+/g, ' ').trim().slice(0, 150)

async function downloadItem(job: Job, item: JobItem): Promise<void> {
  // Spotify/Deezer/lista: primeiro acha o vídeo certo no YouTube
  let url = item.url
  const fromSearch = url.startsWith('search:')
  if (fromSearch) {
    item.status = 'searching'
    try {
      const match = item.matched ?? await resolveSearch(url.slice(7), item, FORMATS[job.format].kind === 'video' ? 'video' : 'audio')
      if (!match) {
        item.status = 'error'
        item.error = 'Não encontrei essa música no YouTube'
        return
      }
      item.matched = { url: match.url, title: match.title, channel: match.channel }
      url = match.url
    }
    catch (e: any) {
      if (item.status === 'canceled') return
      item.status = 'error'
      item.error = `Falha na busca: ${e.message}`
      return
    }
  }

  // cancelado enquanto procurava no YouTube: não começa a baixar
  if (item.status === 'canceled') return

  const prefix = job.type !== 'video' ? `${String(item.index + 1).padStart(2, '0')} - ` : ''
  // da busca: o arquivo leva o nome original ("Artista - Música"), não o título do vídeo
  const name = fromSearch ? literal([item.artist, item.title].filter(Boolean).join(' - ')) : '%(title).150B'
  const args = (useCookies: boolean) => [
    ...baseArgs(useCookies),
    ...formatArgs(job.format, job.quality, job.codec),
    '--no-playlist',
    '--windows-filenames',
    '-N', '4', // baixa 4 fragmentos ao mesmo tempo (vídeos em HLS/DASH)
    '--no-mtime',
    '--no-simulate', '--progress', '--newline',
    '--progress-template', 'download:PROG %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s',
    '--print', 'after_move:FILE %(filepath)s',
    '-o', join(job.dir, `${prefix}${name}.%(ext)s`),
    url,
  ]

  await runDownload(job, item, args(true))
  // login do navegador ilegível (ex.: Chrome no Windows): desliga o login e tenta de novo sem ele
  if (item.status === 'error' && item.error?.startsWith(COOKIE_MESSAGE)) {
    disableCookies()
    item.error = undefined
    await runDownload(job, item, args(false))
  }

  if (item.status !== 'done' || !item.file) return
  // letra (se ligado nas Configurações): vai gravada no arquivo, para aparecer também no celular/som do carro
  const wantsLyrics = FORMATS[job.format].kind === 'audio' && job.format !== 'wav' && getSettings().embedLyrics !== false
  const lyrics = wantsLyrics ? await getLyrics({ title: item.title, artist: item.artist, duration: item.duration }).catch(() => null) : null
  const plain = lyrics?.plain ?? lyrics?.lines?.map(l => l.text).join('\n') ?? null
  const isMp3 = job.format === 'mp3'
  if (!fromSearch && !plain) return

  item.status = 'converting'
  // da busca: grava título/artista/álbum e a capa originais (Spotify/Deezer) no arquivo
  const tags: Record<string, string | null> = fromSearch ? { title: item.title, artist: item.artist, album: item.album ?? null } : {}
  if (plain && !isMp3) tags.lyrics = plain // M4A/FLAC/OPUS: pelo ffmpeg
  if (Object.keys(tags).length) await writeTags(item.file, tags, fromSearch ? item.thumbnail : null).catch(() => {})
  if (plain && isMp3) await writeMp3Lyrics(item.file, plain, lyrics?.lines ?? null).catch(() => {}) // MP3: inclusive a sincronizada
  if (item.status === 'converting') item.status = 'done'
}

function runDownload(job: Job, item: JobItem, args: string[]): Promise<void> {
  return new Promise<void>((resolve) => {
    item.status = 'downloading'
    const p = spawn(ytdlpPath(), args, { windowsHide: true, env: spawnEnv })
    procs.get(job.id)?.add(p)
    let stderr = ''
    let buf = ''
    // vídeo tem 2 streams (vídeo + áudio); cada um conta metade
    let stream = 0
    let lastPct = 0

    p.stdout.setEncoding('utf8')
    p.stdout.on('data', (chunk: string) => {
      buf += chunk
      const lines = buf.split(/\r?\n/)
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (line.startsWith('PROG ')) {
          const [, done, total, est] = line.split(' ')
          const t = Number(total) || Number(est)
          const pct = t ? Math.min(100, (Number(done) / t) * 100) : 0
          if (pct + 5 < lastPct) stream++
          lastPct = pct
          const streams = job.format === 'mp4' ? 2 : 1
          item.progress = Math.min(99, (Math.min(stream, streams - 1) * 100 + pct) / streams)
          if (pct >= 100 && stream >= streams - 1) item.status = 'converting'
        }
        else if (line.startsWith('FILE ')) {
          item.file = line.slice(5).trim()
        }
      }
    })
    // só o fim importa (a mensagem de erro); downloads longos não acumulam megabytes de log
    p.stderr.on('data', d => (stderr = (stderr + d).slice(-8000)))
    p.on('error', (e) => {
      item.status = 'error'
      item.error = e.message
      resolve()
    })
    p.on('close', (code) => {
      procs.get(job.id)?.delete(p)
      if (item.status === 'canceled' || item.status === 'error') return resolve()
      if (code === 0 && item.file && existsSync(item.file)) {
        item.status = 'done'
        item.progress = 100
      }
      else {
        item.status = 'error'
        item.error = cleanError(stderr) || 'Falha no download'
      }
      resolve()
    })
  })
}
