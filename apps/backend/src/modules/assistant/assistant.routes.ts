import { createModuleRouter, permission } from '../../lib/routeRegistry.js'
import { authenticate } from '../../middleware/authenticate.js'
import { assistantAskLimiter } from '../../middleware/rateLimit.js'
import { requirePermission } from '../../middleware/requirePermission.js'
import { resolveCooperative } from '../../middleware/resolveCooperative.js'
import { validate } from '../../middleware/validate.js'
import * as controller from './assistant.controller.js'
import { askSchema, listThreadsSchema, threadIdSchema } from './assistant.schemas.js'

/**
 * Ask CoopManage.
 *
 * `assistant:use` opens it, and every role has it — but what a reader can *learn* from it is
 * decided by the rest of their permissions, because the tool catalogue is filtered by them before
 * a question is even read. A storekeeper and an accountant asking the same question about money
 * get different answers: one a figure, the other a refusal.
 *
 * Asking is rate limited per user and again per cooperative, because a model-backed planner will
 * cost money per question and the limit has to be in place before the planner that charges is.
 * `docs/api.md` §1 carries the figures.
 */
const module = createModuleRouter('/assistant')

const tenant = [authenticate, resolveCooperative] as const

module.post(
  '/ask',
  permission('assistant:use'),
  ...tenant,
  assistantAskLimiter,
  requirePermission('assistant:use'),
  validate({ body: askSchema }),
  controller.postAsk,
)

module.get(
  '/catalogue',
  permission('assistant:use'),
  ...tenant,
  requirePermission('assistant:use'),
  controller.getCatalogue,
)

module.get(
  '/threads',
  permission('assistant:use'),
  ...tenant,
  requirePermission('assistant:use'),
  validate({ query: listThreadsSchema }),
  controller.getThreads,
)

module.get(
  '/threads/:id',
  permission('assistant:use'),
  ...tenant,
  requirePermission('assistant:use'),
  validate({ params: threadIdSchema }),
  controller.getThread,
)

export const assistantRouter = module.router
