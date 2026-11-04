import { listUsbDisks } from '../../utils/usb'

export default defineEventHandler(async () => {
  try {
    return await listUsbDisks()
  }
  catch (e: any) {
    throw createError({ statusCode: 500, statusMessage: `Não foi possível listar os pendrives: ${e.message}` })
  }
})
