import { spawn } from 'node:child_process'
import NodeID3 from 'node-id3'
import { rename, rm, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { ffmpegPath } from './ytdlp'

function ffmpeg(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(ffmpegPath(), args, { windowsHide: true })
    let err = ''
    p.stderr.on('data', d => (err += d))
    p.on('error', reject)
    p.on('close', code => (code === 0 ? resolve() : reject(new Error(err.trim().split('\n').at(-1) || `ffmpeg ${code}`))))
  })
}

/**
 * Regrava título/artista/álbum (e a capa, se vier uma URL) sem reconverter o áudio.
 * Usado nas músicas que vieram do Spotify/Deezer/lista: o arquivo fica com os dados originais,
 * não com o título do vídeo do YouTube.
 */
export async function writeTags(file: string, tags: { title?: string | null, artist?: string | null, album?: string | null }, coverUrl?: string | null) {
  const ext = extname(file).toLowerCase()
  if (ext === '.wav') return // WAV não guarda tags de forma confiável
  const dir = dirname(file)
  const tmp = join(dir, `.tg-tags-${Date.now()}${ext}`)
  let cover: string | null = null

  // capa nova só em formatos que aceitam imagem anexada pelo ffmpeg (OPUS/OGG não)
  if (coverUrl && ['.mp3', '.m4a', '.flac', '.mp4'].includes(ext)) {
    try {
      const res = await fetch(coverUrl, { signal: AbortSignal.timeout(10000) })
      if (res.ok) {
        cover = join(dir, `.tg-cover-${Date.now()}.jpg`)
        await writeFile(cover, Buffer.from(await res.arrayBuffer()))
      }
    }
    catch { /* sem capa: mantém a que veio do YouTube */ }
  }

  const meta: string[] = []
  for (const [k, v] of Object.entries(tags)) if (v) meta.push('-metadata', `${k}=${v}`)
  const args = ['-y', '-v', 'error', '-i', file]
  if (cover && ext !== '.mp4') {
    args.push('-i', cover, '-map', '0:a', '-map', '1:0', '-c', 'copy', '-disposition:v:0', 'attached_pic')
    if (ext === '.mp3') args.push('-id3v2_version', '3', '-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)')
  }
  else {
    args.push('-map', '0', '-c', 'copy')
  }
  args.push('-map_metadata', '0', ...meta, tmp)

  try {
    await ffmpeg(args)
    await rename(tmp, file)
  }
  finally {
    await rm(tmp, { force: true })
    if (cover) await rm(cover, { force: true })
  }
}

/**
 * MP3: o ffmpeg não grava letra no MP3, então vai pelo node-id3. Grava a letra corrida (USLT, que celular e
 * som de carro mostram) e, quando existir, a sincronizada (SYLT, com o tempo de cada linha).
 */
export async function writeMp3Lyrics(file: string, plain: string, lines: { t: number, text: string }[] | null) {
  const tags: Record<string, unknown> = { unsynchronisedLyrics: { language: 'por', text: plain } }
  if (lines?.length) {
    tags.synchronisedLyrics = [{
      language: 'por',
      timeStampFormat: 2, // milissegundos
      contentType: 1, // letra
      shortText: '',
      synchronisedText: lines.map(l => ({ text: l.text, timeStamp: Math.round(l.t * 1000) })),
    }]
  }
  await NodeID3.Promise.update(tags as any, file) // falha = lança erro
}
