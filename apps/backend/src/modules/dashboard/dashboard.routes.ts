import { createModuleRouter, permission } from '../../lib/routeRegistry.js'
import { authenticate } from '../../middleware/authenticate.js'
import { requirePermission } from '../../middleware/requirePermission.js'
import { resolveCooperative } from '../../middleware/resolveCooperative.js'
import { validate } from '../../middleware/validate.js'
import * as controller from './dashboard.controller.js'
import { searchSchema } from './dashboard.schemas.js'

const module = createModuleRouter('')

const tenant = [authenticate, resolveCooperative] as const

/**
 * The dashboard and the search box.
 *
 * **One endpoint for the whole dashboard**, not the four the plan listed. The phase's exit
 * criterion asks for a single round trip and that is also the only sensible shape on a district
 * office connection: four requests is four chances to be slow and four spinners finishing at
 * different moments. The deviation is recorded in `docs/api.md`.
 *
 * `dashboard:view` opens it, and every section inside is gated again by the permission covering
 * its own data — the money block by `finance:view`, the activity by `audit:view`, and so on. A
 * section the reader may not see is named in `withheld` rather than dropped, so nobody has to
 * wonder whether a missing tile means zero.
 *
 * Search is its own permission because it reaches across every module: `search:use` opens the box,
 * and each resource is only queried when the caller may read that resource. Filtering after the
 * fact would make the box a way to learn that a record exists without being allowed to open it.
 */
module.get(
  '/dashboard',
  permission('dashboard:view'),
  ...tenant,
  requirePermission('dashboard:view'),
  controller.getSummary,
)

module.get(
  '/search',
  permission('search:use'),
  ...tenant,
  requirePermission('search:use'),
  validate({ query: searchSchema }),
  controller.getSearch,
)

export const dashboardRouter = module.router
