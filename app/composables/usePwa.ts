/** Instalar o TuneGrab como aplicativo (janela própria, ícone na área de trabalho / menu Iniciar). */
interface InstallPrompt extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: InstallPrompt | null = null
let listening = false

export function usePwa() {
  const canInstall = useState('pwaCanInstall', () => false)
  /** já está aberto como app instalado */
  const installed = useState('pwaInstalled', () => false)
  const { notify } = useToast()

  function listen() {
    if (import.meta.server || listening) return
    listening = true
    installed.value = matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault() // o app mostra o próprio botão "Instalar"
      deferred = e as InstallPrompt
      canInstall.value = true
    })
    window.addEventListener('appinstalled', () => {
      deferred = null
      canInstall.value = false
      notify('TuneGrab instalado! Procure o ícone na área de trabalho ou no menu Iniciar.')
    })
  }

  async function install() {
    if (!deferred) return
    await deferred.prompt()
    const { outcome } = await deferred.userChoice
    if (outcome === 'accepted') canInstall.value = false
    deferred = null
  }

  return { canInstall, installed, listen, install }
}
