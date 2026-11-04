<script setup lang="ts">
import type { FormatChoice } from '~/composables/useDownloads'

interface FormatDef { label: string, kind: 'audio' | 'video', qualities: string[] }

/** formatos escolhidos, cada um com sua qualidade (ex.: MP3 320 + MP4 1080p) */
const model = defineModel<FormatChoice[]>({ required: true })

const { data: formats } = await useFetch<Record<string, FormatDef>>('/api/formats')

const isOn = (id: string) => model.value.some(c => c.format === id)

function toggle(id: string) {
  if (isOn(id)) {
    // sempre fica pelo menos um formato
    if (model.value.length > 1) model.value = model.value.filter(c => c.format !== id)
    return
  }
  const def = formats.value?.[id]
  // dois formatos de áudio sem perdas ao mesmo tempo raramente faz sentido, mas é permitido
  model.value = [...model.value, { format: id, quality: def?.qualities[0] ?? 'lossless' }]
}

function setQuality(id: string, q: string) {
  model.value = model.value.map(c => (c.format === id ? { ...c, quality: q } : c))
}

function setCodec(id: string, codec: 'vp9' | 'h264') {
  model.value = model.value.map(c => (c.format === id ? { ...c, codec } : c))
}

function qualityLabel(id: string, q: string) {
  if (q === 'lossless') return 'Sem perdas'
  return id === 'mp4' ? `${q}p` : `${q} kbps`
}

watch(model, (v) => {
  try { localStorage.setItem('tunegrab:formats', JSON.stringify(v)) }
  catch {}
}, { deep: true })

onMounted(() => {
  try {
    const saved = JSON.parse(localStorage.getItem('tunegrab:formats') || 'null') as FormatChoice[] | null
    const valid = saved?.filter(c => formats.value?.[c.format]?.qualities.includes(c.quality))
    if (valid?.length) model.value = valid
  }
  catch {}
})
</script>

<template>
  <div class="picker">
    <div class="chips">
      <button
        v-for="(f, id) in formats" :key="id"
        class="chip" :class="{ active: isOn(id as string), video: f.kind === 'video' }"
        :title="isOn(id as string) ? 'Clique para remover' : 'Clique para adicionar'"
        @click="toggle(id as string)"
      >
        <Icon v-if="isOn(id as string)" name="check" :size="14" />
        {{ f.label }}
      </button>
    </div>
    <div class="qualities">
      <label v-for="c in model" :key="c.format" class="quality" :class="{ fixed: (formats?.[c.format]?.qualities.length ?? 0) < 2 }">
        <span>{{ formats?.[c.format]?.label }}</span>
        <select v-if="(formats?.[c.format]?.qualities.length ?? 0) > 1" :value="c.quality" @change="e => setQuality(c.format, (e.target as HTMLSelectElement).value)">
          <option v-for="q in formats?.[c.format]?.qualities" :key="q" :value="q">{{ qualityLabel(c.format, q) }}</option>
        </select>
        <em v-else>sem perdas</em>
        <!-- vídeo: VP9 tem a mesma resolução com ~metade do tamanho (baixa 2x mais rápido) -->
        <select
          v-if="c.format === 'mp4'" :value="c.codec ?? 'vp9'" class="codec"
          title="Leve: mesma resolução e qualidade visual, arquivo ~50% menor (baixa ~2x mais rápido). Compatível: H.264, para TV antiga e som de carro."
          @change="e => setCodec(c.format, (e.target as HTMLSelectElement).value as 'vp9' | 'h264')"
        >
          <option value="vp9">Leve (VP9) · 2x mais rápido</option>
          <option value="h264">Compatível (H.264)</option>
        </select>
      </label>
    </div>
  </div>
</template>

<style scoped>
.picker { display: flex; flex-direction: column; gap: 10px; }
.chips { display: flex; gap: 8px; flex-wrap: wrap; }
.chip { display: inline-flex; align-items: center; gap: 4px; }
.qualities { display: flex; gap: 8px; flex-wrap: wrap; }
.quality {
  display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--subdued);
  background: rgba(255, 255, 255, .05); border-radius: 6px; padding: 4px 4px 4px 10px;
}
.quality.fixed { padding-right: 10px; }
.quality span { font-weight: 700; color: #fff; }
.quality em { font-style: normal; }
select {
  background: var(--highlight); border: 1px solid transparent; border-radius: 4px; padding: 4px 8px;
  color: #fff; font-size: 13px; cursor: pointer;
}
select:hover { border-color: #555; }
</style>
