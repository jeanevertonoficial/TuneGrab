export type View = 'home' | 'job' | 'files' | 'library' | 'duplicates' | 'favorites' | 'recent'

const VIEWS: View[] = ['home', 'job', 'files', 'library', 'duplicates', 'favorites', 'recent']

/**
 * Guarda na URL a tela, a pasta aberta, o download e o link da busca:
 * recarregar a página volta para o mesmo lugar e o botão Voltar do navegador funciona.
 * Precisa ser chamado no topo do app.vue, antes dos outros useState com essas chaves.
 */
export function useUrlState() {
  const params = useRequestURL().searchParams
  const initialView = params.get('v') as View | null

  const view = useState<View>('view', () => (initialView && VIEWS.includes(initialView) ? initialView : 'home'))
  const filesPath = useState<string | null>('filesPath', () => params.get('p'))
  const currentJobId = useState<string | null>('currentJobId', () => params.get('j'))
  const homeUrl = useState('homeUrl', () => params.get('q') ?? '')

  if (import.meta.server) return { view, filesPath, currentJobId, homeUrl }

  let restoring = false

  function toQuery() {
    const sp = new URLSearchParams()
    if (view.value !== 'home') sp.set('v', view.value)
    if (view.value === 'files' && filesPath.value) sp.set('p', filesPath.value)
    if (view.value === 'job' && currentJobId.value) sp.set('j', currentJobId.value)
    if (view.value === 'home' && homeUrl.value.trim()) sp.set('q', homeUrl.value.trim())
    const qs = sp.toString()
    return qs ? `?${qs}` : location.pathname
  }

  watch([view, filesPath, currentJobId, homeUrl], (now, before) => {
    if (restoring) return
    const target = toQuery()
    if (target === location.search || (target === location.pathname && !location.search)) return
    // trocar de tela ou de pasta vira um passo no histórico; digitar o link só atualiza
    const isNavigation = now[0] !== before[0] || now[1] !== before[1] || now[2] !== before[2]
    if (isNavigation) history.pushState(null, '', target)
    else history.replaceState(null, '', target)
  })

  window.addEventListener('popstate', () => {
    const sp = new URLSearchParams(location.search)
    restoring = true
    const v = sp.get('v') as View | null
    view.value = v && VIEWS.includes(v) ? v : 'home'
    if (sp.has('p') || view.value === 'files') filesPath.value = sp.get('p')
    if (sp.has('j')) currentJobId.value = sp.get('j')
    if (sp.has('q')) homeUrl.value = sp.get('q')!
    void nextTick(() => (restoring = false))
  })

  return { view, filesPath, currentJobId, homeUrl }
}
