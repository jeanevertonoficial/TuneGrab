import { publicJob, resumeJob } from '../../../utils/jobs'

/** Retoma um download cancelado ou interrompido: baixa só as faixas que faltam. */
export default defineEventHandler((event) => {
  try {
    return publicJob(resumeJob(getRouterParam(event, 'id')!))
  }
  catch (e: any) {
    throw createError({ statusCode: 400, statusMessage: e.message })
  }
})
