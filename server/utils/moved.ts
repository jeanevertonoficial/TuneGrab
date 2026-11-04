import { renameDownloads } from './downloaded'
import { renameJobPaths } from './jobs'
import { renamePath } from './me'

/** Depois de mover/renomear: favoritas, recentes, "já baixado" e histórico seguem o arquivo. */
export function followMove(from: string, to: string) {
  renamePath(from, to)
  renameDownloads(from, to)
  renameJobPaths(from, to)
}

/** Erro do Windows ao mexer num arquivo aberto, em português. */
export function busyMessage(e: any) {
  return e?.code === 'EBUSY' || e?.code === 'EPERM'
    ? 'O arquivo está aberto em outro programa (player, Explorer…). Feche e tente de novo.'
    : null
}
