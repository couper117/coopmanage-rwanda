import { createModuleRouter, permission } from '../../lib/routeRegistry.js'
import { authenticate } from '../../middleware/authenticate.js'
import { requirePermission } from '../../middleware/requirePermission.js'
import { resolveCooperative } from '../../middleware/resolveCooperative.js'
import { validate } from '../../middleware/validate.js'
import * as controller from './notifications.controller.js'
import { listNotificationsSchema, notificationIdSchema } from './notifications.schemas.js'

/**
 * The notification centre.
 *
 * One permission, `notifications:view`, and every role has it: a notification is only ever about
 * something the reader can already see, because the module that raised it decided who to address
 * it to. What the permission guards is the centre itself.
 *
 * Marking read and dismissing are writes, and they are guarded by the same permission rather than
 * a separate one. A reader who may see a notification may say they have seen it; a permission to
 * read a list but not to clear it would leave a bell nobody can ever silence.
 */
const module = createModuleRouter('/notifications')

const tenant = [authenticate, resolveCooperative] as const

module.get(
  '/',
  permission('notifications:view'),
  ...tenant,
  requirePermission('notifications:view'),
  validate({ query: listNotificationsSchema }),
  controller.getNotifications,
)

module.get(
  '/summary',
  permission('notifications:view'),
  ...tenant,
  requirePermission('notifications:view'),
  controller.getSummary,
)

module.post(
  '/read-all',
  permission('notifications:view'),
  ...tenant,
  requirePermission('notifications:view'),
  controller.postReadAll,
)

module.post(
  '/:id/read',
  permission('notifications:view'),
  ...tenant,
  requirePermission('notifications:view'),
  validate({ params: notificationIdSchema }),
  controller.postRead,
)

module.post(
  '/:id/dismiss',
  permission('notifications:view'),
  ...tenant,
  requirePermission('notifications:view'),
  validate({ params: notificationIdSchema }),
  controller.postDismiss,
)

export const notificationsRouter = module.router
