import { execFile } from 'node:child_process'
import { existsSync, readdirSync, statfsSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { jsonStore } from './store'

export interface Location {
  id: string
  name: string
  path: string
  kind: 'removable' | 'disk' | 'network' | 'folder'
  size: number | null
  free: number | null
}

const home = homedir()

// pastas do usuário que sempre aparecem como atalho
function userFolders(): Location[] {
  const candidates: [string, string][] = [
    ['Músicas', join(home, 'Music')],
    ['Downloads', join(home, 'Downloads')],
    ['Área de Trabalho', join(home, 'Desktop')],
    ['Documentos', join(home, 'Documents')],
  ]
  return candidates
    .filter(([, p]) => existsSync(p))
    .map(([name, p]) => ({ id: `folder:${p}`, name, path: p, kind: 'folder', ...space(p) }))
}

function space(path: string) {
  try {
    const s = statfsSync(path)
    return { size: s.blocks * s.bsize, free: s.bavail * s.bsize }
  }
  catch {
    return { size: null, free: null }
  }
}

// Também lista volumes USB sem letra de unidade (ex.: pendrive gravado como instalador de Linux):
// eles são acessados pelo caminho do volume, \\?\Volume{guid}\
const PS_SCRIPT = `
$usb = @{}
$noLetter = @()
try {
  Get-Partition -ErrorAction Stop | ForEach-Object {
    $d = Get-Disk -Number $_.DiskNumber -ErrorAction SilentlyContinue
    if (-not ($d -and @('USB','SD','MMC') -contains [string]$d.BusType)) { return }
    if ($_.DriveLetter) { $usb[[string]$_.DriveLetter + ':'] = $true; return }
    $v = $_ | Get-Volume -ErrorAction SilentlyContinue
    if ($v -and $v.FileSystem -and $v.UniqueId) {
      $noLetter += [pscustomobject]@{ id = $v.UniqueId; label = $v.FileSystemLabel; type = 2; usb = $true; size = $v.Size; free = $v.SizeRemaining; noLetter = $true }
    }
  }
} catch {}
$letters = Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -in 2,3,4 } | ForEach-Object {
  [pscustomobject]@{ id = $_.DeviceID; label = $_.VolumeName; type = $_.DriveType; usb = [bool]$usb[$_.DeviceID]; size = $_.Size; free = $_.FreeSpace; noLetter = $false }
}
ConvertTo-Json -Compress -InputObject @(@($letters) + @($noLetter))
`

// última lista boa: com o PC ocupado (vários downloads + conversões) o PowerShell pode demorar
// ou falhar; nesse caso o pendrive NÃO pode "sumir" (o download iria para o navegador)
// salva em disco: logo depois de reiniciar o servidor já existe uma lista para usar
const savedDrives = jsonStore<Location[]>('drives', [])
let lastGood: Location[] = savedDrives.get()
let running: Promise<Location[]> | null = null

function windowsDrives(): Promise<Location[]> {
  // não dispara consultas em paralelo: quem chegar no meio espera a mesma resposta
  running ??= queryWindowsDrives().finally(() => (running = null))
  return running
}

function queryWindowsDrives(): Promise<Location[]> {
  return new Promise((done) => {
    const fallback = () => done(lastGood.filter(l => existsSync(l.path)))
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT], { windowsHide: true, timeout: 45000 }, (err, stdout) => {
      if (err || !stdout.trim()) return fallback()
      let rows
      try {
        rows = JSON.parse(stdout)
      }
      catch {
        return fallback()
      }
      if (!Array.isArray(rows)) rows = [rows]
      const list: Location[] = rows
        .filter((r: any) => r.type === 4 || (r.size && r.size > 1024 ** 3)) // esconde partições de sistema minúsculas
        .map((r: any): Location => {
          const kind = r.type === 4 ? 'network' : r.type === 2 || r.usb ? 'removable' : 'disk'
          const fallback = { removable: 'Pendrive', network: 'Unidade de rede', disk: 'Disco local' }[kind]
          return {
            id: `drive:${r.id}`,
            name: r.noLetter ? `${r.label || fallback} (USB)` : `${r.label || fallback} (${r.id})`,
            path: r.noLetter ? normalizeVolume(r.id) : `${r.id}\\`,
            kind,
            size: Number(r.size) || null,
            free: Number(r.free) || null,
          }
        })
      // resposta sem nenhum disco é suspeita (sempre existe o C:): mantém a anterior
      if (!list.some(l => l.kind === 'disk') && lastGood.length) return fallback()
      if (JSON.stringify(list.map(l => l.id)) !== JSON.stringify(lastGood.map(l => l.id))) savedDrives.set(list)
      lastGood = list
      done(list)
    })
  })
}

function unixDrives(): Location[] {
  const user = userInfo().username
  const bases = process.platform === 'darwin' ? ['/Volumes'] : [`/media/${user}`, `/run/media/${user}`, '/media']
  const out: Location[] = []
  for (const base of bases) {
    if (!existsSync(base)) continue
    for (const name of readdirSync(base)) {
      const p = join(base, name)
      if (process.platform === 'darwin' && name === 'Macintosh HD') continue
      if (out.some(o => o.path === p)) continue
      out.push({ id: `drive:${p}`, name, path: p, kind: 'removable', ...space(p) })
    }
  }
  return out
}

let cache: { at: number, value: Location[] } | null = null
let refreshing: Promise<Location[]> | null = null

/**
 * Unidades e pastas. A consulta ao Windows leva 1–3 s, então quem pede recebe a última lista
 * na hora e ela é atualizada em segundo plano (antes abrir cada pasta esperava o PowerShell).
 */
export async function listLocations(): Promise<Location[]> {
  if (cache && Date.now() - cache.at < 3000) return cache.value
  refreshing ??= buildLocations().finally(() => (refreshing = null))
  if (cache && Date.now() - cache.at < 60000) return cache.value
  return refreshing
}

async function buildLocations(): Promise<Location[]> {
  const drives = process.platform === 'win32' ? await windowsDrives() : unixDrives()
  const value = [
    ...drives.filter(d => d.kind === 'removable'),
    ...userFolders(),
    ...drives.filter(d => d.kind === 'network'),
    ...drives.filter(d => d.kind === 'disk'),
  ]
  cache = { at: Date.now(), value }
  return value
}

/** \\?\Volume{guid} precisa da barra final para ser a raiz do volume */
export function normalizeVolume(p: string) {
  return /^\\\\\?\\Volume\{[^}]+\}$/i.test(p) ? `${p}\\` : p
}

/** resolve() do Node, corrigindo raízes no Windows ("C:" e volumes sem letra) */
function resolvePath(p: string) {
  if (/^[a-z]:$/i.test(p)) return `${p}\\` // "C:" sozinho seria a pasta atual
  return normalizeVolume(resolve(p))
}

const norm = (p: string) => {
  const r = resolvePath(p)
  return process.platform === 'win32' ? r.toLowerCase() : r
}

const PROTECTED = ['windows', 'program files', 'program files (x86)', 'programdata', '$recycle.bin', 'system volume information']

/** Como assertAllowed, mas recusa pastas do sistema (para mover, renomear, excluir e editar). */
export async function assertWritable(path: string): Promise<string> {
  const full = await assertAllowed(path)
  const parts = full.split(/[\\/]+/).map(p => p.toLowerCase())
  if (parts.some(p => PROTECTED.includes(p)) || parts.includes('appdata'))
    throw createError({ statusCode: 403, statusMessage: 'Pasta do sistema: alterações bloqueadas por segurança' })
  return full
}

/** O caminho é a raiz de uma unidade (C:\, pendrive…)? Pastas do usuário não contam. */
export async function isLocationRoot(path: string) {
  const n = norm(path)
  return (await listLocations()).some(l => l.kind !== 'folder' && norm(l.path) === n)
}

/** Garante que o caminho está dentro de uma das localizações conhecidas. */
export async function assertAllowed(path: string): Promise<string> {
  if (!path) throw createError({ statusCode: 400, statusMessage: 'Caminho não informado' })
  const full = resolvePath(path)
  const n = norm(full)
  const roots = await listLocations()
  const ok = roots.some((r) => {
    const root = norm(r.path)
    return n === root || n.startsWith(root.endsWith(sep) ? root : root + sep)
  })
  if (!ok) throw createError({ statusCode: 403, statusMessage: 'Pasta fora das unidades permitidas' })
  return full
}
