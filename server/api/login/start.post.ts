import { startLogin } from '../../utils/ytlogin'

/** Abre a janela de login do YouTube (Chrome/Edge com um perfil só do app). */
export default defineEventHandler(async () => {
  try {
    return await startLogin()
  }
  catch (e: any) {
    throw createError({ statusCode: 500, statusMessage: e.message })
  }
})
