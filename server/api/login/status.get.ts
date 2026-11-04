import { loginStatus } from '../../utils/ytlogin'

/** Estado do login do YouTube. Com a janela de login aberta, termina sozinho quando a pessoa entra. */
export default defineEventHandler(() => loginStatus())
