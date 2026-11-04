import { sanitize, setFavorite } from '../../utils/me'

export default defineEventHandler(async (event) => {
  const { track, on } = await readBody<{ track: any, on: boolean }>(event)
  setFavorite(sanitize(track), !!on)
  return { ok: true }
})
