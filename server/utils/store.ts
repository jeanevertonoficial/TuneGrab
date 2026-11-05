import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from './paths'

const dir = join(dataDir, 'state')

// ao fechar o app, grava na hora o que ainda estava esperando o atraso (senão perdia o último segundo)
const pending = new Set<() => void>()
let hooked = false
function hookExit() {
  if (hooked) return
  hooked = true
  process.once('exit', () => {
    for (const f of pending) f()
  })
}

/**
 * JSON salvo em .data/state/<nome>.json. Lê uma vez, grava com atraso (debounce)
 * e de forma atômica (arquivo temporário + rename), para não corromper se o app fechar no meio.
 */
export function jsonStore<T>(name: string, initial: T) {
  const file = join(dir, `${name}.json`)
  let data: T = initial
  try {
    if (existsSync(file)) data = JSON.parse(readFileSync(file, 'utf8'))
  }
  catch { /* arquivo corrompido: começa do zero */ }

  let timer: ReturnType<typeof setTimeout> | null = null
  function flush() {
    timer = null
    pending.delete(flush)
    try {
      mkdirSync(dir, { recursive: true })
      writeFileSync(`${file}.tmp`, JSON.stringify(data))
      renameSync(`${file}.tmp`, file)
    }
    catch (e) {
      console.error(`[store] não foi possível salvar ${name}:`, e)
    }
  }

  return {
    get: () => data,
    set(next: T) {
      data = next
      if (!timer) {
        timer = setTimeout(flush, 800)
        pending.add(flush)
        hookExit()
      }
    },
    /** grava já (ex.: ao encerrar) */
    flush() {
      if (timer) clearTimeout(timer)
      flush()
    },
  }
}

/** Contador que muda a cada alteração de arquivos; invalida caches de varredura. */
let fsVersion = 0
export const bumpFs = () => ++fsVersion
export const currentFsVersion = () => fsVersion
