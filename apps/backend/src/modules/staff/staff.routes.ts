import { createModuleRouter, permission } from '../../lib/routeRegistry.js'
import { authenticate } from '../../middleware/authenticate.js'
import { requirePermission } from '../../middleware/requirePermission.js'
import { resolveCooperative } from '../../middleware/resolveCooperative.js'
import { validate } from '../../middleware/validate.js'
import * as controller from './staff.controller.js'
import {
  deactivateStaffSchema,
  inviteStaffSchema,
  listStaffSchema,
  putOverridesSchema,
  staffIdSchema,
  updateStaffSchema,
} from './staff.schemas.js'

const module = createModuleRouter('')

const tenant = [authenticate, resolveCooperative] as const

module.get(
  '/staff',
  permission('staff:view'),
  ...tenant,
  requirePermission('staff:view'),
  validate({ query: listStaffSchema }),
  controller.getStaff,
)

module.post(
  '/staff/invite',
  permission('staff:invite'),
  ...tenant,
  requirePermission('staff:invite'),
  validate({ body: inviteStaffSchema }),
  controller.postInvite,
)

module.patch(
  '/staff/:id',
  permission('staff:manage'),
  ...tenant,
  requirePermission('staff:manage'),
  validate({ params: staffIdSchema, body: updateStaffSchema }),
  controller.patchStaff,
)

module.post(
  '/staff/:id/deactivate',
  permission('staff:manage'),
  ...tenant,
  requirePermission('staff:manage'),
  validate({ params: staffIdSchema, body: deactivateStaffSchema }),
  controller.postDeactivate,
)

// Reading the exception list needs only staff:view, because the staff screen shows how many
// exceptions a person has. Changing it is staff:manage.
module.get(
  '/staff/:id/overrides',
  permission('staff:view'),
  ...tenant,
  requirePermission('staff:view'),
  validate({ params: staffIdSchema }),
  controller.getOverrides,
)

module.put(
  '/staff/:id/overrides',
  permission('staff:manage'),
  ...tenant,
  requirePermission('staff:manage'),
  validate({ params: staffIdSchema, body: putOverridesSchema }),
  controller.putStaffOverrides,
)

module.get(
  '/roles',
  permission('staff:view'),
  ...tenant,
  requirePermission('staff:view'),
  controller.getRoles,
)

module.get(
  '/permissions',
  permission('staff:view'),
  ...tenant,
  requirePermission('staff:view'),
  controller.getPermissions,
)

export const staffRouter = module.router
