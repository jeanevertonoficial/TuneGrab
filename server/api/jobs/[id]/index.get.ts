import { getJob, publicJob } from '../../../utils/jobs'

export default defineEventHandler((event) => {
  const job = getJob(getRouterParam(event, 'id')!)
  if (!job) throw createError({ statusCode: 404, statusMessage: 'Download não encontrado' })
  return publicJob(job)
})
