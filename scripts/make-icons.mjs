// Gera todas as variações da logo a partir do símbolo oficial (brand/symbol.svg):
//   public/logo.svg            símbolo sem fundo (barra lateral do app)
//   public/favicon.svg         ícone da aba do navegador
//   public/icons/icon.svg      ícone do app (fundo preto, cantos arredondados)
//   public/icons/maskable.svg  Android (fundo inteiro; o aparelho recorta em círculo/gota)
//   public/icons/*.png         192, 512, maskable 512, iPhone 180, favicon 32
//   public/logo-wordmark.png   símbolo + nome, recortado da arte original (brand/logo-original.webp)
// Rodar depois de mudar o símbolo: npm run icons (usa o Chrome/Edge instalado para gerar os PNG).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const pub = resolve('public')
mkdirSync(join(pub, 'icons'), { recursive: true })

// desenho do símbolo (sem a tag <svg> e sem comentários); área útil: x 24–296, y 29–375 (centro 160, 202)
const symbol = readFileSync(resolve('brand/symbol.svg'), 'utf8')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^[\s\S]*?<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .trim()
const CX = 160
const CY = 202
const BLACK = '#000000'
const GREEN = '#0AED7C'

/** símbolo centralizado num quadrado de 512, com a altura indicada */
const placed = (height) => {
  const s = height / 346
  return `<g transform="translate(256 256) scale(${s.toFixed(4)}) translate(${-CX} ${-CY})">${symbol}</g>`
}
const svg = (viewBox, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>\n`

const files = {
  'logo.svg': svg('14 19 292 366', symbol),
  'icons/icon.svg': svg('0 0 512 512', `<rect width="512" height="512" rx="112" fill="${BLACK}"/>${placed(372)}`),
  'favicon.svg': svg('0 0 512 512', `<rect width="512" height="512" rx="112" fill="${BLACK}"/>${placed(400)}`),
  'icons/maskable.svg': svg('0 0 512 512', `<rect width="512" height="512" fill="${BLACK}"/>${placed(270)}`),
  'icons/apple.svg': svg('0 0 512 512', `<rect width="512" height="512" fill="${BLACK}"/>${placed(330)}`),
}
for (const [name, content] of Object.entries(files)) {
  writeFileSync(join(pub, name), content)
  console.log('ok', name)
}

const browsers = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]
const browser = browsers.find(existsSync)
if (!browser) throw new Error('Precisa do Chrome ou do Edge instalado para gerar os ícones PNG')

const pngs = [
  // [svg, tamanho, saída]
  ['icons/icon.svg', 192, 'icons/icon-192.png'],
  ['icons/icon.svg', 512, 'icons/icon-512.png'],
  ['icons/maskable.svg', 512, 'icons/maskable-512.png'],
  ['icons/apple.svg', 180, 'icons/apple-touch-icon.png'], // iPhone arredonda sozinho
  ['favicon.svg', 32, 'icons/favicon-32.png'],
]

// logo com nome: recorte da arte original (a fonte dela não existe no computador, então não dá para redesenhar igual)
const WORDMARK = { src: resolve('brand/logo-original.webp'), x: 150, y: 296, w: 1290, h: 400 }

const work = mkdtempSync(join(tmpdir(), 'tunegrab-icons-'))
try {
  for (const [src, size, out] of pngs) {
    const page = join(work, 'r.html')
    writeFileSync(page, `<!doctype html><style>html,body{margin:0;background:transparent}img{display:block;width:${size}px;height:${size}px}</style><img src="${pathToFileURL(join(pub, src))}">`)
    execFileSync(browser, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--default-background-color=00000000',
      '--force-device-scale-factor=1', `--window-size=${size},${size}`, '--virtual-time-budget=2000',
      `--user-data-dir=${join(work, 'profile')}`, `--screenshot=${join(pub, out)}`, pathToFileURL(page).href,
    ], { stdio: 'ignore' })
    console.log('ok', out)
  }
  const page = join(work, 'w.html')
  writeFileSync(page, `<!doctype html><style>html,body{margin:0;overflow:hidden;background:#000}div{width:${WORDMARK.w}px;height:${WORDMARK.h}px;overflow:hidden;position:relative}img{position:absolute;left:${-WORDMARK.x}px;top:${-WORDMARK.y}px}</style><div><img src="${pathToFileURL(WORDMARK.src)}"></div>`)
  execFileSync(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', `--window-size=${WORDMARK.w},${WORDMARK.h}`, '--virtual-time-budget=2000', `--user-data-dir=${join(work, 'profile')}`, `--screenshot=${join(pub, 'logo-wordmark.png')}`, pathToFileURL(page).href], { stdio: 'ignore' })
  console.log('ok', 'logo-wordmark.png')
}
finally {
  rmSync(work, { recursive: true, force: true })
}
