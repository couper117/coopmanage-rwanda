import { AUTHENTICATED, createModuleRouter, permission } from '../../lib/routeRegistry.js'
import { authenticate } from '../../middleware/authenticate.js'
import { requirePermission } from '../../middleware/requirePermission.js'
import { resolveCooperative } from '../../middleware/resolveCooperative.js'
import { validate } from '../../middleware/validate.js'
import * as controller from './cooperatives.controller.js'
import {
  putSettingSchema,
  settingKeySchema,
  updateCooperativeSchema,
} from './cooperatives.schemas.js'

const module = createModuleRouter('')

/**
 * The caller's own memberships. Self-scoped rather than permission-gated: this is the list the
 * cooperative switcher is built from, and a user must be able to see which cooperatives they
 * belong to before they have chosen one. It never names a cooperative the caller is not staff of.
 */
module.get('/cooperatives/mine', AUTHENTICATED, authenticate, controller.getMine)

module.get(
  '/cooperatives/current',
  permission('cooperative:view'),
  authenticate,
  resolveCooperative,
  requirePermission('cooperative:view'),
  controller.getCurrent,
)

// There is no `/cooperatives/:id`. The active cooperative comes from the resolved header and never
// from a path parameter, so there is no identifier for a caller to substitute.
module.patch(
  '/cooperatives/current',
  permission('cooperative:update'),
  authenticate,
  resolveCooperative,
  requirePermission('cooperative:update'),
  validate({ body: updateCooperativeSchema }),
  controller.patchCurrent,
)

module.get(
  '/settings',
  permission('cooperative:view'),
  authenticate,
  resolveCooperative,
  requirePermission('cooperative:view'),
  controller.getSettings,
)

module.put(
  '/settings/:key',
  permission('settings:manage'),
  authenticate,
  resolveCooperative,
  requirePermission('settings:manage'),
  validate({ params: settingKeySchema, body: putSettingSchema }),
  controller.putSetting,
)

export const cooperativesRouter = module.router
