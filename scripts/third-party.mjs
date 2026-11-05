// Gera THIRD-PARTY-NOTICES.md: tudo de terceiros que vai dentro do instalador, com a licença de cada um.
//   npm run notices   (rode depois de "nuxt build", antes de "npm run dist" — o "dist" já faz isso)
//
// Fontes: os pacotes que o servidor compilado realmente usa (.output/server/node_modules), os que vão
// na interface (Vue, fonte Figtree), o Electron, o ffmpeg e o yt-dlp.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const nm = join(root, 'node_modules')
const out = []
const seen = new Set()

function licenseText(dir) {
  const f = existsSync(dir) ? readdirSync(dir).find(n => /^(licen[sc]e|copying)(\.|$)/i.test(n)) : null
  return f ? readFileSync(join(dir, f), 'utf8').trim() : null
}
function add(dir, extra = {}) {
  const pj = join(dir, 'package.json')
  if (!existsSync(pj)) return
  const p = JSON.parse(readFileSync(pj, 'utf8'))
  if (!p.name || seen.has(p.name)) return
  seen.add(p.name)
  const repo = typeof p.repository === 'string' ? p.repository : p.repository?.url
  out.push({ name: p.name, version: p.version, license: p.license || p.licenses?.[0]?.type || 'veja o texto', repo: repo?.replace(/^git\+/, '').replace(/\.git$/, ''), text: licenseText(dir) ?? licenseText(join(nm, p.name)), ...extra })
}
function walk(base) {
  if (!existsSync(base)) return
  for (const n of readdirSync(base)) {
    if (n.startsWith('.')) continue
    if (n.startsWith('@')) for (const m of readdirSync(join(base, n))) add(join(base, n, m))
    else add(join(base, n))
  }
}

walk(join(root, '.output', 'server', 'node_modules'))
for (const p of ['vue', '@vue/runtime-dom', '@vue/runtime-core', '@vue/reactivity', '@vue/shared', 'vue-router', 'nuxt', '@fontsource-variable/figtree', 'electron']) add(join(nm, p))

const ffmpegReadme = readFileSync(join(nm, 'ffmpeg-static', 'ffmpeg.exe.README'), 'utf8')
const ffmpegVer = /Version:\s*(\S+)/.exec(ffmpegReadme)?.[1] ?? '?'
const ffmpegSrc = /Source Code:\s*(\S+)/.exec(ffmpegReadme)?.[1] ?? 'https://github.com/FFmpeg/FFmpeg'
const ytdlpLicense = 'This is free and unencumbered software released into the public domain (The Unlicense). https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE'

out.sort((a, b) => a.name.localeCompare(b.name))
const lines = [
  '# Avisos de terceiros / Third-party notices',
  '',
  'O TuneGrab é distribuído sob a licença **GPL-3.0-or-later** (arquivo `LICENSE`).',
  'O instalador inclui os programas e bibliotecas abaixo, cada um com a sua licença.',
  '',
  'TuneGrab is distributed under **GPL-3.0-or-later** (see `LICENSE`). The installer bundles the',
  'software below, each under its own license.',
  '',
  '## Programas incluídos / Bundled programs',
  '',
  `### FFmpeg ${ffmpegVer}`,
  '',
  '- Licença / License: **GPL-3.0** (texto completo em `LICENSE`, a mesma do TuneGrab)',
  `- Código-fonte desta versão / Source code of this build: ${ffmpegSrc}`,
  '- Compilação / Build: https://www.gyan.dev/ffmpeg/builds/ (via https://github.com/eugeneware/ffmpeg-static)',
  '- Copyright (c) 2000-2023 the FFmpeg developers — https://ffmpeg.org',
  '',
  '### yt-dlp',
  '',
  `- Licença / License: **Unlicense** (domínio público). ${ytdlpLicense}`,
  '- https://github.com/yt-dlp/yt-dlp',
  '',
  '### Electron / Chromium',
  '',
  '- Electron: MIT — https://github.com/electron/electron',
  '- Chromium e componentes: veja `LICENSES.chromium.html` na pasta de instalação do TuneGrab.',
  '',
  '## Bibliotecas / Libraries',
  '',
  '| Pacote | Versão | Licença |',
  '|---|---|---|',
  ...out.map(p => `| ${p.repo ? `[${p.name}](${p.repo.replace(/^git:\/\//, 'https://')})` : p.name} | ${p.version} | ${p.license} |`),
  '',
  '## Textos das licenças / License texts',
  '',
  ...out.filter(p => p.text).flatMap(p => [`### ${p.name} ${p.version}`, '', '```', p.text, '```', '']),
]
writeFileSync(join(root, 'THIRD-PARTY-NOTICES.md'), lines.join('\n'))
console.log(`THIRD-PARTY-NOTICES.md: ${out.length} pacotes (${out.filter(p => !p.text).length} sem arquivo de licença próprio)`)
