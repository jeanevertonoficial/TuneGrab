import { textInfo } from '../../utils/services'

/** Lista colada ("Artista - Música" por linha): cada linha vira uma busca no YouTube. */
export default defineEventHandler(async (event) => {
  const { text } = await readBody<{ text: string }>(event)
  try {
    return textInfo(text)
  }
  catch (e: any) {
    throw createError({ statusCode: 400, statusMessage: e.message })
  }
})
