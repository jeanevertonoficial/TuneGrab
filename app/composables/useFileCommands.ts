import type { FsFile } from './useFiles'

/** Liga as ações dos menus (tocar, editar, mover…) aos diálogos e à API. */
export function useFileCommands(opts: { files: Ref<FsFile[]>, reload: () => Promise<void> | void }) {
  const { playList } = usePlayer()
  const { confirm, prompt, pickFolder, editTags } = useDialog()
  const fs = useFsActions()
  const filesPath = useState<string | null>('filesPath', () => null)
  const view = useState<string>('view')

  const dirOf = (p: string) => {
    const d = p.replace(/[\\/][^\\/]+$/, '')
    return /^[a-z]:$/i.test(d) ? `${d}\\` : d // "C:" sozinho seria a pasta atual, não a raiz
  }
  const label = (paths: string[]) => (paths.length === 1 ? `"${paths[0]!.split(/[\\/]/).pop()}"` : `${paths.length} itens`)

  function play(index: number) {
    playList(opts.files.value.map(fileToPlayItem), index)
  }

  async function transfer(paths: string[], copy: boolean) {
    const dest = await pickFolder(`${copy ? 'Copiar' : 'Mover'} ${label(paths)} para…`, dirOf(paths[0]!), copy ? 'Copiar aqui' : 'Mover aqui')
    if (!dest) return
    await fs.transfer(paths, dest, copy)
    await opts.reload()
  }

  async function remove(paths: string[]) {
    const ok = await confirm(`Excluir ${label(paths)}?`, 'Isso apaga do disco permanentemente. Não dá para desfazer.', { confirmLabel: 'Excluir', danger: true })
    if (!ok) return
    await fs.remove(paths)
    await opts.reload()
  }

  async function action(id: string, f: FsFile) {
    const i = opts.files.value.findIndex(x => x.path === f.path)
    switch (id) {
      case 'play': return play(i)
      case 'tags': {
        const tags = await editTags(f.path, { title: f.title ?? '', artist: f.artist ?? '', album: f.album ?? '' })
        if (tags && await fs.saveTags(f.path, tags)) await opts.reload()
        return
      }
      case 'rename': {
        const name = await prompt('Renomear arquivo', f.name, 'Renomear')
        if (name && name !== f.name && await fs.rename(f.path, name)) await opts.reload()
        return
      }
      case 'move': return transfer([f.path], false)
      case 'copy': return transfer([f.path], true)
      case 'open':
        filesPath.value = dirOf(f.path)
        view.value = 'files'
        return
      case 'delete': return remove([f.path])
    }
  }

  return { play, action, transfer, remove }
}
