import { cancelJob, getJob, publicJob } from '../../../utils/jobs'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')!
  cancelJob(id)
  const job = getJob(id)
  return job ? publicJob(job) : null
})
