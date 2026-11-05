// Publica uma versão nova no GitHub para os programas instalados se atualizarem sozinhos.
//
//   1. aumente "version" no package.json (ex.: 1.0.1 -> 1.0.2)
//   2. npm run release            (gera o instalador e publica)
//      npm run release -- notas.md   (com um arquivo de novidades)
//
// Sobe dois arquivos na release "v<versão>": TuneGrab-Setup.exe (link fixo de download)
// e latest.yml (a conferência sha512 que o app usa antes de instalar).
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const appPkgPath = join(root, 'electron', 'package.json')
const appPkg = JSON.parse(readFileSync(appPkgPath, 'utf8'))
const version = pkg.version
const tag = `v${version}`

// o programa lê a versão do electron/package.json: mantém igual à do package.json
if (appPkg.version !== version) {
  appPkg.version = version
  writeFileSync(appPkgPath, `${JSON.stringify(appPkg, null, 2)}\n`)
  console.log(`electron/package.json -> ${version}`)
}

// npm precisa de shell no Windows; o gh não (e sem shell o texto das notas vai inteiro)
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', shell: cmd === 'npm' && process.platform === 'win32' })
const gh = args => execFileSync('gh', args, { cwd: root, encoding: 'utf8' })

let exists = false
try {
  gh(['release', 'view', tag, '--json', 'tagName'])
  exists = true
}
catch {}
if (exists) {
  console.error(`A release ${tag} já existe. Aumente "version" no package.json antes de publicar.`)
  process.exit(1)
}

if (!process.argv.includes('--no-build')) run('npm', ['run', 'dist'])

const exe = join(root, 'release', `TuneGrab-Setup-${version}.exe`)
const yml = join(root, 'release', 'latest.yml')
if (!existsSync(exe) || !existsSync(yml) || !readFileSync(yml, 'utf8').includes(`version: ${version}`)) {
  console.error('Instalador ou latest.yml desta versão não encontrados em release/.')
  process.exit(1)
}
const dir = mkdtempSync(join(tmpdir(), 'tunegrab-rel-'))
const fixed = join(dir, 'TuneGrab-Setup.exe')
copyFileSync(exe, fixed)

const notesArg = process.argv.slice(2).find(a => !a.startsWith('--'))
const notes = notesArg ? ['--notes-file', notesArg] : ['--notes', `TuneGrab ${version}. Baixe **TuneGrab-Setup.exe** abaixo — quem já tem o programa recebe o aviso "Atualizar agora".`]
run('gh', ['release', 'create', tag, fixed, yml, '--target', 'main', '--title', `TuneGrab ${version}`, ...notes])
console.log(`Publicado: ${tag}`)
