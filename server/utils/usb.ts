import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface UsbDisk {
  number: number
  name: string
  serial: string
  size: number
  bus: string
  isBoot: boolean
  isSystem: boolean
  style: string
  volumes: { letter: string, label: string, fs: string, path: string, size: number }[]
}

export type FileSystem = 'FAT32' | 'exFAT' | 'NTFS'

/** FAT32 pelo Windows só até 32 GB */
export const FAT32_MAX = 32 * 1024 ** 3

const LIST_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$out = @(Get-Disk | Where-Object { @('USB','SD','MMC') -contains [string]$_.BusType } | ForEach-Object {
  $d = $_
  $vols = @(Get-Partition -DiskNumber $d.Number | ForEach-Object {
    $v = $_ | Get-Volume
    if ($v) { [pscustomobject]@{ letter = [string]$_.DriveLetter; label = [string]$v.FileSystemLabel; fs = [string]$v.FileSystem; path = [string]$v.UniqueId; size = [int64]$v.Size } }
  })
  [pscustomobject]@{
    number = $d.Number; name = ([string]$d.FriendlyName).Trim(); serial = ([string]$d.SerialNumber).Trim(); size = [int64]$d.Size
    bus = [string]$d.BusType; isBoot = [bool]$d.IsBoot; isSystem = [bool]$d.IsSystem; style = [string]$d.PartitionStyle; volumes = $vols
  }
})
ConvertTo-Json -Compress -Depth 4 -InputObject $out
`

function ps(script: string, timeout = 20000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.trim() || err.message))
      else resolve(stdout)
    })
  })
}

export async function listUsbDisks(): Promise<UsbDisk[]> {
  if (process.platform !== 'win32') return []
  const out = (await ps(LIST_SCRIPT)).trim()
  const disks: UsbDisk[] = out ? JSON.parse(out) : []
  // sem letra, o PowerShell devolve o caractere nulo
  for (const d of disks) for (const v of d.volumes) v.letter = v.letter.replace(/\0/g, '').trim()
  return disks
}

// Roda como administrador. Confere tudo de novo antes de apagar, porque o disco pode ter mudado.
const FORMAT_SCRIPT = `
param([string]$Job)
$ErrorActionPreference = 'Stop'
$p = Get-Content -Raw -Encoding UTF8 $Job | ConvertFrom-Json
function Done($obj) { $obj | ConvertTo-Json -Compress | Set-Content -Encoding UTF8 -Path $p.out }
try {
  $d = Get-Disk -Number $p.number
  if (@('USB','SD','MMC') -notcontains [string]$d.BusType) { throw 'Este disco não é um pendrive/cartão USB.' }
  if ($d.IsBoot -or $d.IsSystem) { throw 'Este é um disco do sistema. Formatação recusada.' }
  if ((([string]$d.SerialNumber).Trim() -ne $p.serial) -or ([int64]$d.Size -ne [int64]$p.size)) { throw 'O pendrive conectado não é o mesmo que foi escolhido. Tente de novo.' }
  if ($d.IsOffline) { Set-Disk -Number $p.number -IsOffline $false }
  if ($d.IsReadOnly) { Set-Disk -Number $p.number -IsReadOnly $false }
  if ([string]$d.PartitionStyle -ne 'RAW') { Clear-Disk -Number $p.number -RemoveData -RemoveOEM -Confirm:$false }
  # MBR: o formato mais compatível (som de carro, TV, videogame)
  if ([string](Get-Disk -Number $p.number).PartitionStyle -eq 'RAW') { Initialize-Disk -Number $p.number -PartitionStyle MBR }
  $part = New-Partition -DiskNumber $p.number -UseMaximumSize -AssignDriveLetter
  Format-Volume -Partition $part -FileSystem $p.fs -NewFileSystemLabel $p.label -Confirm:$false -Force | Out-Null
  $part = Get-Partition -DiskNumber $p.number -PartitionNumber $part.PartitionNumber
  Done @{ ok = $true; letter = [string]$part.DriveLetter }
}
catch {
  Done @{ ok = $false; error = $_.Exception.Message }
}
`

/** Limpa o nome do volume conforme o sistema de arquivos (FAT32: 11 caracteres, maiúsculas). */
export function cleanLabel(label: string, fs: FileSystem) {
  const max = fs === 'FAT32' ? 11 : fs === 'exFAT' ? 15 : 32
  let l = String(label ?? '').replace(/[*?/\\|.,;:+=[\]<>"]/g, '').trim().slice(0, max)
  if (fs === 'FAT32') l = l.toUpperCase()
  return l || 'PENDRIVE'
}

/**
 * Formata o disco pedindo permissão de administrador ao Windows (janela do UAC).
 * Apaga tudo e cria uma única partição.
 */
export async function formatDisk(disk: UsbDisk, fs: FileSystem, label: string) {
  const dir = mkdtempSync(join(tmpdir(), 'tunegrab-format-'))
  const script = join(dir, 'format.ps1')
  const job = join(dir, 'job.json')
  const out = join(dir, 'result.json')
  try {
    // BOM para o PowerShell 5 ler os acentos das mensagens corretamente
    writeFileSync(script, `﻿${FORMAT_SCRIPT}`, 'utf8')
    writeFileSync(job, JSON.stringify({ number: disk.number, serial: disk.serial, size: disk.size, fs, label, out }), 'utf8')
    const q = (s: string) => `'${s.replace(/'/g, '\'\'')}'`
    const launcher = `Start-Process -FilePath powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',${q(`"${script}"`)},'-Job',${q(`"${job}"`)})`
    try {
      await ps(launcher, 10 * 60 * 1000)
    }
    catch (e: any) {
      if (/cancel/i.test(e.message)) throw new Error('Você não deu permissão no Windows. Nada foi alterado.')
      throw e
    }
    if (!existsSync(out)) throw new Error('A formatação não terminou (permissão negada ou janela fechada). Nada foi alterado.')
    const res = JSON.parse(readFileSync(out, 'utf8').replace(/^﻿/, ''))
    if (!res.ok) throw new Error(res.error || 'Falha ao formatar')
    return { letter: res.letter as string }
  }
  finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
