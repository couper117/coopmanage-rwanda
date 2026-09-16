import { createModuleRouter, permission } from '../../lib/routeRegistry.js'
import { authenticate } from '../../middleware/authenticate.js'
import { smsSendLimiter } from '../../middleware/rateLimit.js'
import { requirePermission } from '../../middleware/requirePermission.js'
import { resolveCooperative } from '../../middleware/resolveCooperative.js'
import { validate } from '../../middleware/validate.js'
import * as controller from './sms.controller.js'
import { listSmsSchema, sendSmsSchema } from './sms.schemas.js'

/**
 * Sending, and the log.
 *
 * `sms:send` guards both, deliberately: the log holds the body of every message a cooperative has
 * sent its members, which can be as sensitive as anything in the register — a reminder about an
 * unpaid contribution names the member and the amount. Somebody who may not send has no business
 * reading what was sent.
 */
const module = createModuleRouter('/sms')

const tenant = [authenticate, resolveCooperative] as const

module.get(
  '/messages',
  permission('sms:send'),
  ...tenant,
  requirePermission('sms:send'),
  validate({ query: listSmsSchema }),
  controller.getMessages,
)

module.get(
  '/provider',
  permission('sms:send'),
  ...tenant,
  requirePermission('sms:send'),
  controller.getProvider,
)

module.post(
  '/send',
  permission('sms:send'),
  ...tenant,
  // After the tenant is resolved, because the limit is the cooperative's and so is the bill.
  smsSendLimiter,
  requirePermission('sms:send'),
  validate({ body: sendSmsSchema }),
  controller.postSend,
)

export const smsRouter = module.router
