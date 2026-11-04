import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import { extname } from 'node:path'
import { assertAllowed } from '../../utils/drives'
import { describe, findMedia, type MediaFile } from '../../utils/scan'

const CHUNK = 256 * 1024

/** Hash rápido: tamanho + começo + meio + fim do arquivo. Suficiente para achar cópias idênticas. */
async function quickHash(path: string, size: number) {
  const h = createHash('sha1').update(String(size))
  const fh = await open(path, 'r')
  try {
    const buf = Buffer.alloc(CHUNK)
    for (const pos of [0, Math.max(0, Math.floor(size / 2) - CHUNK / 2), Math.max(0, size - CHUNK)]) {
      const { bytesRead } = await fh.read(buf, 0, CHUNK, pos)
      h.update(buf.subarray(0, bytesRead))
    }
  }
  finally {
    await fh.close()
  }
  return h.digest('hex')
}

const VIDEO = /\.(mp4|webm)$/i
const kindOf = (f: MediaFile) => (VIDEO.test(f.name) ? 'video' : 'audio')

/** "01 - PSY - GANGNAM STYLE (Official Video) [HD].mp3" -> "gangnam style" */
function normalizeTitle(f: MediaFile) {
  let t = f.title || f.name.slice(0, f.name.length - extname(f.name).length)
  t = t.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  t = t.replace(/^\s*\d{1,3}\s*[-._)]\s*/, '') // número da faixa
  t = t.replace(/\(\s*\d+\s*\)\s*$/, '') // "(2)" de cópia
  // tira o que vem entre parênteses/colchetes com palavras de "versão de upload"
  t = t.replace(/[([][^)\]]*(official|oficial|video|clipe|clip|lyric|letra|audio|áudio|hd|4k|remaster|visualizer|mv|m\/v|m⧸v)[^)\]]*[)\]]/g, ' ')
  t = t.replace(/\b(official|oficial)\s+(music\s+)?(video|audio|clipe)\b/g, ' ')
  t = t.replace(/\bm[/⧸]v\b/g, ' ')
  // "artista - título": fica só com o título
  if (t.includes(' - ')) t = t.split(' - ').pop()!
  return t.replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

const plain = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\b(vevo|topic|official|oficial)\b/g, ' ').replace(/[^\p{L}\p{N}]+/gu, '')

/** Artista principal: das tags ou do nome "Artista - Música"; "TotoVEVO" e "Toto - Topic" viram "toto" */
function artistOf(f: MediaFile) {
  let a = f.artist || ''
  if (!a) {
    const name = f.name.slice(0, f.name.length - extname(f.name).length).replace(/^\s*\d{1,3}\s*[-._)]\s*/, '')
    if (name.includes(' - ')) a = name.split(' - ')[0]!
  }
  a = a.split(/,|;| feat\.? | ft\.? | & /i)[0]!.replace(/vevo$/i, '')
  return plain(a)
}

interface DupGroup {
  type: 'identical' | 'similar'
  kind: 'audio' | 'video'
  title: string
  files: MediaFile[]
}

export default defineEventHandler(async (event) => {
  const { roots } = await readBody<{ roots: string[] }>(event)
  if (!Array.isArray(roots) || !roots.length) throw createError({ statusCode: 400, statusMessage: 'Escolha onde procurar' })

  // junta os arquivos de todas as pastas, sem repetir caminhos (pastas podem se sobrepor)
  const paths = new Map<string, string>()
  let truncated = false
  for (const r of roots) {
    const root = await assertAllowed(r)
    const res = await findMedia(root)
    truncated ||= res.truncated
    for (const p of res.found) paths.set(p.toLowerCase(), p)
  }
  const files = await describe([...paths.values()])
  const groups: DupGroup[] = []
  const inIdentical = new Set<string>()

  // 1) idênticos: mesmo tamanho -> mesmo hash
  const bySize = new Map<number, MediaFile[]>()
  for (const f of files) if (f.size > 0) bySize.set(f.size, [...(bySize.get(f.size) ?? []), f])
  for (const same of bySize.values()) {
    if (same.length < 2) continue
    const byHash = new Map<string, MediaFile[]>()
    for (const f of same) {
      const h = await quickHash(f.path, f.size).catch(() => null)
      if (h) byHash.set(h, [...(byHash.get(h) ?? []), f])
    }
    for (const g of byHash.values()) {
      if (g.length < 2) continue
      g.forEach(f => inIdentical.add(f.path))
      groups.push({ type: 'identical', kind: kindOf(g[0]!), title: g[0]!.title || g[0]!.name, files: g })
    }
  }

  // 2) parecidos: mesmo título normalizado, mesmo artista (quando se sabe), mesmo tipo e duração próxima.
  // Sem o artista, "Hello" da Adele e "Hello" do Lionel Richie viravam "repetidas".
  const byKey = new Map<string, MediaFile[]>()
  for (const f of files) {
    const key = normalizeTitle(f)
    if (key.length < 2) continue
    const k = `${kindOf(f)}|${artistOf(f)}|${key}`
    byKey.set(k, [...(byKey.get(k) ?? []), f])
  }
  for (const [k, list] of byKey) {
    if (list.length < 2) continue
    const knownArtist = k.split('|')[1] !== ''
    // separa versões com duração muito diferente (ex.: ao vivo x estúdio).
    // Sem duração: só junta se o artista é conhecido (senão é chute demais)
    const clusters: MediaFile[][] = []
    for (const f of [...list].sort((a, b) => (a.duration ?? 0) - (b.duration ?? 0))) {
      const last = clusters.at(-1)
      const ref = last?.[0]
      const close = f.duration != null && ref?.duration != null
        ? Math.abs(f.duration - ref.duration) <= 4
        : knownArtist
      if (last && close) last.push(f)
      else clusters.push([f])
    }
    for (const c of clusters) {
      // grupo que já é inteiro de cópias idênticas não precisa aparecer de novo
      if (c.length < 2 || c.every(f => inIdentical.has(f.path))) continue
      groups.push({ type: 'similar', kind: k.startsWith('video') ? 'video' : 'audio', title: c[0]!.title || c[0]!.name, files: c })
    }
  }

  // junta grupos que têm arquivos em comum: cada arquivo aparece em um grupo só
  // (senão dava para "manter" um arquivo num grupo e apagá-lo pelo outro)
  const merged: DupGroup[] = []
  const owner = new Map<string, DupGroup>()
  for (const g of groups) {
    const hits = [...new Set(g.files.map(f => owner.get(f.path)).filter(Boolean))] as DupGroup[]
    const target = hits[0] ?? { ...g, files: [] }
    if (!hits.length) merged.push(target)
    for (const other of hits.slice(1)) {
      for (const f of other.files) if (!target.files.some(x => x.path === f.path)) target.files.push(f)
      merged.splice(merged.indexOf(other), 1)
    }
    for (const f of g.files) if (!target.files.some(x => x.path === f.path)) target.files.push(f)
    if (g.type === 'similar') target.type = 'similar' // se juntou idênticas com parecidas, o grupo é "parecidas"
    for (const f of target.files) owner.set(f.path, target)
  }

  // marca quais arquivos são cópias exatas de outro do mesmo grupo
  const identicalPaths = new Set(groups.filter(g => g.type === 'identical').flatMap(g => g.files.map(f => f.path)))
  const result = merged.map(g => ({
    ...g,
    files: g.files.map(f => ({ ...f, identical: identicalPaths.has(f.path) })),
  }))

  const wasted = result.reduce((a, g) => a + g.files.reduce((s, f) => s + f.size, 0) - Math.max(...g.files.map(f => f.size)), 0)
  return { scanned: files.length, truncated, wasted, groups: result }
})
