import { clearRecent } from '../../utils/me'

export default defineEventHandler(() => {
  clearRecent()
  return { ok: true }
})
