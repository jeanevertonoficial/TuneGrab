// Gera o latest.yml (versão, tamanho e sha512) ao lado do instalador final.
// O app confere o sha512 antes de instalar uma atualização, por isso é calculado DEPOIS da assinatura.
//   node scripts/latest-yml.mjs out/TuneGrab-Setup.exe 1.2.3
import { createHash } from 'node:crypto'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

const [exe, version] = process.argv.slice(2)
if (!exe || !version) {
  console.error('uso: node scripts/latest-yml.mjs <instalador.exe> <versão>')
  process.exit(1)
}
const sha512 = createHash('sha512').update(readFileSync(exe)).digest('base64')
const size = statSync(exe).size
const name = basename(exe)
const yml = `version: ${version}
files:
  - url: ${name}
    sha512: ${sha512}
    size: ${size}
path: ${name}
sha512: ${sha512}
releaseDate: '${new Date().toISOString()}'
`
writeFileSync(join(dirname(exe), 'latest.yml'), yml)
console.log(`latest.yml: ${version}, ${size} bytes`)
