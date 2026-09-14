import { Router } from 'express'
import { adminRouter } from './modules/admin/admin.routes.js'
import { auditRouter } from './modules/audit/audit.routes.js'
import { authRouter } from './modules/auth/auth.routes.js'
import { cooperativesRouter } from './modules/cooperatives/cooperatives.routes.js'
import { healthRouter } from './modules/health/health.routes.js'
import { membersRouter } from './modules/members/members.routes.js'
import { referenceRouter } from './modules/reference/reference.routes.js'
import { staffRouter } from './modules/staff/staff.routes.js'

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
apiRouter.use('/admin', adminRouter)
// Mounted at the root because their paths are already fully qualified: /cooperatives/current,
// /settings/:key, /staff, /roles, /permissions.
apiRouter.use('/', membersRouter)
apiRouter.use('/', cooperativesRouter)
apiRouter.use('/', staffRouter)
apiRouter.use('/', referenceRouter)
