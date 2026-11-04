<script setup lang="ts">
defineProps<{ items: { id: string, label: string, icon: string, danger?: boolean }[] }>()
const emit = defineEmits<{ select: [id: string] }>()

const open = ref(false)
const root = ref<HTMLElement>()
const up = ref(false)

function toggle() {
  open.value = !open.value
  if (open.value && root.value) {
    // abre para cima quando está perto do fim da tela
    up.value = root.value.getBoundingClientRect().bottom > window.innerHeight - 280
  }
}

function pick(id: string) {
  open.value = false
  emit('select', id)
}

function outside(e: MouseEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false
}
onMounted(() => document.addEventListener('mousedown', outside))
onBeforeUnmount(() => document.removeEventListener('mousedown', outside))
</script>

<template>
  <div ref="root" class="menu-root" @click.stop>
    <button class="trigger" :class="{ on: open }" title="Mais opções" @click="toggle">
      <Icon name="more" :size="20" />
    </button>
    <div v-if="open" class="menu" :class="{ up }">
      <button v-for="it in items" :key="it.id" :class="{ danger: it.danger }" @click="pick(it.id)">
        <Icon :name="it.icon" :size="16" /> {{ it.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.menu-root { position: relative; display: flex; justify-content: flex-end; }
.trigger { color: var(--subdued); padding: 4px; border-radius: 50%; display: grid; place-items: center; }
.trigger:hover, .trigger.on { color: #fff; }
.menu {
  position: absolute; right: 0; top: 100%; z-index: 20; min-width: 210px; padding: 4px;
  background: #282828; border-radius: 4px; box-shadow: 0 16px 24px rgba(0, 0, 0, .5);
}
.menu.up { top: auto; bottom: 100%; }
.menu button { display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px 12px; font-size: 14px; border-radius: 2px; color: #e5e5e5; text-align: left; }
.menu button:hover { background: #3e3e3e; color: #fff; }
.menu .danger { color: var(--red); }
</style>
