import { readdir, stat } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { assertAllowed, listLocations } from '../../utils/drives'
import { cachedMeta, deletePending, isMedia, readMeta } from '../../utils/media'

/** quantas músicas sem cache são lidas antes de responder; o resto vem depois por /api/fs/meta */
const EAGER = 40

export default defineEventHandler(async (event) => {
  const path = await assertAllowed(String(getQuery(event).path || ''))
  const entries = await readdir(path, { withFileTypes: true }).catch((e) => {
    throw createError({ statusCode: 404, statusMessage: `Não foi possível abrir a pasta: ${e.code || e.message}` })
  })

  const folders = entries
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('$') && e.name !== 'System Volume Information')
    .map(e => ({ name: e.name, path: join(path, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }))

  const mediaEntries = entries
    .filter(e => e.isFile() && isMedia(e.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }))

  let budget = EAGER
  const files = []
  for (let i = 0; i < mediaEntries.length; i += 32) {
    files.push(...await Promise.all(mediaEntries.slice(i, i + 32).map(async (e) => {
      const full = join(path, e.name)
      if (await deletePending(full)) return null
      const st = await stat(full)
      const base = { name: e.name, path: full, size: st.size, mtime: st.mtimeMs }
      const cached = cachedMeta(full, st.mtimeMs, st.size)
      if (cached) return { ...base, ...cached }
      if (budget-- > 0) return { ...base, ...await readMeta(full) }
      // sem tags ainda: a tela mostra o nome e pede o resto em segundo plano
      return { ...base, title: null, artist: null, album: null, duration: null, bitrate: null, hasCover: false, pending: true }
    })).then(l => l.filter(f => f !== null)))
  }

  const locations = await listLocations()
  const norm = (p: string) => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p))
  const location = locations
    .filter(l => norm(path) === norm(l.path) || norm(path).startsWith(norm(l.path).replace(/[\\/]$/, '') + sep))
    .sort((a, b) => b.path.length - a.path.length)[0] ?? null
  const isRoot = !!location && norm(location.path) === norm(path)

  return { path, parent: isRoot ? null : dirname(path), location, folders, files }
})
