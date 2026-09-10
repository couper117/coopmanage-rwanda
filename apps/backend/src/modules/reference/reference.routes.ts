import { readLimiter } from '../../middleware/rateLimit.js'
import { createModuleRouter, PUBLIC } from '../../lib/routeRegistry.js'
import { getCooperativeTypes } from './reference.controller.js'

const module = createModuleRouter('')

// Public: needed on the cooperative creation screen before a session exists, and it holds no
// tenant data. Every other reference endpoint added later must justify being public here.
module.get('/cooperative-types', PUBLIC, readLimiter, getCooperativeTypes)

export const referenceRouter = module.router
