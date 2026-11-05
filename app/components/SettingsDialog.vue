<script setup lang="ts">
const open = defineModel<boolean>({ required: true })
const { notify } = useToast()
const yt = useYoutubeLogin()

type Source = 'none' | 'chrome' | 'edge' | 'brave' | 'opera' | 'firefox' | 'file'
const cookies = ref<Source>('none')
const hasFile = ref(false)
const fileText = ref('')
const testing = ref(false)
const result = ref<{ ok: boolean, error?: string } | null>(null)

const options: { id: Source, name: string, hint?: string, disabled?: boolean }[] = [
  { id: 'none', name: 'Não usar' },
  { id: 'file', name: 'Arquivo cookies.txt', hint: 'recomendado — funciona com o Chrome' },
  { id: 'firefox', name: 'Firefox', hint: 'funciona direto, se você usa' },
  { id: 'edge', name: 'Microsoft Edge', hint: 'pode não funcionar' },
  { id: 'brave', name: 'Brave', hint: 'pode não funcionar' },
  { id: 'opera', name: 'Opera', hint: 'pode não funcionar' },
  // reativado: se o Chrome recusar a leitura, o servidor desliga o login sozinho e os downloads seguem normais
  { id: 'chrome', name: 'Google Chrome', hint: 'pode não funcionar (o app desliga sozinho se falhar)' },
]
const lastError = ref<string | null>(null)
const embedLyrics = ref(true)
// versão do programa instalado (no navegador fica em branco)
const appVersion = ref('')
onMounted(async () => {
  const info = await (window as any).tunegrabDesktop?.updateInfo?.().catch(() => null)
  if (info?.current) appVersion.value = info.current
})

/** a opção de letras vale na hora (não depende do botão Salvar) */
async function saveLyricsOption() {
  await $fetch('/api/settings', { method: 'POST', body: { embedLyrics: embedLyrics.value } }).catch(() => {})
  notify(embedLyrics.value ? 'As próximas músicas vão com a letra gravada' : 'As letras não serão mais gravadas nas músicas')
}

watch(open, async (o) => {
  if (!o) return
  result.value = null
  const s = await $fetch<{ cookies: Source, hasCookieFile: boolean, lastCookieError?: string, embedLyrics?: boolean }>('/api/settings')
  cookies.value = s.cookies
  embedLyrics.value = s.embedLyrics !== false
  hasFile.value = s.hasCookieFile
  lastError.value = s.lastCookieError ?? null
}, { immediate: true })

async function save() {
  await $fetch('/api/settings', {
    method: 'POST',
    body: { cookies: cookies.value, ...(cookies.value === 'file' && fileText.value.trim() ? { cookieText: fileText.value } : {}) },
  })
  if (fileText.value.trim()) hasFile.value = true
  fileText.value = ''
}

async function test() {
  testing.value = true
  result.value = null
  try {
    await save()
    result.value = await $fetch<{ ok: boolean, error?: string }>('/api/settings/test', { method: 'POST' })
    // login ilegível: o servidor volta sozinho para "Não usar" (os downloads não travam)
    const now = await $fetch<{ cookies: Source }>('/api/settings')
    cookies.value = now.cookies
    if (result.value.ok) notify('YouTube liberado! Pode retomar os downloads.')
  }
  catch (e) {
    result.value = { ok: false, error: errorMessage(e) }
  }
  finally {
    testing.value = false
  }
}

async function saveAndClose() {
  try {
    await save()
    notify('Configurações salvas')
    open.value = false
  }
  catch (e) {
    notify(errorMessage(e, 'Não foi possível salvar'), true)
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="backdrop" @mousedown.self="open = false">
      <div class="dialog">
        <h2>Configurações</h2>

        <section>
          <h3>Conta do YouTube</h3>
          <p v-if="yt.connected.value" class="hint">
            Conectado como <b>{{ yt.status.value.account?.name }}</b>. Os downloads e o "ouvir" usam essa conta.
          </p>
          <p v-else class="hint">
            Recomendado: entre com a sua conta numa janela do Chrome só do TuneGrab. O YouTube para de pedir
            "não sou um robô" e suas curtidas e playlists aparecem na barra lateral.
          </p>
          <div class="row-btns">
            <template v-if="yt.connected.value">
              <button class="btn-ghost small" :disabled="yt.busy.value" @click="yt.renew()">Renovar login</button>
              <button class="btn-text small" :disabled="yt.busy.value" @click="yt.logout()">Sair da conta</button>
            </template>
            <button v-else class="btn-green small" :disabled="yt.busy.value || yt.status.value.state === 'waiting'" @click="yt.start()">
              {{ yt.status.value.state === 'waiting' ? 'Entre na janela que abriu…' : 'Entrar no YouTube' }}
            </button>
          </div>
        </section>

        <section>
          <h3>Letras</h3>
          <label class="opt" :class="{ on: embedLyrics }">
            <input v-model="embedLyrics" type="checkbox" @change="saveLyricsOption">
            <span>Gravar a letra dentro das músicas baixadas <em>— aparece também no celular e no som do carro que mostram letra (MP3, M4A, FLAC e OPUS)</em></span>
          </label>
        </section>

        <section v-if="!yt.connected.value">
          <h3>Outras formas de login (avançado)</h3>
          <p class="hint">
            Depois de muitos downloads seguidos, o YouTube pode pedir para "confirmar que não é um robô" e bloquear.
            Usando os cookies do navegador em que você está <b>logado no YouTube</b>, os pedidos passam a ser seus e o bloqueio some.
            Os cookies são lidos só neste computador, pelo yt-dlp; nada é enviado para outro lugar.
          </p>
          <p v-if="lastError" class="warn">
            O login do <b>{{ options.find(o => o.id === lastError)?.name ?? lastError }}</b> não pôde ser lido e foi desligado
            automaticamente — os downloads continuam funcionando sem ele.
          </p>
          <div class="opts">
            <label v-for="o in options" :key="o.id" class="opt" :class="{ on: cookies === o.id, disabled: o.disabled }">
              <input v-model="cookies" type="radio" :value="o.id" :disabled="o.disabled">
              <span>{{ o.name }} <em v-if="o.hint">— {{ o.hint }}</em></span>
            </label>
          </div>
          <div v-if="cookies === 'file'" class="file">
            <p class="hint">
              1. No Chrome, instale a extensão <b>Get cookies.txt LOCALLY</b> (Chrome Web Store).<br>
              2. Abra o <b>youtube.com</b> logado na sua conta.<br>
              3. Clique na extensão → <b>Export</b> (ou Copy) e cole o conteúdo aqui.<br>
              <template v-if="hasFile"> Já existe um arquivo salvo; cole outro só se quiser trocar.</template>
            </p>
            <textarea v-model="fileText" rows="5" placeholder="# Netscape HTTP Cookie File&#10;.youtube.com	TRUE	/	TRUE	…" />
          </div>
          <div class="test">
            <button class="btn-ghost" :disabled="testing" @click="test">
              <Icon :name="testing ? 'loader' : 'refresh'" :size="16" :class="{ spin: testing }" /> {{ testing ? 'Testando…' : 'Salvar e testar' }}
            </button>
            <span v-if="result?.ok" class="ok"><Icon name="check" :size="16" /> Funcionando — o YouTube liberou.</span>
            <span v-else-if="result" class="bad">{{ result.error }}</span>
          </div>
        </section>

        <section class="about">
          <h3>Sobre o TuneGrab<span v-if="appVersion" class="ver"> · versão {{ appVersion }}</span></h3>
          <p class="hint">
            Software livre (licença <a href="https://github.com/jeanevertonoficial/TuneGrab/blob/main/LICENSE" target="_blank" rel="noopener">GPL-3.0</a>),
            feito com <a href="https://github.com/yt-dlp/yt-dlp" target="_blank" rel="noopener">yt-dlp</a>, FFmpeg, Nuxt e Electron —
            <a href="https://github.com/jeanevertonoficial/TuneGrab/blob/main/THIRD-PARTY-NOTICES.md" target="_blank" rel="noopener">licenças de terceiros</a>.
            Código e novidades: <a href="https://github.com/jeanevertonoficial/TuneGrab" target="_blank" rel="noopener">github.com/jeanevertonoficial/TuneGrab</a>.
          </p>
          <p class="hint small">
            Para uso pessoal: baixe apenas o que você tem direito de baixar (conteúdo próprio, com licença livre ou com
            autorização) e respeite os termos dos serviços que usa. O TuneGrab não tem ligação com YouTube, Google, Spotify
            ou Deezer, não hospeda nenhum conteúdo e não contorna proteção de cópia (DRM).
          </p>
        </section>

        <div class="buttons">
          <button class="btn-text" @click="open = false">Fechar</button>
          <button class="btn-green go" @click="saveAndClose">Salvar</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, .7); display: grid; place-items: center; z-index: 100; padding: 16px; }
.dialog { width: min(600px, 100%); max-height: calc(100vh - 32px); overflow-y: auto; background: #282828; border-radius: 8px; padding: 24px; display: flex; flex-direction: column; gap: 16px; }
h2 { margin: 0; font-size: 24px; }
h3 { margin: 0 0 6px; font-size: 16px; }
.hint { margin: 0 0 10px; color: var(--subdued); font-size: 14px; line-height: 1.5; }
.hint b { color: #fff; }
.row-btns { display: flex; gap: 8px; align-items: center; margin-bottom: 18px; }
.opts { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.opt { display: flex; gap: 8px; align-items: center; padding: 10px 12px; border-radius: 6px; background: #1f1f1f; cursor: pointer; border: 1px solid transparent; font-size: 14px; }
.opt.on { border-color: var(--green); }
.opt.disabled { opacity: .45; cursor: not-allowed; }
.warn { margin: 0 0 10px; padding: 10px 12px; border-radius: 6px; background: rgba(255, 164, 43, .12); color: #ffc46b; font-size: 13px; line-height: 1.45; }
.warn b { color: #fff; }
.opt input { accent-color: var(--green); }
.opt em { font-style: normal; color: var(--muted); font-size: 12px; }
.file { margin-top: 12px; }
textarea { width: 100%; background: #3e3e3e; border: 1px solid transparent; border-radius: 4px; padding: 10px; color: #fff; font: 12px/1.4 ui-monospace, Consolas, monospace; resize: vertical; outline: 0; }
.test { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 12px; }
.ok { color: var(--green); display: inline-flex; gap: 6px; align-items: center; font-size: 14px; font-weight: 600; }
.bad { color: var(--red); font-size: 13px; flex: 1; min-width: 200px; line-height: 1.4; }
.about { border-top: 1px solid #3a3a3a; padding-top: 14px; }
.about .ver { font-weight: 400; color: var(--subdued); font-size: 13px; }
.about a { color: #fff; text-decoration: underline; }
.hint.small { font-size: 12.5px; }
.buttons { display: flex; justify-content: flex-end; gap: 8px; }
.btn-text { padding: 10px 16px; font-weight: 700; color: var(--subdued); }
.btn-text:hover { color: #fff; }
.go { padding: 12px 28px; }
@media (max-width: 600px) { .opts { grid-template-columns: 1fr; } }
</style>
