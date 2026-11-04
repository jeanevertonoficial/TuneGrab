import { removeJob } from '../../../utils/jobs'

export default defineEventHandler((event) => {
  removeJob(getRouterParam(event, 'id')!)
  return { ok: true }
})
