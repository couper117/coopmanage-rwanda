import { createModuleRouter, permission } from '../../lib/routeRegistry.js'
import { authenticate } from '../../middleware/authenticate.js'
import { requirePermission } from '../../middleware/requirePermission.js'
import { resolveCooperative } from '../../middleware/resolveCooperative.js'
import { validate } from '../../middleware/validate.js'
import * as controller from './reports.controller.js'
import {
  exportReportSchema,
  listReportRunsSchema,
  reportParamsSchema,
  reportRunIdSchema,
  reportTypeParamSchema,
} from './reports.schemas.js'

const module = createModuleRouter('/reports')

const tenant = [authenticate, resolveCooperative] as const

/**
 * Reports.
 *
 * Two permissions, because reading a report and producing a file are different acts: `reports:view`
 * opens the catalogue and previews a report on screen; `reports:export` produces a PDF, a CSV or a
 * spreadsheet, which is a document that leaves the cooperative and is filed elsewhere.
 *
 * Both are only the outer gate. Each report also requires the permission covering its own data —
 * `finance:view` for the financial report, `audit:view` for the activity report — checked in the
 * service, because "may read reports" and "may read the cooperative's money" are two different
 * decisions. Inside a report, each section is gated again, and a section the reader may not see is
 * named on the page rather than dropped from it.
 *
 * A preview is a `POST` although it reads nothing, because its parameters are a body rather than a
 * query string: a report takes a period, a language and sometimes a member, and putting those in
 * the URL would mean a member's identifier ending up in server logs and browser history.
 *
 * `/reports/runs` is registered before `/reports/:type/...`, so it is not read as a report type
 * called "runs".
 */
module.get(
  '/',
  permission('reports:view'),
  ...tenant,
  requirePermission('reports:view'),
  controller.getCatalogue,
)

module.get(
  '/runs',
  permission('reports:view'),
  ...tenant,
  requirePermission('reports:view'),
  validate({ query: listReportRunsSchema }),
  controller.getRuns,
)

module.get(
  '/runs/:id/download',
  permission('reports:export'),
  ...tenant,
  requirePermission('reports:export'),
  validate({ params: reportRunIdSchema }),
  controller.getRunDownload,
)

module.post(
  '/:type/preview',
  permission('reports:view'),
  ...tenant,
  requirePermission('reports:view'),
  validate({ params: reportTypeParamSchema, body: reportParamsSchema }),
  controller.postPreview,
)

module.post(
  '/:type/export',
  permission('reports:export'),
  ...tenant,
  requirePermission('reports:export'),
  validate({ params: reportTypeParamSchema, body: exportReportSchema }),
  controller.postExport,
)

export const reportsRouter = module.router
