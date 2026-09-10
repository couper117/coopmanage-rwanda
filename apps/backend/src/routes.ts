import { Router } from 'express'
import { healthRouter } from './modules/health/health.routes.js'
import { referenceRouter } from './modules/reference/reference.routes.js'

/**
 * The API surface. Every module registers exactly one router here, and each of its routes declares
 * its access requirement through `createModuleRouter`. The route-inventory test reads that registry
 * and, from Phase 2, fails the build if any route is reachable without an access decision.
 */
export const apiRouter: Router = Router()

apiRouter.use('/health', healthRouter)
apiRouter.use('/', referenceRouter)
