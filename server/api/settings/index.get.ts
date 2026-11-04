import { existsSync } from 'node:fs'
import { cookieFile, getSettings } from '../../utils/settings'

export default defineEventHandler(() => ({ ...getSettings(), hasCookieFile: existsSync(cookieFile) }))
