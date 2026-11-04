import { existsSync } from 'node:fs'
import { jsonStore } from './store'

/**
 * Índice "faixa + formato -> arquivo salvo". Serve para avisar que um link já foi baixado
 * e para baixar só o que falta. A chave da faixa é o id do vídeo (YouTube) ou "spotify:…", "deezer:…".
 */
const store = jsonStore<Record<string, { path: string, at: number }>>('downloaded', {})

const key = (trackId: string, format: string) => `${trackId}|${format}`

export function recordDownload(trackId: string, format: string, path: string) {
  store.set({ ...store.get(), [key(trackId, format)]: { path, at: Date.now() } })
}

/** Caminho do arquivo, se ainda existir no disco (pendrive desconectado conta como "não existe"). */
export function existingFile(trackId: string, format: string): string | null {
  const hit = store.get()[key(trackId, format)]
  return hit && existsSync(hit.path) ? hit.path : null
}

/** Esquece arquivos excluídos (ou tudo dentro de uma pasta excluída). */
export function forgetDownloads(paths: string[]) {
  const gone = paths.map(p => p.toLowerCase())
  const all = { ...store.get() }
  let changed = false
  for (const [k, v] of Object.entries(all)) {
    const p = v.path.toLowerCase()
    if (gone.some(g => p === g || p.startsWith(`${g}\\`) || p.startsWith(`${g}/`))) {
      delete all[k]
      changed = true
    }
  }
  if (changed) store.set(all)
}

/** Arquivo movido/renomeado pelo app: continua contando como "já baixado". */
export function renameDownloads(from: string, to: string) {
  const f = from.toLowerCase()
  const all = { ...store.get() }
  let changed = false
  for (const v of Object.values(all)) {
    const p = v.path.toLowerCase()
    if (p === f) v.path = to
    else if (p.startsWith(`${f}\\`) || p.startsWith(`${f}/`)) v.path = to + v.path.slice(from.length)
    else continue
    changed = true
  }
  if (changed) store.set(all)
}

/** Preenche o índice a partir do histórico (downloads feitos antes do índice existir). */
export function seedFromHistory(jobs: { format: string, items: { id: string, status: string, savedTo?: string }[] }[]) {
  const all = { ...store.get() }
  let changed = false
  for (const j of jobs) {
    for (const i of j.items) {
      if (i.status === 'done' && i.savedTo && !all[key(i.id, j.format)]) {
        all[key(i.id, j.format)] = { path: i.savedTo, at: Date.now() }
        changed = true
      }
    }
  }
  if (changed) store.set(all)
}
