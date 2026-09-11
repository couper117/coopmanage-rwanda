import { createModuleRouter, permission } from '../../lib/routeRegistry.js'
import { authenticate } from '../../middleware/authenticate.js'
import { requirePermission } from '../../middleware/requirePermission.js'
import { resolveCooperative } from '../../middleware/resolveCooperative.js'
import { validate } from '../../middleware/validate.js'
import { getAuditLog } from './audit.controller.js'
import { auditQuerySchema } from './audit.schemas.js'

const module = createModuleRouter('/audit')

module.get(
  '/',
  permission('audit:view'),
  authenticate,
  resolveCooperative,
  requirePermission('audit:view'),
  validate({ query: auditQuerySchema }),
  getAuditLog,
)

export const auditRouter = module.router
