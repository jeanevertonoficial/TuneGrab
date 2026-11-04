<script setup lang="ts">
/**
 * Seleção no estilo do app (a lista nativa do Windows não aceita estilo).
 * Mouse e teclado: Enter/Espaço/↓ abre, ↑ ↓ escolhe, Enter confirma, Esc fecha.
 */
const props = defineProps<{
  options: { value: string, label: string }[]
  label: string
}>()
const model = defineModel<string>({ required: true })

const open = ref(false)
const active = ref(0)
const root = ref<HTMLElement>()
const trigger = ref<HTMLButtonElement>()
const id = useId()

const current = computed(() => props.options.find(o => o.value === model.value) ?? props.options[0])

function show() {
  open.value = true
  active.value = Math.max(0, props.options.findIndex(o => o.value === model.value))
}
function close(focus = false) {
  open.value = false
  if (focus) trigger.value?.focus()
}
function pick(v: string) {
  model.value = v
  close(true)
}

// Enter/Espaço já viram "clique" no botão (que abre/fecha); aqui só as setas
function onTriggerKey(e: KeyboardEvent) {
  if (['ArrowDown', 'ArrowUp'].includes(e.key) && !open.value) {
    e.preventDefault()
    show()
  }
}
function onListKey(e: KeyboardEvent) {
  const n = props.options.length
  if (e.key === 'ArrowDown') active.value = (active.value + 1) % n
  else if (e.key === 'ArrowUp') active.value = (active.value - 1 + n) % n
  else if (e.key === 'Home') active.value = 0
  else if (e.key === 'End') active.value = n - 1
  else if (e.key === 'Enter' || e.key === ' ') pick(props.options[active.value]!.value)
  else if (e.key === 'Escape' || e.key === 'Tab') return close(e.key === 'Escape')
  else return
  e.preventDefault()
}

// abre: o foco vai para a lista (para as setas funcionarem)
const list = ref<HTMLElement>()
watch(open, async (o) => {
  if (!o) return
  await nextTick()
  list.value?.focus()
})

function outside(e: MouseEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) close()
}
onMounted(() => document.addEventListener('mousedown', outside))
onBeforeUnmount(() => document.removeEventListener('mousedown', outside))
</script>

<template>
  <div ref="root" class="select-menu">
    <button
      ref="trigger" type="button" class="trigger" :class="{ open }"
      :title="label" aria-haspopup="listbox" :aria-expanded="open" :aria-controls="id"
      @click="open ? close() : show()" @keydown="onTriggerKey"
    >
      <slot name="icon" />
      <span>{{ current?.label }}</span>
      <svg class="chev" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>

    <Transition name="pop">
      <ul
        v-if="open" :id="id" ref="list" class="list" role="listbox" tabindex="-1"
        :aria-label="label" :aria-activedescendant="`${id}-${active}`" @keydown="onListKey"
      >
        <li class="list-title" aria-hidden="true">{{ label }}</li>
        <li
          v-for="(o, i) in options" :id="`${id}-${i}`" :key="o.value" role="option"
          class="opt" :class="{ on: o.value === model, hi: i === active }" :aria-selected="o.value === model"
          @mouseenter="active = i" @click="pick(o.value)"
        >
          <span>{{ o.label }}</span>
          <svg v-if="o.value === model" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
        </li>
      </ul>
    </Transition>
  </div>
</template>

<style scoped>
.select-menu { position: relative; }
.trigger {
  display: flex; align-items: center; gap: 6px; height: 30px; padding: 0 8px 0 10px; border-radius: 999px;
  color: var(--subdued); font-size: 14px; font-weight: 600; transition: color .15s, background .15s;
}
.trigger:hover, .trigger.open { color: #fff; background: rgba(255, 255, 255, .07); }
.chev { transition: transform .15s; }
.trigger.open .chev { transform: rotate(180deg); }

.list {
  position: absolute; top: calc(100% + 10px); right: -6px; z-index: 30; min-width: 190px;
  margin: 0; padding: 4px; list-style: none; outline: none;
  background: #282828; border-radius: 8px; box-shadow: 0 16px 40px rgba(0, 0, 0, .55);
}
.list-title { padding: 10px 12px 6px; font-size: 11px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase; color: var(--muted); }
.opt {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 10px 12px; border-radius: 4px; font-size: 14px; color: #e8e8e8; cursor: pointer;
}
.opt.hi { background: #3e3e3e; color: #fff; }
.opt.on { color: var(--green); font-weight: 700; }

.pop-enter-active, .pop-leave-active { transition: opacity .12s, transform .12s; }
.pop-enter-from, .pop-leave-to { opacity: 0; transform: translateY(-4px); }
</style>
