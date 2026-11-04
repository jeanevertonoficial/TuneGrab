import { saveCookieFile, setSettings, type CookieSource } from '../../utils/settings'

const SOURCES: CookieSource[] = ['none', 'chrome', 'edge', 'brave', 'opera', 'firefox', 'file']

export default defineEventHandler(async (event) => {
  const body = await readBody<{ cookies?: CookieSource, cookieText?: string, embedLyrics?: boolean }>(event)
  if (typeof body.embedLyrics === 'boolean') setSettings({ embedLyrics: body.embedLyrics })
  if (body.cookies && !SOURCES.includes(body.cookies)) throw createError({ statusCode: 400, statusMessage: 'Opção inválida' })
  if (body.cookieText !== undefined) {
    // formato Netscape (exportado por extensões como "Get cookies.txt LOCALLY")
    if (!/youtube\.com/.test(body.cookieText)) throw createError({ statusCode: 400, statusMessage: 'Esse arquivo não tem cookies do YouTube' })
    saveCookieFile(body.cookieText)
  }
  if (body.cookies) setSettings({ cookies: body.cookies })
  return { ok: true }
})
