import { createModuleRouter, PUBLIC } from '../../lib/routeRegistry.js'
import { getHealth, getReadiness } from './health.controller.js'

const module = createModuleRouter('/health')

// Public by necessity: a host polls these to decide whether to send traffic here.
module.get('/', PUBLIC, getHealth)
module.get('/ready', PUBLIC, getReadiness)

export const healthRouter = module.router
