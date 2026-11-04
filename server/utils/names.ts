import { existsSync } from 'node:fs'
import { extname, join } from 'node:path'

/** Limpa um nome de pasta/arquivo para funcionar no Windows e em pendrives FAT32/exFAT. */
export function safeName(name: string) {
  const clean = String(name ?? '')
    .replace(/[\\/:*?"<>|\x00-\x1F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 120)
  if (!clean || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(clean))
    throw createError({ statusCode: 400, statusMessage: 'Nome inválido' })
  return clean
}

/** "musica.mp3" -> "musica (2).mp3" quando já existe no destino */
export function freeName(dir: string, name: string) {
  let target = join(dir, name)
  const ext = extname(name)
  const base = name.slice(0, name.length - ext.length)
  for (let n = 2; existsSync(target); n++) target = join(dir, `${base} (${n})${ext}`)
  return target
}
