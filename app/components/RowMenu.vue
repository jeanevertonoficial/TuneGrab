<script setup lang="ts">
defineProps<{ items: { id: string, label: string, icon: string, danger?: boolean }[] }>()
const emit = defineEmits<{ select: [id: string] }>()

const open = ref(false)
const root = ref<HTMLElement>()
const menu = ref<HTMLElement>()
const pos = ref({ top: 0, left: 0, maxH: 0 })
const up = ref(false)

/**
 * O menu é desenhado por cima da tela (fora da lista): as linhas da lista recortam o que sai delas
 * (otimização de listas grandes), e por isso o menu aparecia cortado como uma faixa.
 * Abre embaixo do botão, alinhado à direita; perto do fim da tela abre para cima; nunca sai da tela.
 */
async function place() {
  if (!root.value) return
  const r = root.value.getBoundingClientRect()
  await nextTick()
  const m = menu.value
  const w = m?.offsetWidth ?? 210
  const h = m?.offsetHeight ?? 200
  const gap = 4
  const below = window.innerHeight - r.bottom - gap - 8
  const above = r.top - gap - 8
  // cabe embaixo? abre embaixo. Senão, do lado com mais espaço (e rola por dentro se ainda faltar)
  up.value = h > below && above > below
  const maxH = Math.max(120, up.value ? above : below)
  const shown = Math.min(h, maxH)
  const top = up.value ? r.top - gap - shown : r.bottom + gap
  const left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8)
  pos.value = { top: Math.max(8, top), left, maxH }
}

function toggle() {
  open.value = !open.value
  if (open.value) void place()
}

function close() {
  open.value = false
}

function pick(id: string) {
  close()
  emit('select', id)
}

function outside(e: MouseEvent) {
  const t = e.target as Node
  if (open.value && !root.value?.contains(t) && !menu.value?.contains(t)) close()
}
function onKey(e: KeyboardEvent) {
  if (open.value && e.key === 'Escape') close()
}
// rolou a lista ou mudou o tamanho da janela: o botão saiu do lugar, fecha
function onScroll(e: Event) {
  if (open.value && !menu.value?.contains(e.target as Node)) close()
}
onMounted(() => {
  document.addEventListener('mousedown', outside)
  document.addEventListener('keydown', onKey)
  window.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', close)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', outside)
  document.removeEventListener('keydown', onKey)
  window.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', close)
})
</script>

<template>
  <div ref="root" class="menu-root" @click.stop>
    <button class="trigger" :class="{ on: open }" title="Mais opções" aria-haspopup="menu" :aria-expanded="open" @click="toggle">
      <Icon name="more" :size="20" />
    </button>
    <Teleport to="body">
      <div
        v-if="open" ref="menu" class="row-menu" :class="{ up }" role="menu"
        :style="{ top: `${pos.top}px`, left: `${pos.left}px`, maxHeight: pos.maxH ? `${pos.maxH}px` : undefined }" @click.stop
      >
        <button v-for="it in items" :key="it.id" role="menuitem" :class="{ danger: it.danger }" @click="pick(it.id)">
          <Icon :name="it.icon" :size="16" /> {{ it.label }}
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.menu-root { position: relative; display: flex; justify-content: flex-end; }
.trigger { color: var(--subdued); padding: 4px; border-radius: 50%; display: grid; place-items: center; }
.trigger:hover, .trigger.on { color: #fff; }
.row-menu {
  position: fixed; z-index: 1000; min-width: 210px; max-width: calc(100vw - 16px); padding: 4px;
  overflow-y: auto; background: #282828; border-radius: 6px; box-shadow: 0 16px 32px rgba(0, 0, 0, .6);
  animation: pop .12s ease-out; transform-origin: top right;
}
.row-menu.up { transform-origin: bottom right; }
@keyframes pop { from { opacity: 0; transform: scale(.96); } }
.row-menu button {
  display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px 12px; font-size: 14px;
  border-radius: 4px; color: #e5e5e5; text-align: left; white-space: nowrap;
}
.row-menu button:hover, .row-menu button:focus-visible { background: #3e3e3e; color: #fff; }
.row-menu .danger { color: var(--red); }
</style>
