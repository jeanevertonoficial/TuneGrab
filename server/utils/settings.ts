import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { jsonStore } from './store'

export type CookieSource = 'none' | 'chrome' | 'edge' | 'brave' | 'opera' | 'firefox' | 'file'

export interface Settings {
  /**
   * Login do YouTube para o yt-dlp. Quando o YouTube bloqueia ("confirme que não é um robô"),
   * usar os cookies do navegador em que você está logado resolve. Fica só neste computador.
   */
  cookies: CookieSource
  /** navegador cujo login falhou e foi desligado automaticamente */
  lastCookieError?: string
  /** conta conectada pelo login guiado (mostrada na barra lateral) */
  account?: YoutubeAccount
  /** gravar a letra dentro das músicas baixadas (padrão: sim) */
  embedLyrics?: boolean
}

export interface YoutubeAccount {
  name: string
  handle: string | null
  photo: string | null
  at: number
}

/** os pedidos ao YouTube vão com um login (guiado, cookies.txt colado ou navegador) */
export const hasLogin = () => cookieArgs().length > 0

const store = jsonStore<Settings>('settings', { cookies: 'none' })
export const cookieFile = join(process.cwd(), '.data', 'state', 'cookies.txt')

export const getSettings = () => store.get()

export function setSettings(next: Partial<Settings>) {
  store.set({ ...store.get(), ...next, ...(next.cookies ? { lastCookieError: undefined } : {}) })
  store.flush()
}

export function saveCookieFile(text: string) {
  writeFileSync(cookieFile, text, 'utf8')
}

/** o login escolhido não pôde ser lido: volta para "Não usar" (e a tela avisa) */
export function disableCookies() {
  if (store.get().cookies === 'none') return
  store.set({ ...store.get(), cookies: 'none', lastCookieError: `${store.get().cookies}` })
  store.flush()
}

/** argumentos do yt-dlp para usar o login escolhido */
export function cookieArgs(): string[] {
  const c = store.get().cookies
  if (c === 'none') return []
  if (c === 'file') return existsSync(cookieFile) ? ['--cookies', cookieFile] : []
  return ['--cookies-from-browser', c]
}

export const isBotBlock = (msg: string) => /confirm you.{0,3}re not a bot|sign in to confirm/i.test(msg)

export const BOT_MESSAGE = 'O YouTube pediu para confirmar que não é um robô (muitos downloads seguidos deste computador). '
  + 'Ative "Usar login do navegador" em Configurações e clique em Retomar — ou espere algumas horas.'
