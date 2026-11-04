<script setup lang="ts">
const props = defineProps<{
  kind: string
  title: string
  thumbnail: string | null
  seed: string
  meta: string[]
}>()

// cor de reserva (sem imagem): derivada do id, para cada item ter seu próprio tom
const color = computed(() => {
  let h = 0
  for (const c of props.seed) h = (h * 31 + c.charCodeAt(0)) % 360
  return `hsl(${h}, 42%, 34%)`
})

/**
 * Capa do YouTube em alta resolução: a "hqdefault" tem só 480 px e faixas pretas em cima e embaixo.
 * Tenta maxres (1280) → sd (640) → a original, conforme o vídeo tiver.
 */
function candidates(url: string | null) {
  if (!url) return []
  const m = url.match(/^(https:\/\/i\.ytimg\.com\/vi\/[\w-]+\/)(?:hq|mq|sd|maxres)?default\.jpg/)
  return m ? [`${m[1]}maxresdefault.jpg`, `${m[1]}sddefault.jpg`, url] : [url]
}
const tries = ref(0)
watch(() => props.thumbnail, () => (tries.value = 0))
const image = computed(() => candidates(props.thumbnail)[tries.value] ?? null)
// as versões 4:3 do YouTube (sd/hq/mq) vêm com faixas pretas em cima e embaixo nos vídeos 16:9: corta
const letterbox = computed(() => /i\.ytimg\.com\/vi\/[\w-]+\/(sd|hq|mq)default\.jpg/.test(image.value ?? ''))

function onError() {
  if (tries.value < candidates(props.thumbnail).length - 1) tries.value++
}
// o YouTube devolve uma imagem cinza 120x90 (sem erro) quando não existe a maxres
function onLoad(e: Event) {
  const img = e.target as HTMLImageElement
  if (img.naturalWidth <= 120) onError()
}
</script>

<template>
  <header class="hero" :class="{ art: !!image }" :style="{ '--tone': color }">
    <!-- fundo: a própria imagem, bem desfocada (dá o tom), e ela grande à direita sumindo para a esquerda -->
    <template v-if="image">
      <div class="bg-tint" :style="{ backgroundImage: `url('${image}')` }" />
      <img :src="image" alt="" class="bg-art" :class="{ letterbox }" referrerpolicy="no-referrer" @error="onError" @load="onLoad">
      <div class="bg-shade" />
    </template>

    <img v-if="image" :src="image" alt="" class="cover" :class="{ letterbox }" referrerpolicy="no-referrer">
    <div v-else class="cover placeholder"><Icon name="music" :size="64" /></div>
    <div class="info">
      <span class="kind">{{ kind }}</span>
      <h1 :class="{ mid: title.length > 18 && title.length <= 40, long: title.length > 40 }" :title="title">{{ title }}</h1>
      <p class="meta">
        <template v-for="(m, i) in meta" :key="i">
          <span v-if="i" class="dot">•</span>
          <span :class="{ strong: i === 0 }">{{ m }}</span>
        </template>
      </p>
    </div>
  </header>
</template>

<style scoped>
.hero {
  position: relative; isolation: isolate; overflow: hidden;
  display: flex; align-items: flex-end; gap: 24px;
  min-height: 340px; padding: 72px 24px 28px;
  background: linear-gradient(var(--tone), color-mix(in srgb, var(--tone) 55%, #121212));
}
.hero.art { background: #120d0b; }

/* tom da imagem: ela mesma, ampliada e bem desfocada */
.bg-tint {
  position: absolute; inset: -80px; z-index: -3;
  background-size: cover; background-position: center;
  filter: blur(70px) saturate(1.35) brightness(.5);
  transform: scale(1.1);
}
/* a imagem grande à direita, sumindo para a esquerda e para baixo (efeito Amazon Music) */
.bg-art {
  position: absolute; top: 0; right: 0; z-index: -2;
  width: min(60%, 900px); height: 100%; object-fit: cover; object-position: center 30%;
  -webkit-mask-image: linear-gradient(to right, transparent 0%, rgba(0, 0, 0, .35) 20%, rgba(0, 0, 0, .8) 40%, #000 58%), linear-gradient(to top, transparent 0%, #000 30%);
  mask-image: linear-gradient(to right, transparent 0%, rgba(0, 0, 0, .35) 20%, rgba(0, 0, 0, .8) 40%, #000 58%), linear-gradient(to top, transparent 0%, #000 30%);
  -webkit-mask-composite: source-in;
  mask-composite: intersect;
}
/* escurece atrás do texto e funde com o resto da tela embaixo */
.bg-shade {
  position: absolute; inset: 0; z-index: -1;
  background:
    linear-gradient(90deg, rgba(0, 0, 0, .55) 0%, rgba(0, 0, 0, .35) 40%, rgba(0, 0, 0, .1) 62%, transparent 80%),
    linear-gradient(to top, rgba(18, 18, 18, .85) 0%, transparent 45%);
}

.cover {
  width: 232px; height: 232px; object-fit: cover; border-radius: 6px; flex: none;
  box-shadow: 0 8px 50px rgba(0, 0, 0, .6);
}
/* recorta as faixas pretas (12,5% em cima e embaixo) da imagem 4:3 do YouTube */
.letterbox { object-view-box: inset(12.5% 0 12.5% 0); }
.placeholder { display: grid; place-items: center; background: #282828; color: var(--muted); }
.info { min-width: 0; display: flex; flex-direction: column; gap: 8px; max-width: min(680px, 54%); text-shadow: 0 2px 18px rgba(0, 0, 0, .45); }
.kind { font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: #fff; opacity: .9; }
h1 {
  margin: 0; font-size: clamp(32px, 5vw, 72px); font-weight: 800; letter-spacing: -2px; line-height: 1.05;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
h1.mid { font-size: clamp(30px, 4vw, 56px); letter-spacing: -1.5px; }
h1.long { font-size: clamp(26px, 3vw, 42px); letter-spacing: -1px; }
.meta { margin: 4px 0 0; font-size: 14px; color: rgba(255, 255, 255, .85); display: flex; flex-wrap: wrap; gap: 4px; }
.strong { color: #fff; font-weight: 700; }
.dot { margin: 0 2px; }

@media (max-width: 860px) {
  .hero { flex-direction: column; align-items: flex-start; padding-top: 32px; min-height: 0; }
  .cover { width: 160px; height: 160px; }
  .info { max-width: 100%; }
  /* tela estreita: a imagem fica atrás de tudo, mais escura */
  .bg-art { width: 100%; opacity: .55; }
}
</style>
