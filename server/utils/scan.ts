import { readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { deletePending, isMedia, readMeta } from './media'

const SKIP = new Set([
  'node_modules', 'appdata', 'windows', 'program files', 'program files (x86)', 'programdata',
  'system volume information', '$recycle.bin', 'recovery', 'perflogs', 'library', 'proc', 'sys',
])
const MAX_FILES = 5000
const MAX_DEPTH = 12

/** Procura arquivos de mídia na pasta e subpastas (pula pastas do sistema e ocultas). */
export async function findMedia(root: string) {
  const found: string[] = []
  let truncated = false

  async function walk(dir: string, depth: number) {
    if (depth > MAX_DEPTH || truncated) return
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      if (truncated) return
      if (e.name.startsWith('.') || e.name.startsWith('$')) continue
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        if (!SKIP.has(e.name.toLowerCase())) await walk(full, depth + 1)
      }
      else if (e.isFile() && isMedia(e.name)) {
        found.push(full)
        if (found.length >= MAX_FILES) truncated = true
      }
    }
  }
  await walk(root, 0)
  return { found, truncated }
}

export interface MediaFile {
  name: string
  path: string
  size: number
  mtime: number
  title: string | null
  artist: string | null
  album: string | null
  duration: number | null
  bitrate: number | null
  hasCover: boolean
}

/** Lê tamanho e tags em lotes, para não abrir centenas de arquivos de uma vez. */
export async function describe(all: string[]): Promise<MediaFile[]> {
  const files: MediaFile[] = []
  // excluídos que o Windows ainda não terminou de apagar não entram
  const pending = await Promise.all(all.map(deletePending))
  const paths = all.filter((_, i) => !pending[i])
  for (let i = 0; i < paths.length; i += 24) {
    files.push(...await Promise.all(paths.slice(i, i + 24).map(async (full) => {
      const [st, meta] = await Promise.all([stat(full).catch(() => null), readMeta(full).catch(() => null)])
      return {
        name: basename(full),
        path: full,
        size: st?.size ?? 0,
        mtime: st?.mtimeMs ?? 0,
        title: meta?.title ?? null,
        artist: meta?.artist ?? null,
        album: meta?.album ?? null,
        duration: meta?.duration ?? null,
        bitrate: meta?.bitrate ?? null,
        hasCover: meta?.hasCover ?? false,
      }
    })))
  }
  return files
}
