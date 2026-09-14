import { createModuleRouter, permission } from '../../lib/routeRegistry.js'
import { authenticate } from '../../middleware/authenticate.js'
import { requirePermission } from '../../middleware/requirePermission.js'
import { resolvePlatform } from '../../middleware/resolvePlatform.js'
import { validate } from '../../middleware/validate.js'
import * as controller from './admin.controller.js'
import {
  createCooperativeSchema,
  createUserSchema,
  idParamSchema,
  listCooperativesSchema,
  listUsersSchema,
  putSystemSettingSchema,
  systemSettingKeySchema,
  updateCooperativeStatusSchema,
  updateUserSchema,
} from './admin.schemas.js'

const module = createModuleRouter('/admin')

/**
 * Platform administration. Every route resolves the platform scope rather than a cooperative, so
 * these endpoints act on no tenant. An `X-Cooperative-Id` header is simply ignored here — the
 * client attaches one whenever a cooperative is active, and `resolvePlatform` does not read it.
 *
 * Mutations are written to the audit trail by the service that performs them. List reads are not:
 * an operator opening a list is not an event worth recording, and logging every page view would
 * bury the entries that matter. Reaching *into* a cooperative is different, and that is audited on
 * every request by `resolveCooperative`.
 */
const platform = [authenticate, resolvePlatform] as const

module.get(
  '/cooperatives',
  permission('platform:cooperatives:view'),
  ...platform,
  requirePermission('platform:cooperatives:view'),
  validate({ query: listCooperativesSchema }),
  controller.getCooperatives,
)

module.post(
  '/cooperatives',
  permission('platform:cooperatives:manage'),
  ...platform,
  requirePermission('platform:cooperatives:manage'),
  validate({ body: createCooperativeSchema }),
  controller.postCooperative,
)

module.patch(
  '/cooperatives/:id',
  permission('platform:cooperatives:manage'),
  ...platform,
  requirePermission('platform:cooperatives:manage'),
  validate({ params: idParamSchema, body: updateCooperativeStatusSchema }),
  controller.patchCooperative,
)

module.get(
  '/users',
  permission('platform:users:view'),
  ...platform,
  requirePermission('platform:users:view'),
  validate({ query: listUsersSchema }),
  controller.getUsers,
)

module.post(
  '/users',
  permission('platform:users:manage'),
  ...platform,
  requirePermission('platform:users:manage'),
  validate({ body: createUserSchema }),
  controller.postUser,
)

module.patch(
  '/users/:id',
  permission('platform:users:manage'),
  ...platform,
  requirePermission('platform:users:manage'),
  validate({ params: idParamSchema, body: updateUserSchema }),
  controller.patchUser,
)

module.get(
  '/settings',
  permission('platform:settings:manage'),
  ...platform,
  requirePermission('platform:settings:manage'),
  controller.getSettings,
)

module.put(
  '/settings/:key',
  permission('platform:settings:manage'),
  ...platform,
  requirePermission('platform:settings:manage'),
  validate({ params: systemSettingKeySchema, body: putSystemSettingSchema }),
  controller.putSetting,
)

module.get(
  '/health',
  permission('platform:health:view'),
  ...platform,
  requirePermission('platform:health:view'),
  controller.getHealth,
)

export const adminRouter = module.router
