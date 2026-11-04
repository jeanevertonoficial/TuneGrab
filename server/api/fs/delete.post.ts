import { access, rm } from 'node:fs/promises'
import { forgetDownloads } from '../../utils/downloaded'
import { assertWritable, listLocations } from '../../utils/drives'
import { forgetPaths } from '../../utils/me'
import { bumpFs } from '../../utils/store'

export default defineEventHandler(async (event) => {
  const { path } = await readBody<{ path: string }>(event)
  const target = await assertWritable(path)
  if ((await listLocations()).some(l => l.path.toLowerCase() === target.toLowerCase()))
    throw createError({ statusCode: 400, statusMessage: 'Não é possível excluir uma unidade' })

  try {
    // no Windows um arquivo "ocupado" por um instante (antivírus, indexação) libera logo: tenta de novo
    await rm(target, { recursive: true, maxRetries: 5, retryDelay: 300 })
  }
  catch (e: any) {
    if (e.code === 'ENOENT') { /* já não existia */ }
    else if (e.code === 'EBUSY' || e.code === 'EPERM')
      throw createError({ statusCode: 409, statusMessage: 'O arquivo está aberto em outro programa (player, Explorer…). Feche e tente de novo.' })
    else throw e
  }

  // excluído "pendente": o Windows só apaga de vez quando quem está com o arquivo aberto fechar
  const pending = await access(target).then(() => false, (e: any) => e.code === 'EPERM')

  forgetPaths([target])
  forgetDownloads([target])
  bumpFs()
  return { ok: true, pending }
})
