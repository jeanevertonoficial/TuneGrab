import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { cookieFile, getSettings, saveCookieFile, setSettings, type YoutubeAccount } from './settings'
import { dataDir } from './paths'
import { clearInfoCache } from './ytdlp'

/**
 * Login guiado do YouTube.
 *
 * O app abre o Chrome (ou Edge) numa janela própria, com um perfil só do TuneGrab (.data/yt-profile).
 * A pessoa entra na conta dela; o app lê a sessão DESSA janela (pela porta de depuração que ele mesmo abriu)
 * e grava no cookies.txt que o yt-dlp usa. O Chrome do dia a dia não é tocado.
 */

const profileDir = join(dataDir, 'yt-profile')
const LOGIN_URL = 'https://accounts.google.com/ServiceLogin?service=youtube&hl=pt-BR&continue=https%3A%2F%2Fwww.youtube.com%2F'

let win: { proc: ChildProcess, name: string } | null = null
let finishing: Promise<LoginStatus> | null = null

export interface LoginStatus {
  state: 'none' | 'waiting' | 'connected'
  account: YoutubeAccount | null
  /** navegador usado na janela de login */
  browser: string | null
  error?: string
  /** janela fechada: lendo a sessão */
  reading?: boolean
}

function findBrowser(): { exe: string, name: string } | null {
  const pf = process.env.ProgramFiles ?? 'C:\\Program Files'
  const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  const local = process.env.LOCALAPPDATA ?? ''
  const list: [string, string][] = [
    [join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'), 'Chrome'],
    [join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'), 'Chrome'],
    [join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'), 'Chrome'],
    [join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), 'Edge'],
    [join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), 'Edge'],
  ]
  const hit = list.find(([p]) => existsSync(p))
  return hit ? { exe: hit[0], name: hit[1] } : null
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number }
      s.close(() => resolve(port))
    })
  })
}

/** debug = abre com a porta de depuração (só no modo escondido, para ler a sessão) */
async function launch(args: string[], debug: boolean) {
  const b = findBrowser()
  if (!b) throw new Error('Não encontrei o Google Chrome nem o Microsoft Edge neste computador.')
  const port = debug ? await freePort() : 0
  const proc = spawn(b.exe, [
    `--user-data-dir=${profileDir}`,
    ...(debug ? [`--remote-debugging-port=${port}`, '--remote-allow-origins=http://127.0.0.1'] : []),
    '--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-background-mode',
    ...args,
  ], { stdio: 'ignore', windowsHide: false })
  return { proc, port, name: b.name }
}

/** Uma chamada ao navegador pela porta de depuração (só desta janela do app). */
async function cdp<T = any>(port: number, method: string, params: object = {}): Promise<T> {
  const info = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(3000) }).then(r => r.json()) as { webSocketDebuggerUrl: string }
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(info.webSocketDebuggerUrl)
    const timer = setTimeout(() => {
      ws.close()
      reject(new Error('O navegador não respondeu'))
    }, 5000)
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method, params }))
    ws.onerror = () => {
      clearTimeout(timer)
      reject(new Error('Não consegui falar com a janela de login'))
    }
    ws.onmessage = (m) => {
      const msg = JSON.parse(String(m.data))
      if (msg.id !== 1) return
      clearTimeout(timer)
      ws.close()
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
    }
  })
}

interface Cookie { name: string, value: string, domain: string, path: string, expires: number, secure: boolean, session: boolean }

const isYoutube = (c: Cookie) => /(^|\.)youtube\.com$/.test(c.domain)
const isGoogle = (c: Cookie) => /(^|\.)google\.com$/.test(c.domain)
/** entrou na conta e a sessão já chegou ao YouTube */
const loggedIn = (all: Cookie[]) => all.some(c => isYoutube(c) && (c.name === 'SAPISID' || c.name === '__Secure-3PAPISID'))
  && all.some(c => isYoutube(c) && c.name === 'LOGIN_INFO')

async function readCookies(port: number) {
  const r = await cdp<{ cookies: Cookie[] }>(port, 'Storage.getCookies')
  return r.cookies.filter(c => isYoutube(c) || isGoogle(c))
}

/** formato Netscape (o que o yt-dlp lê com --cookies) */
function toNetscape(list: Cookie[]) {
  const lines = ['# Netscape HTTP Cookie File', '# Gerado pelo TuneGrab (login guiado do YouTube)', '']
  for (const c of list) {
    const domain = c.domain
    lines.push([
      domain, domain.startsWith('.') ? 'TRUE' : 'FALSE', c.path || '/', c.secure ? 'TRUE' : 'FALSE',
      c.session || !c.expires || c.expires < 0 ? '0' : String(Math.floor(c.expires)), c.name, c.value,
    ].join('\t'))
  }
  return `${lines.join('\n')}\n`
}

/** Nome, @ e foto da conta (o mesmo pedido que o site do YouTube faz para montar o menu da conta). */
async function fetchAccount(list: Cookie[]): Promise<YoutubeAccount | null> {
  try {
    const yt = list.filter(isYoutube)
    const sapisid = yt.find(c => c.name === 'SAPISID')?.value ?? yt.find(c => c.name === '__Secure-3PAPISID')?.value
    if (!sapisid) return null
    const origin = 'https://www.youtube.com'
    const ts = Math.floor(Date.now() / 1000)
    const hash = createHash('sha1').update(`${ts} ${sapisid} ${origin}`).digest('hex')
    const res = await fetch('https://www.youtube.com/youtubei/v1/account/account_menu?prettyPrint=false', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `SAPISIDHASH ${ts}_${hash}`,
        'cookie': yt.map(c => `${c.name}=${c.value}`).join('; '),
        'origin': origin,
        'x-origin': origin,
      },
      body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: '2.20251101.00.00', hl: 'pt', gl: 'BR' } } }),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    const header = findKey(await res.json(), 'activeAccountHeaderRenderer')
    if (!header) return null
    const photos = header.accountPhoto?.thumbnails ?? []
    return {
      name: header.accountName?.simpleText ?? header.accountName?.runs?.[0]?.text ?? 'Conta do YouTube',
      handle: header.channelHandle?.simpleText ?? header.channelHandle?.runs?.[0]?.text ?? null,
      photo: photos.at(-1)?.url ?? null,
      at: Date.now(),
    }
  }
  catch {
    return null
  }
}

function findKey(obj: any, key: string): any {
  if (!obj || typeof obj !== 'object') return null
  if (key in obj) return obj[key]
  for (const v of Object.values(obj)) {
    const hit = findKey(v, key)
    if (hit) return hit
  }
  return null
}

function closeWindow() {
  const w = win
  win = null
  w?.proc.kill()
}

/** salva a sessão e liga o login nos downloads */
async function complete(list: Cookie[]): Promise<LoginStatus> {
  saveCookieFile(toNetscape(list))
  const account = await fetchAccount(list) ?? { name: 'Conta do YouTube', handle: null, photo: null, at: Date.now() }
  setSettings({ cookies: 'file', account })
  clearInfoCache() // listas privadas (curtidas, playlists) agora aparecem
  return { state: 'connected', account, browser: null }
}

/**
 * Lê a sessão do perfil do app: abre o mesmo perfil escondido (sem janela), com a porta de depuração,
 * espera o YouTube carregar e pega os cookies. A janela de login em si NUNCA abre com essa porta:
 * o Google recusa entrar (senha/chave de acesso) em navegador com depuração ligada.
 */
async function harvest(): Promise<Cookie[] | null> {
  const w = await launch(['--headless=new', 'https://www.youtube.com/'], true)
  try {
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 1000))
      const list = await readCookies(w.port).catch(() => null)
      if (list && loggedIn(list)) return list
    }
    return null
  }
  finally {
    await cdp(w.port, 'Browser.close').catch(() => w.proc.kill())
  }
}

/** recado para a tela depois que a janela fecha sem login (aparece uma vez) */
let lastError: string | null = null
let canceled = false

export async function startLogin(): Promise<LoginStatus> {
  if (win && win.proc.exitCode === null) return loginStatus()
  if (finishing) await finishing
  const w = await launch(['--new-window', LOGIN_URL], false)
  win = w
  canceled = false
  lastError = null
  // você entrou e fechou a janela: o app lê a sessão do perfil
  const startedAt = Date.now()
  w.proc.once('exit', () => {
    if (win === w) win = null
    if (canceled) return
    // saiu na hora: já havia uma janela desse perfil aberta (o Chrome reaproveitou ela)
    if (Date.now() - startedAt < 3000) {
      lastError = 'Já existe uma janela de login do TuneGrab aberta. Feche todas elas e clique em "Entrar no YouTube" de novo.'
      return
    }
    finishing = (async (): Promise<LoginStatus> => {
      await new Promise(r => setTimeout(r, 800)) // o Chrome termina de gravar o perfil
      const list = await harvest().catch(() => null)
      if (list) return complete(list)
      lastError = 'A janela foi fechada antes de entrar na conta. Clique em "Entrar no YouTube" e tente de novo.'
      return { state: 'none', account: null, browser: null, error: lastError }
    })().finally(() => (finishing = null))
  })
  return { state: 'waiting', account: null, browser: w.name }
}

/** Estado do login. Janela aberta = esperando você entrar e fechar; janela fechada = lendo a sessão. */
export async function loginStatus(): Promise<LoginStatus> {
  if (win) return { state: 'waiting', account: null, browser: win.name }
  if (finishing) return { state: 'waiting', account: null, browser: null, reading: true }
  const s = getSettings()
  const connected = s.cookies === 'file' && !!s.account && existsSync(cookieFile)
  const error = lastError ?? undefined
  lastError = null
  return { state: connected ? 'connected' : 'none', account: connected ? s.account! : null, browser: null, error }
}

export async function cancelLogin() {
  canceled = true
  closeWindow()
  return loginStatus()
}

export async function logout() {
  canceled = true
  closeWindow()
  rmSync(cookieFile, { force: true })
  setSettings({ cookies: 'none', account: undefined })
  clearInfoCache()
  // apaga a sessão guardada no perfil do app (dá para entrar com outra conta)
  await new Promise(r => setTimeout(r, 800))
  try {
    rmSync(profileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 })
  }
  catch { /* o navegador ainda está fechando; some na próxima vez */ }
  return loginStatus()
}

/**
 * Renova a sessão sem pedir login: abre o perfil do app escondido, deixa o YouTube atualizar
 * os cookies e grava de novo. Se a conta tiver saído (senha trocada etc.), devolve false.
 */
export async function renewLogin(): Promise<boolean> {
  if (win || finishing) return false
  const list = await harvest()
  if (!list) return false
  saveCookieFile(toNetscape(list))
  setSettings({ cookies: 'file', account: await fetchAccount(list) ?? getSettings().account })
  return true
}
