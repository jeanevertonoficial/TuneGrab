declare module 'archiver' {
  import type { Readable } from 'node:stream'
  export class ZipArchive extends Readable {
    constructor(options?: { store?: boolean, zlib?: { level?: number } })
    file(path: string, data: { name: string }): this
    finalize(): Promise<void>
  }
}
