import { Router } from 'express'
import { auditRouter } from './modules/audit/audit.routes.js'
import { authRouter } from './modules/auth/auth.routes.js'
import { healthRouter } from './modules/health/health.routes.js'
import { referenceRouter } from './modules/reference/reference.routes.js'

/**
 * The API surface. Every module registers exactly one router here, and each of its routes declares
 * its access requirement through `createModuleRouter`. The route-inventory test reads that registry
 * and fails the build if a route is reachable without an access decision, or if a route that
 * declares one does not actually enforce it.
 */
export const apiRouter: Router = Router()

apiRouter.use('/health', healthRouter)
apiRouter.use('/auth', authRouter)
apiRouter.use('/audit', auditRouter)
apiRouter.use('/', referenceRouter)
