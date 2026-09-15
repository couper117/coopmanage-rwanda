import { createModuleRouter, permission } from '../../lib/routeRegistry.js'
import { authenticate } from '../../middleware/authenticate.js'
import { requirePermission } from '../../middleware/requirePermission.js'
import { resolveCooperative } from '../../middleware/resolveCooperative.js'
import { validate } from '../../middleware/validate.js'
import * as controller from './meetings.controller.js'
import {
  createDecisionSchema,
  createMeetingSchema,
  decisionIdSchema,
  listMeetingsSchema,
  meetingIdSchema,
  putAgendaSchema,
  putAttendanceSchema,
  setMeetingStatusSchema,
  updateDecisionSchema,
  updateMeetingSchema,
} from './meetings.schemas.js'

const module = createModuleRouter('/meetings')

const tenant = [authenticate, resolveCooperative] as const

/**
 * Meetings.
 *
 * `meetings:view` reads; `meetings:manage` writes. A secretary holds both, because calling the
 * assembly and keeping its minutes is their job; an accountant holds only the first, because the
 * figures they present are discussed at a meeting they do not run.
 *
 * There is no `DELETE`. A meeting that will not happen is cancelled with a reason, which the
 * database insists on, and stays in the record — a cooperative's minute book has no missing
 * numbers, and a meeting that could be removed would leave one.
 *
 * The agenda and the attendance are `PUT`, not a set of per-item operations: what is sent is the
 * list as it should now read. A half-applied reorder would leave two items claiming one position.
 *
 * `/meetings/options` is registered before `/meetings/:id`, so it is not read as a meeting whose
 * identifier is the word "options".
 */
module.get(
  '/',
  permission('meetings:view'),
  ...tenant,
  requirePermission('meetings:view'),
  validate({ query: listMeetingsSchema }),
  controller.getMeetings,
)

/** The register and the staff list, for taking attendance. */
module.get(
  '/options',
  permission('meetings:manage'),
  ...tenant,
  requirePermission('meetings:manage'),
  controller.getOptions,
)

module.post(
  '/',
  permission('meetings:manage'),
  ...tenant,
  requirePermission('meetings:manage'),
  validate({ body: createMeetingSchema }),
  controller.postMeeting,
)

module.get(
  '/:id',
  permission('meetings:view'),
  ...tenant,
  requirePermission('meetings:view'),
  validate({ params: meetingIdSchema }),
  controller.getOne,
)

module.patch(
  '/:id',
  permission('meetings:manage'),
  ...tenant,
  requirePermission('meetings:manage'),
  validate({ params: meetingIdSchema, body: updateMeetingSchema }),
  controller.patchMeeting,
)

/** Scheduled, under way, completed or cancelled. A completed meeting does not reopen. */
module.post(
  '/:id/status',
  permission('meetings:manage'),
  ...tenant,
  requirePermission('meetings:manage'),
  validate({ params: meetingIdSchema, body: setMeetingStatusSchema }),
  controller.postStatus,
)

module.put(
  '/:id/agenda',
  permission('meetings:manage'),
  ...tenant,
  requirePermission('meetings:manage'),
  validate({ params: meetingIdSchema, body: putAgendaSchema }),
  controller.putMeetingAgenda,
)

module.put(
  '/:id/attendance',
  permission('meetings:manage'),
  ...tenant,
  requirePermission('meetings:manage'),
  validate({ params: meetingIdSchema, body: putAttendanceSchema }),
  controller.putMeetingAttendance,
)

module.post(
  '/:id/decisions',
  permission('meetings:manage'),
  ...tenant,
  requirePermission('meetings:manage'),
  validate({ params: meetingIdSchema, body: createDecisionSchema }),
  controller.postDecision,
)

/**
 * A decision's follow-up only: done, who is responsible, by when. What the meeting resolved and how
 * it voted is fixed, which is why the schema accepts neither.
 */
module.patch(
  '/:id/decisions/:decisionId',
  permission('meetings:manage'),
  ...tenant,
  requirePermission('meetings:manage'),
  validate({ params: decisionIdSchema, body: updateDecisionSchema }),
  controller.patchDecision,
)

export const meetingsRouter = module.router
