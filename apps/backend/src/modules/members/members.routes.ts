import { createModuleRouter, permission } from '../../lib/routeRegistry.js'
import { authenticate } from '../../middleware/authenticate.js'
import { requirePermission } from '../../middleware/requirePermission.js'
import { resolveCooperative } from '../../middleware/resolveCooperative.js'
import { validate } from '../../middleware/validate.js'
import * as controller from './members.controller.js'
import {
  createMemberSchema,
  exportMembersSchema,
  listContributionsSchema,
  listMembersSchema,
  memberIdSchema,
  memberShareIdSchema,
  memberStatusSchema,
  recordContributionSchema,
  recordShareSchema,
  updateMemberSchema,
  voidSchema,
} from './members.schemas.js'

const module = createModuleRouter('')

const tenant = [authenticate, resolveCooperative] as const

/**
 * There is no `DELETE /members/:id`. A member is deactivated, suspended or marked as having left,
 * and the record always remains: the cooperative's books have to stay defensible years later, and
 * a deleted member would take their contribution history with them.
 *
 * The fixed paths come before `/members/:id`, so `/members/stats` is not read as a member whose
 * identifier is the word "stats".
 */
module.get(
  '/members',
  permission('members:view'),
  ...tenant,
  requirePermission('members:view'),
  validate({ query: listMembersSchema }),
  controller.getMembers,
)

module.get(
  '/members/stats',
  permission('members:view'),
  ...tenant,
  requirePermission('members:view'),
  controller.getMemberStats,
)

module.get(
  '/members/form-options',
  permission('members:view'),
  ...tenant,
  requirePermission('members:view'),
  controller.getMemberFormOptions,
)

module.get(
  '/members/export',
  permission('members:export'),
  ...tenant,
  requirePermission('members:export'),
  validate({ query: exportMembersSchema }),
  controller.getMembersExport,
)

module.post(
  '/members',
  permission('members:create'),
  ...tenant,
  requirePermission('members:create'),
  validate({ body: createMemberSchema }),
  controller.postMember,
)

module.get(
  '/members/:id',
  permission('members:view'),
  ...tenant,
  requirePermission('members:view'),
  validate({ params: memberIdSchema }),
  controller.getOneMember,
)

module.patch(
  '/members/:id',
  permission('members:update'),
  ...tenant,
  requirePermission('members:update'),
  validate({ params: memberIdSchema, body: updateMemberSchema }),
  controller.patchMember,
)

module.post(
  '/members/:id/status',
  permission('members:deactivate'),
  ...tenant,
  requirePermission('members:deactivate'),
  validate({ params: memberIdSchema, body: memberStatusSchema }),
  controller.postMemberStatus,
)

/**
 * The profile's figures. Guarded by `members:view` for the record itself; each money block inside
 * is gated separately by the permission covering its data, and a block the caller may not see is
 * named in the response rather than silently omitted.
 */
module.get(
  '/members/:id/summary',
  permission('members:view'),
  ...tenant,
  requirePermission('members:view'),
  validate({ params: memberIdSchema }),
  controller.getMemberSummary,
)

module.get(
  '/members/:id/timeline',
  permission('members:view'),
  ...tenant,
  requirePermission('members:view'),
  validate({ params: memberIdSchema }),
  controller.getMemberTimeline,
)

module.get(
  '/members/:id/shares',
  permission('shares:view'),
  ...tenant,
  requirePermission('shares:view'),
  validate({ params: memberIdSchema }),
  controller.getMemberShares,
)

module.post(
  '/members/:id/shares',
  permission('shares:manage'),
  ...tenant,
  requirePermission('shares:manage'),
  validate({ params: memberIdSchema, body: recordShareSchema }),
  controller.postMemberShare,
)

/**
 * Correcting a share movement recorded in error. A void, never a delete: the movement stays in the
 * history with its reason, and a purchase's income row is reversed rather than removed.
 */
module.post(
  '/members/:id/shares/:shareId/void',
  permission('shares:manage'),
  ...tenant,
  requirePermission('shares:manage'),
  validate({ params: memberShareIdSchema, body: voidSchema }),
  controller.postVoidShare,
)

module.get(
  '/members/:id/contributions',
  permission('contributions:view'),
  ...tenant,
  requirePermission('contributions:view'),
  validate({ params: memberIdSchema }),
  controller.getMemberContributions,
)

module.post(
  '/members/:id/contributions',
  permission('contributions:create'),
  ...tenant,
  requirePermission('contributions:create'),
  validate({ params: memberIdSchema, body: recordContributionSchema }),
  controller.postMemberContribution,
)

module.get(
  '/contributions',
  permission('contributions:view'),
  ...tenant,
  requirePermission('contributions:view'),
  validate({ query: listContributionsSchema }),
  controller.getContributions,
)

module.post(
  '/contributions/:id/void',
  permission('contributions:void'),
  ...tenant,
  requirePermission('contributions:void'),
  validate({ params: memberIdSchema, body: voidSchema }),
  controller.postVoidContribution,
)

export const membersRouter = module.router
