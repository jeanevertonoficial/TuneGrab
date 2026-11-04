import { addRecent, sanitize } from '../../utils/me'

export default defineEventHandler(async (event) => {
  const { track } = await readBody<{ track: any }>(event)
  addRecent(sanitize(track))
  return { ok: true }
})
