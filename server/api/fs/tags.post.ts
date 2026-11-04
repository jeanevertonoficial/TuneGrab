import { spawn } from 'node:child_process'
import { rename, rm } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { assertWritable } from '../../utils/drives'
import { isMedia } from '../../utils/media'
import { ffmpegPath } from '../../utils/ytdlp'
import { busyMessage } from '../../utils/moved'
import { bumpFs } from '../../utils/store'

interface Body { path: string, title?: string, artist?: string, album?: string }

export default defineEventHandler(async (event) => {
  const body = await readBody<Body>(event)
  const file = await assertWritable(body.path)
  if (!isMedia(file)) throw createError({ statusCode: 400, statusMessage: 'Não é um arquivo de mídia' })
  const ext = extname(file)
  if (ext.toLowerCase() === '.wav') throw createError({ statusCode: 400, statusMessage: 'WAV não suporta tags de forma confiável' })

  const tmp = join(dirname(file), `.tunegrab-${Date.now()}${ext}`)
  // copia os streams sem reconverter, só troca os metadados
  const args = ['-y', '-v', 'error', '-i', file, '-map', '0', '-c', 'copy', '-map_metadata', '0']
  for (const key of ['title', 'artist', 'album'] as const) {
    if (typeof body[key] === 'string') args.push('-metadata', `${key}=${body[key]!.trim()}`)
  }
  if (ext.toLowerCase() === '.mp3') args.push('-id3v2_version', '3')
  args.push(tmp)

  const err = await new Promise<string | null>((resolve) => {
    const p = spawn(ffmpegPath(), args, { windowsHide: true })
    let stderr = ''
    p.stderr.on('data', d => (stderr += d))
    p.on('error', e => resolve(e.message))
    p.on('close', code => resolve(code === 0 ? null : stderr.trim() || `ffmpeg saiu com código ${code}`))
  })
  if (err) {
    await rm(tmp, { force: true })
    throw createError({ statusCode: 500, statusMessage: `Não foi possível salvar as tags: ${err.split('\n').at(-1)}` })
  }
  try {
    await rename(tmp, file)
  }
  catch (e: any) {
    await rm(tmp, { force: true }) // não deixa a cópia temporária largada na pasta
    throw busyMessage(e) ? createError({ statusCode: 409, statusMessage: busyMessage(e)! }) : e
  }
  bumpFs()
  return { ok: true, name: basename(file) }
})
