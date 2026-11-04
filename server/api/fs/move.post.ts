import { cp, rename, rm } from 'node:fs/promises'
import { basename, sep } from 'node:path'
import { assertWritable } from '../../utils/drives'
import { busyMessage, followMove } from '../../utils/moved'
import { freeName } from '../../utils/names'
import { bumpFs } from '../../utils/store'

export default defineEventHandler(async (event) => {
  const { paths, dest, copy } = await readBody<{ paths: string[], dest: string, copy?: boolean }>(event)
  if (!Array.isArray(paths) || !paths.length) throw createError({ statusCode: 400, statusMessage: 'Nada selecionado' })
  const destDir = await assertWritable(dest)

  const results: { from: string, to?: string, error?: string }[] = []
  for (const p of paths) {
    try {
      const from = await assertWritable(p)
      const lower = (s: string) => (process.platform === 'win32' ? s.toLowerCase() : s)
      if (lower(destDir) === lower(from) || lower(destDir).startsWith(lower(from) + sep))
        throw new Error('Não dá para mover uma pasta para dentro dela mesma')
      const to = freeName(destDir, basename(from))
      if (copy) {
        await cp(from, to, { recursive: true, errorOnExist: true })
      }
      else {
        try {
          await rename(from, to)
        }
        catch (e: any) {
          // entre unidades diferentes (ex.: PC -> pendrive) rename não funciona
          if (e.code !== 'EXDEV') throw e
          await cp(from, to, { recursive: true, errorOnExist: true })
          try {
            await rm(from, { recursive: true, maxRetries: 3, retryDelay: 300 })
          }
          catch (err) {
            // a cópia ficou pronta, mas o original não saiu: desfaz a cópia para não duplicar
            await rm(to, { recursive: true, force: true }).catch(() => {})
            throw err
          }
        }
      }
      if (!copy) followMove(from, to)
      results.push({ from, to })
    }
    catch (e: any) {
      results.push({ from: p, error: busyMessage(e) || e.statusMessage || e.message })
    }
  }
  bumpFs()
  return { results }
})
