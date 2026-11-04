<script setup lang="ts">
const emit = defineEmits<{ back: [] }>()
const { currentJob: job, cancel, remove, resume } = useDownloads()
const { playList } = usePlayer()
const { locations } = useDriveLocations()
const view = useState<string>('view')
const filesPath = useState<string | null>('filesPath', () => null)
const settingsOpen = useState('settingsOpen', () => false)
const yt = useYoutubeLogin()
const botBlocked = computed(() => !!job.value?.items.some(i => i.error?.includes('não é um robô')))

function play(index?: number) {
  const items = jobPlayItems(job.value!)
  const doneIdx = job.value!.items.filter(i => i.status === 'done' && !i.missing).map(i => i.index)
  playList(items, index === undefined ? 0 : Math.max(0, doneIdx.indexOf(index)))
}

function openFolder() {
  filesPath.value = job.value!.destination
  view.value = 'files'
}

const counts = computed(() => {
  const items = job.value?.items ?? []
  return {
    done: items.filter(i => i.status === 'done').length,
    error: items.filter(i => i.status === 'error').length,
    // faltam: canceladas, com erro ou que nem começaram (app fechado no meio)
    pending: items.filter(i => i.status !== 'done').length,
    total: items.length,
  }
})

const meta = computed(() => {
  const j = job.value!
  const fmt = j.quality === 'lossless' ? j.format.toUpperCase() : `${j.format.toUpperCase()} ${j.quality}${j.format === 'mp4' ? 'p' : ' kbps'}`
  const m = [fmt, `${counts.value.done}/${counts.value.total} prontas`]
  if (counts.value.error) m.push(`${counts.value.error} com erro`)
  if (j.codec === 'h264') m.push('H.264')
  return m
})

const statusText = computed(() => ({
  running: 'Baixando…',
  done: 'Concluído',
  error: 'Falhou',
  canceled: 'Cancelado',
})[job.value?.status ?? 'running'])

async function del() {
  await remove(job.value!.id)
  emit('back')
}
</script>

<template>
  <div>
    <div class="topbar">
      <button class="round" title="Voltar" @click="emit('back')">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M15.96 3.3a1 1 0 0 1 0 1.4L8.66 12l7.3 7.3a1 1 0 1 1-1.42 1.4L6.54 12.7a1 1 0 0 1 0-1.4l8-8a1 1 0 0 1 1.42 0Z" /></svg>
      </button>
      <span v-if="job" class="ellipsis bar-title">{{ job.title }}</span>
    </div>

    <p v-if="!job" class="empty">Esse download não existe mais.</p>

    <template v-else>
      <MediaHeader
        :kind="`${job.type === 'playlist' ? 'Playlist' : 'Música'} • ${statusText}`"
        :title="job.title" :thumbnail="job.thumbnail" :seed="job.id" :meta="meta"
      />

      <div class="progress-wrap">
        <div class="progress"><div :style="{ width: `${jobProgress(job)}%` }" /></div>
      </div>

      <div class="actions">
        <button v-if="counts.done" class="btn-green big" title="Tocar" @click="play()">
          <Icon name="play" :size="28" />
        </button>
        <div class="actions-text">
          <strong v-if="job.destination">{{ job.status === 'running' ? 'Salvando em' : 'Salvo em' }} <span class="ellipsis dest" :title="job.destination">{{ friendlyPath(job.destination, locations) }}</span></strong>
          <strong v-else-if="counts.done > 1">{{ counts.done }} músicas prontas</strong>
          <strong v-else-if="counts.done === 1">Música pronta</strong>
          <strong v-else-if="job.status === 'running'">Preparando seus arquivos…</strong>
          <strong v-else>Nenhum arquivo disponível</strong>
          <span class="hint">
            {{ job.destination ? 'Cada faixa é gravada na pasta assim que fica pronta.' : 'O arquivo é baixado pelo navegador quando tudo termina.' }}
          </span>
        </div>
        <button v-if="job.destination" class="btn-ghost" @click="openFolder"><Icon name="folder" :size="16" /> Abrir pasta</button>
        <a v-if="counts.done" :href="fileUrl(job)" download class="btn-ghost">
          <Icon name="download" :size="16" /> {{ counts.done > 1 ? 'Baixar .zip' : 'Baixar arquivo' }}
        </a>
        <div class="spacer" />
        <button v-if="job.status === 'running'" class="btn-ghost" @click="cancel(job.id)">
          <Icon name="close" :size="16" /> Cancelar
        </button>
        <template v-else>
          <button v-if="counts.pending" class="btn-green resume" @click="resume(job.id)">
            <Icon name="refresh" :size="16" /> Retomar {{ counts.pending }} faixa{{ counts.pending > 1 ? 's' : '' }}
          </button>
          <button class="btn-ghost" @click="del">
            <Icon name="trash" :size="16" /> Remover
          </button>
        </template>
      </div>

      <div v-if="botBlocked && job.status !== 'running'" class="interrupted bot">
        <Icon name="error" :size="18" />
        <span>
          <b>O YouTube pausou os downloads</b> pedindo para confirmar que não é um robô (muitos downloads seguidos).
          <template v-if="yt.connected.value">Renove o login e clique em <b>Retomar</b> — ou espere algumas horas.</template>
          <template v-else>Entre com a sua conta do YouTube e clique em <b>Retomar</b> — ou espere algumas horas.</template>
        </span>
        <button v-if="yt.connected.value" class="btn-green small" :disabled="yt.busy.value" @click="yt.renew()">Renovar login</button>
        <button v-else class="btn-green small" :disabled="yt.busy.value || yt.status.value.state === 'waiting'" @click="yt.start()">
          {{ yt.status.value.state === 'waiting' ? 'Entre na janela que abriu…' : 'Entrar no YouTube' }}
        </button>
      </div>
      <p v-else-if="job.status !== 'running' && counts.pending && job.items.some(i => i.error?.startsWith('Interrompido'))" class="interrupted">
        <Icon name="error" :size="18" />
        Este download foi interrompido (o app ou o computador fechou). Clique em <b>Retomar</b> para baixar só o que faltou —
        o que já estava pela metade continua de onde parou.
      </p>

      <TrackTable :tracks="job.items" :job="job" @play="play" />
    </template>
  </div>
</template>

<style scoped>
.topbar {
  position: sticky; top: 0; z-index: 5; height: 64px;
  display: flex; align-items: center; gap: 16px; padding: 0 24px;
  background: rgba(18, 18, 18, .92); backdrop-filter: blur(12px);
}
.round { width: 32px; height: 32px; border-radius: 50%; background: rgba(0, 0, 0, .7); display: grid; place-items: center; }
.round:hover { background: #000; }
.bar-title { font-size: 20px; font-weight: 700; }
.empty { padding: 24px; color: var(--subdued); }

.progress-wrap { padding: 0 24px; background: color-mix(in srgb, #121212 60%, transparent); }
.progress { height: 4px; background: rgba(255, 255, 255, .15); border-radius: 2px; overflow: hidden; }
.progress div { height: 100%; background: var(--green); transition: width .5s; }

.actions { display: flex; align-items: center; gap: 24px; padding: 24px; flex-wrap: wrap; }
.big { width: 64px; height: 64px; flex: none; }
.actions-text { display: flex; flex-direction: column; gap: 4px; min-width: 0; max-width: 520px; }
.dest { display: block; font-weight: 500; color: var(--subdued); font-size: 14px; }
.hint { font-size: 14px; color: var(--subdued); }
.spacer { flex: 1; }
.resume { padding: 8px 18px; font-size: 14px; gap: 6px; }
.interrupted { margin: 0 24px 16px; padding: 12px 16px; border-radius: 6px; background: rgba(255, 164, 43, .12); color: #ffc46b; display: flex; gap: 8px; align-items: flex-start; font-size: 14px; line-height: 1.5; }
.interrupted b { color: #fff; }
.interrupted.bot { align-items: center; flex-wrap: wrap; }
.interrupted.bot span { flex: 1; min-width: 240px; }
.small { padding: 6px 14px; font-size: 13px; }
</style>
