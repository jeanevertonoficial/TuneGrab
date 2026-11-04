export interface YoutubeAccount {
  name: string
  handle: string | null
  photo: string | null
  at: number
}

export interface LoginStatus {
  state: 'none' | 'waiting' | 'connected'
  account: YoutubeAccount | null
  browser: string | null
  /** a janela fechou e o app está lendo a sessão */
  reading?: boolean
  /** a janela fechou sem login (ou outro problema) */
  error?: string
}

/** Login guiado do YouTube: abre uma janela do Chrome/Edge do app, você entra e ele lê a sessão. */
export function useYoutubeLogin() {
  const status = useState<LoginStatus>('ytLogin', () => ({ state: 'none', account: null, browser: null }))
  const busy = useState('ytLoginBusy', () => false)
  const timer = useState<ReturnType<typeof setTimeout> | null>('ytLoginTimer', () => null)
  const { notify } = useToast()

  const connected = computed(() => status.value.state === 'connected')

  async function refresh() {
    const before = status.value.state
    try {
      status.value = await $fetch<LoginStatus>('/api/login/status')
    }
    catch {}
    if (before === 'waiting' && status.value.state === 'connected')
      notify(`Conectado como ${status.value.account?.name ?? 'sua conta'}. O YouTube não deve mais pedir "não sou um robô".`)
    if (status.value.error) notify(status.value.error, true)
    // janela aberta (ou lendo a sessão): confere a cada 1,5 s
    if (timer.value) clearTimeout(timer.value)
    if (status.value.state === 'waiting') timer.value = setTimeout(refresh, 1500)
  }

  async function start() {
    busy.value = true
    try {
      status.value = await $fetch<LoginStatus>('/api/login/start', { method: 'POST' })
      notify(`Entre na sua conta na janela do ${status.value.browser ?? 'navegador'} que abriu e depois feche a janela`)
      void refresh()
    }
    catch (e) {
      notify(errorMessage(e, 'Não foi possível abrir a janela de login'), true)
    }
    finally {
      busy.value = false
    }
  }

  async function cancel() {
    status.value = await $fetch<LoginStatus>('/api/login/cancel', { method: 'POST' })
  }

  async function logout() {
    busy.value = true
    try {
      status.value = await $fetch<LoginStatus>('/api/login/logout', { method: 'POST' })
      notify('Você saiu da conta do YouTube')
    }
    finally {
      busy.value = false
    }
  }

  /** renova a sessão sem senha; se a conta saiu, abre a janela de login */
  async function renew() {
    busy.value = true
    try {
      const r = await $fetch<LoginStatus & { ok: boolean }>('/api/login/renew', { method: 'POST' })
      status.value = r
      if (r.ok) notify('Login renovado')
      else {
        notify('A sessão venceu: entre de novo na janela que vai abrir', true)
        await start()
      }
    }
    finally {
      busy.value = false
    }
  }

  return { status, busy, connected, refresh, start, cancel, logout, renew }
}
