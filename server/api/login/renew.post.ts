import { loginStatus, renewLogin } from '../../utils/ytlogin'

/** Renova a sessão sem pedir a senha de novo (se a conta ainda estiver conectada na janela do app). */
export default defineEventHandler(async () => {
  const ok = await renewLogin().catch(() => false)
  return { ok, ...(await loginStatus()) }
})
