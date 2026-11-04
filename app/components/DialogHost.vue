<script setup lang="ts">
import type { FsListing } from '~/composables/useFiles'

const { dialog, close } = useDialog()
const { locations } = useDriveLocations()
const { mkdir } = useFsActions()

const text = ref('')
const tags = reactive({ title: '', artist: '', album: '' })
const input = ref<HTMLInputElement>()

// estado do seletor de pastas
const browsePath = ref<string | null>(null)
const listing = ref<FsListing | null>(null)
const loading = ref(false)
const error = ref('')

watch(dialog, async (d) => {
  if (!d) return
  creating.value = false
  text.value = d.value ?? ''
  if (d.tags) Object.assign(tags, d.tags)
  if (d.kind === 'folder') await browse(d.path ?? null)
  await nextTick()
  input.value?.focus()
  input.value?.select()
})

async function browse(path: string | null) {
  browsePath.value = path
  listing.value = null
  error.value = ''
  if (!path) return
  loading.value = true
  try {
    listing.value = await $fetch<FsListing>('/api/fs/list', { query: { path } })
  }
  catch (e) {
    error.value = errorMessage(e, 'Não foi possível abrir a pasta')
  }
  finally {
    loading.value = false
  }
}

const creating = ref(false)
const newName = ref('')
const newInput = ref<HTMLInputElement>()

async function startNewFolder() {
  creating.value = true
  newName.value = ''
  await nextTick()
  newInput.value?.focus()
}

async function createFolder() {
  const name = newName.value.trim()
  creating.value = false
  if (!name || !browsePath.value) return
  const created = await mkdir(browsePath.value, name)
  if (created) await browse(created)
}

function submit() {
  const d = dialog.value
  if (!d) return
  if (d.kind === 'confirm') close(true)
  else if (d.kind === 'prompt') close(text.value.trim() || null)
  else if (d.kind === 'folder') close(browsePath.value)
  else if (d.kind === 'tags') close({ ...tags })
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && dialog.value) close(dialog.value.kind === 'confirm' ? false : null)
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

const breadcrumb = computed(() => {
  const l = listing.value
  if (!l?.location) return []
  const root = l.location.path.replace(/[\\/]$/, '')
  const rest = l.path.slice(root.length).split(/[\\/]/).filter(Boolean)
  const sep = l.path.includes('\\') ? '\\' : '/'
  const crumbs = [{ name: l.location.name, path: l.location.path }]
  let acc = root
  for (const part of rest) {
    acc += sep + part
    crumbs.push({ name: part, path: acc })
  }
  return crumbs
})
</script>

<template>
  <Teleport to="body">
    <div v-if="dialog" class="backdrop" @mousedown.self="close(dialog.kind === 'confirm' ? false : null)">
      <form class="dialog" :class="{ wide: dialog.kind === 'folder' }" @submit.prevent="submit">
        <h2>{{ dialog.title }}</h2>
        <p v-if="dialog.message" class="msg">{{ dialog.message }}</p>

        <input v-if="dialog.kind === 'prompt'" ref="input" v-model="text" class="field" required>

        <template v-else-if="dialog.kind === 'tags'">
          <label class="lbl">Título<input ref="input" v-model="tags.title" class="field"></label>
          <label class="lbl">Artista<input v-model="tags.artist" class="field"></label>
          <label class="lbl">Álbum<input v-model="tags.album" class="field"></label>
          <p class="hint">Grava direto no arquivo, sem reconverter o áudio. A capa é mantida.</p>
        </template>

        <div v-else-if="dialog.kind === 'folder'" class="picker">
          <!-- raiz: unidades -->
          <template v-if="!browsePath">
            <button v-for="l in locations" :key="l.id" type="button" class="row" @click="browse(l.path)">
              <Icon :name="locationIcon(l.kind)" :class="{ usb: l.kind === 'removable' }" />
              <span class="ellipsis">{{ l.name }}</span>
              <small v-if="l.free">{{ formatBytes(l.free) }} livres</small>
            </button>
          </template>
          <template v-else>
            <nav class="crumbs">
              <button type="button" @click="browse(null)">Unidades</button>
              <template v-for="c in breadcrumb" :key="c.path">
                <span>›</span><button type="button" class="ellipsis" @click="browse(c.path)">{{ c.name }}</button>
              </template>
            </nav>
            <div class="list">
              <p v-if="loading" class="hint">Carregando…</p>
              <p v-else-if="error" class="hint err">{{ error }}</p>
              <template v-else-if="listing">
                <div v-if="creating" class="row new">
                  <Icon name="folderPlus" class="folder" />
                  <input
                    ref="newInput" v-model="newName" class="field inline" placeholder="Nome da nova pasta"
                    @keydown.enter.prevent="createFolder" @keydown.esc.stop.prevent="creating = false"
                  >
                  <button type="button" class="btn-green mini" @click="createFolder">Criar</button>
                </div>
                <button v-if="listing.parent" type="button" class="row" @click="browse(listing.parent)">
                  <Icon name="up" /> <span>..</span>
                </button>
                <button v-for="f in listing.folders" :key="f.path" type="button" class="row" @click="browse(f.path)">
                  <Icon name="folder" class="folder" /> <span class="ellipsis">{{ f.name }}</span>
                </button>
                <p v-if="!listing.folders.length" class="hint">Nenhuma subpasta. {{ listing.files.length ? `${listing.files.length} música(s) aqui.` : '' }}</p>
              </template>
            </div>
          </template>
        </div>

        <div class="buttons">
          <button v-if="dialog.kind === 'folder' && browsePath" type="button" class="btn-ghost left" @click="startNewFolder">
            <Icon name="folderPlus" :size="16" /> Nova pasta
          </button>
          <button type="button" class="btn-text" @click="close(dialog.kind === 'confirm' ? false : null)">Cancelar</button>
          <button
            type="submit" class="btn-green action" :class="{ danger: dialog.danger }"
            :disabled="dialog.kind === 'folder' && !browsePath"
          >
            {{ dialog.confirmLabel || (dialog.kind === 'confirm' ? 'Confirmar' : 'Salvar') }}
          </button>
        </div>
      </form>
    </div>
  </Teleport>
</template>

<style scoped>
.backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, .7); display: grid; place-items: center; z-index: 100; padding: 16px; }
.dialog {
  width: min(440px, 100%); background: #282828; border-radius: 8px; padding: 24px;
  display: flex; flex-direction: column; gap: 14px; box-shadow: 0 16px 48px rgba(0, 0, 0, .6);
}
.dialog.wide { width: min(620px, 100%); }
h2 { margin: 0; font-size: 22px; }
.msg { margin: 0; color: var(--subdued); line-height: 1.5; word-break: break-word; }
.field {
  width: 100%; background: #3e3e3e; border: 1px solid transparent; border-radius: 4px; padding: 10px 12px; font-size: 14px; outline: 0; margin-top: 6px;
}
.field:focus { border-color: #fff; }
.lbl { font-size: 13px; font-weight: 700; color: var(--subdued); }
.hint { margin: 0; color: var(--subdued); font-size: 13px; padding: 8px 4px; }
.err { color: var(--red); }

.picker { background: #1f1f1f; border-radius: 6px; padding: 8px; min-height: 280px; max-height: 50vh; display: flex; flex-direction: column; }
.list { overflow-y: auto; flex: 1; }
.row { display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px; border-radius: 4px; text-align: left; font-size: 15px; }
.row:hover { background: #333; }
.row small { margin-left: auto; color: var(--subdued); white-space: nowrap; }
.usb, .folder { color: var(--green); }
.row.new { background: #2a2a2a; }
.field.inline { margin: 0; padding: 8px 10px; flex: 1; }
.mini { padding: 8px 16px; font-size: 14px; }
.crumbs { display: flex; align-items: center; gap: 4px; padding: 4px 6px 10px; font-size: 13px; color: var(--subdued); flex-wrap: wrap; }
.crumbs button { color: var(--subdued); max-width: 180px; }
.crumbs button:hover { color: #fff; text-decoration: underline; }
.crumbs button:last-child { color: #fff; font-weight: 700; }

.buttons { display: flex; justify-content: flex-end; align-items: center; gap: 8px; margin-top: 6px; }
.left { margin-right: auto; }
.btn-text { padding: 10px 16px; font-weight: 700; color: var(--subdued); }
.btn-text:hover { color: #fff; transform: scale(1.04); }
.action { padding: 12px 28px; }
.danger { background: #e91429; color: #fff; }
.danger:hover { background: #f1293d; }
</style>
