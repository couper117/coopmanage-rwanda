import { createModuleRouter, permission } from '../../lib/routeRegistry.js'
import { authenticate } from '../../middleware/authenticate.js'
import { smsSendLimiter } from '../../middleware/rateLimit.js'
import { requirePermission } from '../../middleware/requirePermission.js'
import { resolveCooperative } from '../../middleware/resolveCooperative.js'
import { validate } from '../../middleware/validate.js'
import * as controller from './announcements.controller.js'
import {
  announcementIdSchema,
  archiveAnnouncementSchema,
  createAnnouncementSchema,
  listAnnouncementsSchema,
  publishAnnouncementSchema,
  updateAnnouncementSchema,
} from './announcements.schemas.js'

/**
 * Announcements.
 *
 * Two permissions, and the split is between reading the notice board and writing to it.
 * `announcements:view` reads; `announcements:manage` writes, publishes and archives. Publishing
 * sends messages that cost a cooperative money and reach five hundred telephones, which is not
 * something every role should be able to do.
 */
const module = createModuleRouter('/announcements')

const tenant = [authenticate, resolveCooperative] as const

module.get(
  '/',
  permission('announcements:view'),
  ...tenant,
  requirePermission('announcements:view'),
  validate({ query: listAnnouncementsSchema }),
  controller.getAnnouncements,
)

module.post(
  '/',
  permission('announcements:manage'),
  ...tenant,
  requirePermission('announcements:manage'),
  validate({ body: createAnnouncementSchema }),
  controller.postAnnouncement,
)

module.get(
  '/:id',
  permission('announcements:view'),
  ...tenant,
  requirePermission('announcements:view'),
  validate({ params: announcementIdSchema }),
  controller.getAnnouncement,
)

/** Who it would reach and what it would cost, asked for before anything is sent. */
module.get(
  '/:id/audience',
  permission('announcements:manage'),
  ...tenant,
  requirePermission('announcements:manage'),
  validate({ params: announcementIdSchema }),
  controller.getAudience,
)

module.patch(
  '/:id',
  permission('announcements:manage'),
  ...tenant,
  requirePermission('announcements:manage'),
  validate({ params: announcementIdSchema, body: updateAnnouncementSchema }),
  controller.patchAnnouncement,
)

module.post(
  '/:id/publish',
  permission('announcements:manage'),
  ...tenant,
  // Publishing can send a message to every member, so it carries the same per-cooperative limit
  // as sending directly. The bill is the same bill.
  smsSendLimiter,
  requirePermission('announcements:manage'),
  validate({ params: announcementIdSchema, body: publishAnnouncementSchema }),
  controller.postPublish,
)

module.post(
  '/:id/archive',
  permission('announcements:manage'),
  ...tenant,
  requirePermission('announcements:manage'),
  validate({ params: announcementIdSchema, body: archiveAnnouncementSchema }),
  controller.postArchive,
)

export const announcementsRouter = module.router
