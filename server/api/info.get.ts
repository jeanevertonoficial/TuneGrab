import { getDetails, getInfo, searchInfo } from '../utils/ytdlp'

export default defineEventHandler(async (event) => {
  const { url, full } = getQuery(event)
  const value = typeof url === 'string' ? url.trim() : ''
  if (!value) throw createError({ statusCode: 400, statusMessage: 'Digite um link ou o nome de uma música' })
  try {
    // sem link: busca por nome (música, artista, gênero…)
    if (!/^https?:\/\//i.test(value)) return await searchInfo(value)
    // full=1: completa um resultado rápido (oEmbed) com a duração
    return full ? await getDetails(value) : await getInfo(value)
  }
  catch (e: any) {
    throw createError({ statusCode: 422, statusMessage: e.message })
  }
})
