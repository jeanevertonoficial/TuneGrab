interface DialogState {
  kind: 'confirm' | 'prompt' | 'folder' | 'tags'
  title: string
  message?: string
  value?: string
  confirmLabel?: string
  danger?: boolean
  /** para 'folder': pasta inicial; para 'tags': arquivo */
  path?: string
  tags?: { title: string, artist: string, album: string }
  resolve: (v: any) => void
}

/** Diálogos baseados em Promise, renderizados uma vez pelo DialogHost. */
export function useDialog() {
  const dialog = useState<DialogState | null>('dialog', () => null)

  function open<T>(d: Omit<DialogState, 'resolve'>) {
    return new Promise<T>((resolve) => {
      dialog.value = { ...d, resolve }
    })
  }

  function close(value: unknown) {
    const d = dialog.value
    dialog.value = null
    d?.resolve(value)
  }

  return {
    dialog,
    close,
    confirm: (title: string, message?: string, opts: { confirmLabel?: string, danger?: boolean } = {}) =>
      open<boolean>({ kind: 'confirm', title, message, ...opts }),
    prompt: (title: string, value = '', confirmLabel = 'Salvar') =>
      open<string | null>({ kind: 'prompt', title, value, confirmLabel }),
    pickFolder: (title: string, path?: string, confirmLabel = 'Selecionar esta pasta') =>
      open<string | null>({ kind: 'folder', title, path, confirmLabel }),
    editTags: (path: string, tags: { title: string, artist: string, album: string }) =>
      open<{ title: string, artist: string, album: string } | null>({ kind: 'tags', title: 'Editar informações', path, tags }),
  }
}
