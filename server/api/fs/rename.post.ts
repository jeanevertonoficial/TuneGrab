import { existsSync } from 'node:fs'
import { rename } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { assertWritable, listLocations } from '../../utils/drives'
import { safeName } from '../../utils/names'
import { bumpFs } from '../../utils/store'
import { busyMessage, followMove } from '../../utils/moved'

export default defineEventHandler(async (event) => {
  const { path, name } = await readBody<{ path: string, name: string }>(event)
  const from = await assertWritable(path)
  if ((await listLocations()).some(l => l.path.toLowerCase() === from.toLowerCase()))
    throw createError({ statusCode: 400, statusMessage: 'Não é possível renomear uma unidade' })
  let newName = safeName(name)
  // mantém a extensão se a pessoa digitou só o nome
  const ext = extname(from)
  if (ext && !newName.toLowerCase().endsWith(ext.toLowerCase()) && !extname(newName)) newName += ext
  const to = join(dirname(from), newName)
  if (existsSync(to) && to.toLowerCase() !== from.toLowerCase())
    throw createError({ statusCode: 409, statusMessage: 'Já existe um item com esse nome' })
  await rename(from, to).catch((e) => {
    throw busyMessage(e) ? createError({ statusCode: 409, statusMessage: busyMessage(e)! }) : e
  })
  followMove(from, to)
  bumpFs()
  return { path: to }
})
