<script setup lang="ts">
interface UsbDisk {
  number: number
  name: string
  serial: string
  size: number
  isBoot: boolean
  isSystem: boolean
  volumes: { letter: string, label: string, fs: string, path: string, size: number }[]
}

/** caminho da unidade escolhida (E:\ ou \\?\Volume{…}\); null = fechado */
const target = defineModel<string | null>({ required: true })
const emit = defineEmits<{ done: [letter: string] }>()
const { notify } = useToast()
const { refresh: refreshLocations } = useDriveLocations()

const FAT32_MAX = 32 * 1024 ** 3
const disk = ref<UsbDisk | null>(null)
const loading = ref(false)
const error = ref('')
const label = ref('PENDRIVE')
const fs = ref<'FAT32' | 'exFAT' | 'NTFS'>('FAT32')
const confirmText = ref('')
const stage = ref<'form' | 'waiting'>('form')

watch(target, async (path) => {
  if (!path) return
  stage.value = 'form'
  confirmText.value = ''
  error.value = ''
  disk.value = null
  loading.value = true
  try {
    const disks = await $fetch<UsbDisk[]>('/api/usb/disks')
    const p = path.toLowerCase()
    // acha o disco físico que contém essa unidade
    disk.value = disks.find(d => d.volumes.some(v => (v.letter && `${v.letter}:\\`.toLowerCase() === p) || v.path.toLowerCase() === p)) ?? null
    if (!disk.value) error.value = 'Não encontrei o pendrive dessa unidade.'
    else {
      fs.value = disk.value.size <= FAT32_MAX ? 'FAT32' : 'exFAT'
      label.value = 'PENDRIVE'
    }
  }
  catch (e) {
    error.value = errorMessage(e)
  }
  finally {
    loading.value = false
  }
}, { immediate: true })

const maxLabel = computed(() => (fs.value === 'FAT32' ? 11 : fs.value === 'exFAT' ? 15 : 32))
watch([fs, label], () => {
  if (fs.value === 'FAT32') label.value = label.value.toUpperCase()
  if (label.value.length > maxLabel.value) label.value = label.value.slice(0, maxLabel.value)
})

const options = computed(() => [
  { id: 'FAT32', name: 'FAT32', desc: 'Funciona em tudo: som de carro, TV, videogame. Arquivos de até 4 GB.', disabled: (disk.value?.size ?? 0) > FAT32_MAX, why: 'Só até 32 GB' },
  { id: 'exFAT', name: 'exFAT', desc: 'Arquivos grandes; Windows, Mac, celulares e TVs mais novas.', disabled: false, why: '' },
  { id: 'NTFS', name: 'NTFS', desc: 'Só para usar no Windows. Não funciona na maioria dos carros e TVs.', disabled: false, why: '' },
] as const)

const canFormat = computed(() => !!disk.value && confirmText.value.trim().toUpperCase() === 'FORMATAR' && stage.value === 'form')

async function run() {
  if (!canFormat.value || !disk.value) return
  stage.value = 'waiting'
  error.value = ''
  try {
    const r = await $fetch<{ letter: string, label: string }>('/api/usb/format', {
      method: 'POST',
      body: { number: disk.value.number, serial: disk.value.serial, size: disk.value.size, fs: fs.value, label: label.value, confirm: 'FORMATAR' },
    })
    notify(`Pendrive formatado: ${r.label}${r.letter ? ` (${r.letter}:)` : ''}`)
    await refreshLocations()
    target.value = null
    emit('done', r.letter)
  }
  catch (e) {
    error.value = errorMessage(e, 'Não foi possível formatar')
    stage.value = 'form'
  }
}

function close() {
  if (stage.value === 'waiting') return // não fecha no meio da formatação
  target.value = null
}
</script>

<template>
  <Teleport to="body">
    <div v-if="target" class="backdrop" @mousedown.self="close">
      <form class="dialog" @submit.prevent="run">
        <h2><Icon name="usb" :size="22" /> Formatar pendrive</h2>

        <p v-if="loading" class="muted">Lendo o pendrive…</p>

        <template v-else-if="disk">
          <div class="disk">
            <strong>{{ disk.name }}</strong>
            <span>{{ formatBytes(disk.size) }} • Disco {{ disk.number }}</span>
            <span v-for="v in disk.volumes" :key="v.path" class="vol">
              Agora: {{ v.label || 'sem nome' }} ({{ v.fs || 'sem formato' }}{{ v.letter ? `, ${v.letter}:` : ', sem letra' }})
            </span>
          </div>

          <div class="warn">
            <Icon name="error" :size="20" />
            <span><b>Tudo que está no pendrive será apagado</b>, inclusive sistemas instalados nele (como um instalador de Linux). Não dá para desfazer.</span>
          </div>

          <label class="lbl">Nome do pendrive
            <input v-model="label" class="field" :maxlength="maxLabel" required>
          </label>

          <div class="lbl">Formato</div>
          <div class="opts">
            <label v-for="o in options" :key="o.id" class="opt" :class="{ on: fs === o.id, disabled: o.disabled }">
              <input v-model="fs" type="radio" :value="o.id" :disabled="o.disabled">
              <span class="o-name">{{ o.name }} <em v-if="o.disabled">({{ o.why }})</em><em v-else-if="o.id === 'FAT32'">recomendado para música</em></span>
              <span class="o-desc">{{ o.desc }}</span>
            </label>
          </div>

          <label class="lbl">Digite <b>FORMATAR</b> para confirmar
            <input v-model="confirmText" class="field" autocomplete="off" placeholder="FORMATAR">
          </label>

          <p v-if="stage === 'waiting'" class="waiting">
            <Icon name="loader" :size="18" class="spin" />
            O Windows vai pedir permissão de administrador. Clique em <b>Sim</b> na janela que abrir… depois a formatação leva alguns segundos.
          </p>
        </template>

        <p v-if="error" class="err">{{ error }}</p>

        <div class="buttons">
          <button type="button" class="btn-text" :disabled="stage === 'waiting'" @click="close">Cancelar</button>
          <button type="submit" class="btn-green danger" :disabled="!canFormat">
            {{ stage === 'waiting' ? 'Formatando…' : 'Formatar' }}
          </button>
        </div>
      </form>
    </div>
  </Teleport>
</template>

<style scoped>
.backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, .7); display: grid; place-items: center; z-index: 100; padding: 16px; }
.dialog { width: min(520px, 100%); max-height: calc(100vh - 32px); overflow-y: auto; background: #282828; border-radius: 8px; padding: 24px; display: flex; flex-direction: column; gap: 14px; box-shadow: 0 16px 48px rgba(0, 0, 0, .6); }
h2 { margin: 0; font-size: 22px; display: flex; align-items: center; gap: 10px; }
.muted { color: var(--subdued); margin: 0; }
.disk { display: flex; flex-direction: column; gap: 2px; background: #1f1f1f; border-radius: 6px; padding: 12px 14px; font-size: 14px; color: var(--subdued); }
.disk strong { color: #fff; font-size: 15px; }
.vol { color: #ffa42b; }
.warn { display: flex; gap: 10px; align-items: flex-start; background: rgba(233, 20, 41, .15); color: #ff8a95; border-radius: 6px; padding: 12px 14px; font-size: 14px; line-height: 1.45; }
.warn b { color: #fff; }
.lbl { font-size: 13px; font-weight: 700; color: var(--subdued); }
.lbl b { color: #fff; }
.field { width: 100%; background: #3e3e3e; border: 1px solid transparent; border-radius: 4px; padding: 10px 12px; font-size: 14px; outline: 0; margin-top: 6px; }
.field:focus { border-color: #fff; }
.opts { display: flex; flex-direction: column; gap: 6px; margin-top: -6px; }
.opt { display: grid; grid-template-columns: 20px 1fr; column-gap: 8px; padding: 10px 12px; border-radius: 6px; background: #1f1f1f; cursor: pointer; border: 1px solid transparent; }
.opt.on { border-color: var(--green); }
.opt.disabled { opacity: .45; cursor: not-allowed; }
.opt input { accent-color: var(--green); grid-row: span 2; margin-top: 2px; }
.o-name { font-weight: 700; font-size: 14px; }
.o-name em { font-style: normal; font-weight: 500; color: var(--green); font-size: 12px; margin-left: 4px; }
.opt.disabled em { color: var(--subdued); }
.o-desc { font-size: 13px; color: var(--subdued); }
.waiting { display: flex; gap: 8px; align-items: flex-start; margin: 0; font-size: 14px; color: #fff; background: #1f3a2a; border-radius: 6px; padding: 12px; line-height: 1.45; }
.err { margin: 0; color: var(--red); font-size: 14px; }
.buttons { display: flex; justify-content: flex-end; gap: 8px; }
.btn-text { padding: 10px 16px; font-weight: 700; color: var(--subdued); }
.btn-text:hover:not(:disabled) { color: #fff; }
.danger { padding: 12px 28px; background: #e91429; color: #fff; }
.danger:hover:not(:disabled) { background: #f1293d; }
</style>
