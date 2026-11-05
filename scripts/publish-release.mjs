// Publica uma versão nova para os programas instalados se atualizarem sozinhos.
//
//   1. aumente "version" no package.json (ex.: 1.0.2 -> 1.0.3)
//   2. npm run release                 (envia a tag; o GitHub gera, assina e publica)
//      npm run release -- notas.md     (com um arquivo de novidades)
//      npm run release -- --local      (gera e publica daqui do PC, SEM assinatura — só se o GitHub Actions falhar)
//
// O padrão é o build no GitHub Actions (.github/workflows/instalador.yml): é verificável a partir do código,
// condição para a assinatura gratuita da SignPath Foundation. A release sai com TuneGrab-Setup.exe
// (link fixo de download) e latest.yml (conferência sha512 que o app usa antes de instalar).
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const appPkgPath = join(root, 'electron', 'package.json')
const appPkg = JSON.parse(readFileSync(appPkgPath, 'utf8'))
const version = pkg.version
const tag = `v${version}`
const local = process.argv.includes('--local')
const notesArg = process.argv.slice(2).find(a => !a.startsWith('--'))

// npm precisa de shell no Windows; git e gh não (e sem shell os textos vão inteiros)
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', shell: cmd === 'npm' && process.platform === 'win32' })
const out = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8' }).trim()

let exists = false
try {
  out('gh', ['release', 'view', tag, '--json', 'tagName'])
  exists = true
}
catch {}
if (exists) {
  console.error(`A release ${tag} já existe. Aumente "version" no package.json antes de publicar.`)
  process.exit(1)
}

// o programa lê a versão do electron/package.json: mantém igual à do package.json
if (appPkg.version !== version) {
  appPkg.version = version
  writeFileSync(appPkgPath, `${JSON.stringify(appPkg, null, 2)}\n`)
  console.log(`electron/package.json -> ${version}`)
}

if (!local) {
  // novidades da versão: o GitHub Actions usa release-notes/v<versão>.md
  if (notesArg) {
    mkdirSync(join(root, 'release-notes'), { recursive: true })
    copyFileSync(notesArg, join(root, 'release-notes', `${tag}.md`))
  }
  run('git', ['add', 'package.json', 'electron/package.json', ...(notesArg ? [`release-notes/${tag}.md`] : [])])
  if (out('git', ['diff', '--cached', '--name-only'])) run('git', ['commit', '-m', `Versão ${version}`])
  if (out('git', ['status', '--porcelain', '--untracked-files=no'])) {
    console.error('Há mudanças não salvas (commit) no projeto. A tag precisa apontar para o código completo.')
    process.exit(1)
  }
  run('git', ['push', 'origin', 'HEAD'])
  run('git', ['tag', '-a', tag, '-m', `TuneGrab ${version}`])
  run('git', ['push', 'origin', tag])
  console.log(`Tag ${tag} enviada. Acompanhe em: https://github.com/jeanevertonoficial/TuneGrab/actions`)
  process.exit(0)
}

// ---- modo --local: gera e publica daqui (sem assinatura) ----
if (!process.argv.includes('--no-build')) run('npm', ['run', 'dist'])
const exe = join(root, 'release', `TuneGrab-Setup-${version}.exe`)
if (!existsSync(exe)) {
  console.error('Instalador desta versão não encontrado em release/.')
  process.exit(1)
}
const dir = mkdtempSync(join(tmpdir(), 'tunegrab-rel-'))
const fixed = join(dir, 'TuneGrab-Setup.exe')
copyFileSync(exe, fixed)
run('node', ['scripts/latest-yml.mjs', fixed, version])
const notes = notesArg ? ['--notes-file', notesArg] : ['--notes', `TuneGrab ${version}. Baixe **TuneGrab-Setup.exe** abaixo — quem já tem o programa recebe o aviso "Atualizar agora".`]
run('gh', ['release', 'create', tag, fixed, join(dir, 'latest.yml'), '--target', 'main', '--title', `TuneGrab ${version}`, ...notes])
console.log(`Publicado: ${tag}`)
