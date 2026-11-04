// Baixa o yt-dlp oficial (GitHub releases) para ./bin
// No Windows usa a versão "em pasta" (yt-dlp_win.zip): inicia em ~0,7 s em vez de ~1,9 s,
// porque não precisa se descompactar a cada execução.
import { existsSync, mkdirSync, chmodSync, createWriteStream, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { execFileSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const binDir = join(root, 'bin')
const force = process.argv.includes('--force')
const isWin = process.platform === 'win32'

const assets = {
  win32: 'yt-dlp_win.zip',
  darwin: 'yt-dlp_macos',
  linux: process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux',
}
const asset = assets[process.platform]
if (!asset) {
  console.warn(`[setup] Plataforma ${process.platform} sem binário pronto. Instale o yt-dlp e defina YTDLP_PATH.`)
  process.exit(0)
}

const target = isWin ? join(binDir, 'yt-dlp', 'yt-dlp.exe') : join(binDir, 'yt-dlp')
if (existsSync(target) && !force) {
  console.log(`[setup] yt-dlp já existe em ${target}`)
  process.exit(0)
}

async function download(name, dest) {
  const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${name}`
  console.log(`[setup] Baixando ${url}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
}

try {
  mkdirSync(binDir, { recursive: true })
  if (isWin) {
    const zip = join(binDir, 'yt-dlp_win.zip')
    await download(asset, zip)
    rmSync(join(binDir, 'yt-dlp'), { recursive: true, force: true })
    execFileSync('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${join(binDir, 'yt-dlp')}' -Force`], { stdio: 'inherit' })
    rmSync(zip, { force: true })
  }
  else {
    await download(asset, target)
    chmodSync(target, 0o755)
  }
  console.log(`[setup] yt-dlp pronto em ${target}`)
}
catch (e) {
  console.error(`[setup] Falha ao baixar yt-dlp: ${e.message}`)
  process.exit(1)
}
