import { logout } from '../../utils/ytlogin'

/** Sai da conta: apaga a sessão salva e a da janela do app. */
export default defineEventHandler(() => logout())
