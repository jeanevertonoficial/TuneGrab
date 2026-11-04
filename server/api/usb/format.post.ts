import { cleanLabel, FAT32_MAX, formatDisk, listUsbDisks, type FileSystem } from '../../utils/usb'

interface Body { number: number, serial: string, size: number, fs: FileSystem, label: string, confirm: string }

let busy = false

export default defineEventHandler(async (event) => {
  if (process.platform !== 'win32') throw createError({ statusCode: 400, statusMessage: 'Formatação disponível só no Windows' })
  const body = await readBody<Body>(event)
  if (body.confirm !== 'FORMATAR') throw createError({ statusCode: 400, statusMessage: 'Digite FORMATAR para confirmar' })
  if (!['FAT32', 'exFAT', 'NTFS'].includes(body.fs)) throw createError({ statusCode: 400, statusMessage: 'Sistema de arquivos inválido' })

  // o disco precisa ser exatamente o que a tela mostrou (número + série + tamanho)
  const disk = (await listUsbDisks()).find(d => d.number === body.number && d.serial === body.serial && d.size === body.size)
  if (!disk) throw createError({ statusCode: 404, statusMessage: 'Pendrive não encontrado. Ele foi removido?' })
  if (disk.isBoot || disk.isSystem) throw createError({ statusCode: 403, statusMessage: 'Disco do sistema: formatação recusada' })
  if (body.fs === 'FAT32' && disk.size > FAT32_MAX) throw createError({ statusCode: 400, statusMessage: 'O Windows só formata em FAT32 até 32 GB. Use exFAT.' })

  if (busy) throw createError({ statusCode: 409, statusMessage: 'Já existe uma formatação em andamento' })
  busy = true
  try {
    const label = cleanLabel(body.label, body.fs)
    const r = await formatDisk(disk, body.fs, label)
    return { ok: true, label, letter: r.letter }
  }
  catch (e: any) {
    throw createError({ statusCode: 500, statusMessage: e.message })
  }
  finally {
    busy = false
  }
})
