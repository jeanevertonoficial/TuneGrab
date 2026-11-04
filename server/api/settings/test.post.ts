import { runYtdlp } from '../../utils/ytdlp'

/** Testa se o YouTube está liberando downloads com o login escolhido (não baixa nada). */
export default defineEventHandler(async () => {
  try {
    await runYtdlp(['--simulate', '--no-playlist', '-f', 'bestaudio/best', 'https://www.youtube.com/watch?v=jNQXAC9IVRw'])
    return { ok: true }
  }
  catch (e: any) {
    return { ok: false, error: e.message }
  }
})
