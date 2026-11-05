<script setup lang="ts">
/**
 * Programa instalado: avisa quando há versão nova no GitHub e atualiza com um clique
 * (baixa, confere o arquivo, instala e abre o TuneGrab de novo). Não aparece no navegador.
 */
interface Update { version: string, notes: string, size: number }
interface Bridge {
  updateInfo?: () => Promise<{ current: string, update: Update | null }>
  onUpdate?: (cb: (u: Update) => void) => void
  installUpdate?: () => Promise<{ ok: boolean, erro?: string }>
  onUpdateProgress?: (cb: (p: { fase: string, pct?: number, mb?: number, erro?: string }) => void) => void
}
const { jobs } = useDownloads()
const update = ref<Update | null>(null)
const dismissed = ref('')
const fase = ref<'' | 'baixando' | 'instalando' | 'erro'>('')
const pct = ref(0)
const mbDone = ref(0) // MB já baixados (0 = ainda conectando)
const erro = ref('')

const bridge = () => (window as any).tunegrabDesktop as Bridge | undefined
const show = computed(() => !!update.value && dismissed.value !== update.value.version)
const running = computed(() => jobs.value.filter(j => j.status === 'running').length)
const mb = computed(() => (update.value?.size ? `${Math.round(update.value.size / 1048576)} MB` : ''))

onMounted(async () => {
  const b = bridge()
  if (!b?.updateInfo) return
  try { dismissed.value = localStorage.getItem('tunegrab:update-later') ?? '' }
  catch {}
  b.onUpdate?.(u => (update.value = u))
  b.onUpdateProgress?.((p) => {
    fase.value = p.fase as typeof fase.value
    pct.value = p.pct ?? 0
    mbDone.value = p.mb ?? mbDone.value
    erro.value = p.erro ?? ''
  })
  update.value = (await b.updateInfo().catch(() => null))?.update ?? null
})

async function install() {
  erro.value = ''
  fase.value = 'baixando'
  pct.value = 0
  mbDone.value = 0
  const r = await bridge()?.installUpdate?.()
  if (r && !r.ok) {
    fase.value = 'erro'
    erro.value = r.erro || 'Não deu para atualizar agora.'
  }
}
function later() {
  if (!update.value) return
  dismissed.value = update.value.version
  try { localStorage.setItem('tunegrab:update-later', update.value.version) }
  catch {}
}
</script>

<template>
  <div v-if="show" class="update" role="status">
    <Icon name="download" :size="18" class="ic" />
    <div class="txt">
      <template v-if="fase === 'baixando'">
        <b v-if="!mbDone">Conectando ao GitHub para baixar a versão {{ update!.version }}…</b>
        <b v-else>Baixando a versão {{ update!.version }}… {{ pct }}% <small>({{ mbDone }} de {{ mb }})</small></b>
        <span class="bar"><i :style="{ width: `${pct}%` }" /></span>
      </template>
      <template v-else-if="fase === 'instalando'">
        <b>Instalando a versão {{ update!.version }}…</b>
        <span>O TuneGrab vai fechar e abrir de novo sozinho em até 1 minuto — não precisa fazer nada.</span>
      </template>
      <template v-else>
        <b>Nova versão do TuneGrab: {{ update!.version }}</b>
        <span v-if="fase === 'erro'" class="err">{{ erro }}</span>
        <span v-else-if="running">{{ running }} download{{ running > 1 ? 's' : '' }} em andamento: ao atualizar, ele{{ running > 1 ? 's' : '' }} continua{{ running > 1 ? 'm' : '' }} de onde parou{{ running > 1 ? 'ram' : '' }} depois.</span>
        <span v-else>Leva cerca de 1 minuto ({{ mb }}). Histórico, login e preferências continuam.</span>
      </template>
    </div>
    <template v-if="fase !== 'baixando' && fase !== 'instalando'">
      <a class="notes" href="https://github.com/jeanevertonoficial/TuneGrab/releases/latest" target="_blank" rel="noopener">Novidades</a>
      <button class="later" @click="later">Depois</button>
      <button class="go" @click="install">{{ fase === 'erro' ? 'Tentar de novo' : 'Atualizar agora' }}</button>
    </template>
  </div>
</template>

<style scoped>
.update {
  position: fixed; z-index: 900; left: 50%; bottom: 104px; transform: translateX(-50%);
  width: min(640px, calc(100vw - 32px)); display: flex; align-items: center; gap: 12px;
  padding: 12px 14px; border-radius: 10px; background: #1f1f1f; border: 1px solid #333;
  box-shadow: 0 16px 40px rgba(0, 0, 0, .6); animation: up .2s ease-out;
}
@keyframes up { from { opacity: 0; transform: translate(-50%, 8px); } }
.ic { color: var(--green, #1ed760); flex: none; }
.txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; font-size: 13px; }
.txt b { font-size: 14px; }
.txt small { font-weight: 400; color: var(--subdued, #a7a7a7); }
.txt span { color: var(--subdued, #a7a7a7); }
.txt .err { color: var(--red, #f15e6c); }
.bar { display: block; height: 4px; border-radius: 2px; background: #3a3a3a; overflow: hidden; margin-top: 4px; }
.bar i { display: block; height: 100%; background: var(--green, #1ed760); transition: width .2s; }
.notes { font-size: 13px; color: var(--subdued, #a7a7a7); text-decoration: underline; flex: none; }
.notes:hover { color: #fff; }
.later, .go { flex: none; padding: 8px 14px; border-radius: 999px; font-size: 13px; font-weight: 700; }
.later { color: #fff; border: 1px solid #555; }
.later:hover { border-color: #fff; }
.go { background: var(--green, #1ed760); color: #000; }
.go:hover { filter: brightness(1.08); }
@media (max-width: 640px) { .notes { display: none; } }
</style>
