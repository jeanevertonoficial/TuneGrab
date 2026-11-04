import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { assertWritable } from '../../utils/drives'
import { safeName } from '../../utils/names'
import { bumpFs } from '../../utils/store'

export default defineEventHandler(async (event) => {
  const { path, name } = await readBody<{ path: string, name: string }>(event)
  const parent = await assertWritable(path)
  const target = join(parent, safeName(name))
  await mkdir(target, { recursive: true })
  bumpFs()
  return { path: target }
})
