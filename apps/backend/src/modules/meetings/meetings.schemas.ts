import { z } from 'zod'

/**
 * Meeting validators.
 *
 * Two shapes of rule here, and the second is the one worth reading.
 *
 * The agenda and the attendance are **replaced whole**, not patched item by item. A secretary
 * editing an agenda reorders it, merges two items and drops a third; sending that as a sequence of
 * per-item operations means the client has to reconstruct positions and the server has to honour a
 * half-applied order. Sending the list as it should now read is both simpler and always consistent.
 *
 * A decision is the opposite: it is created once and then only its status and its follow-up change,
 * because what a meeting resolved is not something a later edit should be able to rewrite.
 */

export const MEETING_TYPES = [
  'GENERAL_ASSEMBLY',
  'BOARD',
  'COMMITTEE',
  'EXTRAORDINARY',
  'OTHER',
] as const

export const MEETING_STATUSES = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const
export const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'EXCUSED'] as const
export const DECISION_TYPES = ['RESOLUTION', 'ACTION', 'NOTE'] as const
export const DECISION_STATUSES = ['OPEN', 'DONE', 'CANCELLED'] as const

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional()

export const meetingIdSchema = z.object({ id: z.uuid() }).strict()
export const decisionIdSchema = z.object({ id: z.uuid(), decisionId: z.uuid() }).strict()

export const createMeetingSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    type: z.enum(MEETING_TYPES).default('GENERAL_ASSEMBLY'),
    /** A moment, not a date: a general assembly is called for two in the afternoon. */
    scheduledFor: z.iso.datetime(),
    endsAt: z.iso.datetime().nullable().optional(),
    location: optionalText(200),
    /**
     * How many members must attend for the meeting to decide anything. Optional because not every
     * cooperative's own rules set one, and inventing a number would be worse than having none.
     */
    quorumRequired: z.coerce.number().int().min(1).max(100_000).nullable().optional(),
    notes: optionalText(4000),
  })
  .strict()
  .refine((value) => !value.endsAt || value.endsAt > value.scheduledFor, {
    message: 'the meeting cannot end before it starts',
    path: ['endsAt'],
  })

export type CreateMeetingInput = z.infer<typeof createMeetingSchema>

/**
 * What can still change about a meeting.
 *
 * The status is not here. Moving a meeting from scheduled to in progress to completed, or
 * cancelling it, is a decision with its own rules and its own endpoint — a completed meeting must
 * not be quietly reopened by a field in a patch.
 */
export const updateMeetingSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    type: z.enum(MEETING_TYPES).optional(),
    scheduledFor: z.iso.datetime().optional(),
    endsAt: z.iso.datetime().nullable().optional(),
    location: optionalText(200),
    quorumRequired: z.coerce.number().int().min(1).max(100_000).nullable().optional(),
    notes: optionalText(4000),
    /** The document holding the minutes. Null detaches it. */
    minutesDocumentId: z.uuid().nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one field must be provided',
  })

export type UpdateMeetingInput = z.infer<typeof updateMeetingSchema>

export const setMeetingStatusSchema = z
  .object({
    status: z.enum(MEETING_STATUSES),
    /** Required when cancelling, which the service enforces and the database insists on. */
    reason: optionalText(280),
  })
  .strict()

export type SetMeetingStatusInput = z.infer<typeof setMeetingStatusSchema>

/**
 * The agenda, in the order it will be taken.
 *
 * Positions are not sent: the array order *is* the order, numbered from one by the server. A client
 * that had to supply positions would be the client that eventually sends two items numbered three.
 */
export const putAgendaSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(200),
            description: optionalText(2000),
            presenterStaffId: z.uuid().nullable().optional(),
          })
          .strict(),
      )
      .max(60),
  })
  .strict()

export type PutAgendaInput = z.infer<typeof putAgendaSchema>

/**
 * Attendance, taken against the register.
 *
 * Each entry names exactly one of a member, a member of staff, or a guest — the same rule a check
 * constraint enforces in the database, because attendance is what makes quorum provable and a row
 * naming two people would make the count ambiguous.
 */
export const putAttendanceSchema = z
  .object({
    entries: z
      .array(
        z
          .object({
            memberId: z.uuid().nullable().optional(),
            staffId: z.uuid().nullable().optional(),
            guestName: z.string().trim().min(1).max(160).nullable().optional(),
            status: z.enum(ATTENDANCE_STATUSES).default('PRESENT'),
            note: optionalText(280),
          })
          .strict()
          .refine(
            (value) =>
              [value.memberId, value.staffId, value.guestName].filter(
                (subject) => subject !== null && subject !== undefined,
              ).length === 1,
            { message: 'name exactly one of a member, a staff member or a guest' },
          ),
      )
      .max(2000),
  })
  .strict()

export type PutAttendanceInput = z.infer<typeof putAttendanceSchema>

export const createDecisionSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: optionalText(4000),
    decisionType: z.enum(DECISION_TYPES).default('RESOLUTION'),
    agendaItemId: z.uuid().nullable().optional(),
    /**
     * Three counts rather than a verdict, because minutes have to show how a decision was carried
     * and not merely that it was.
     */
    votesFor: z.coerce.number().int().min(0).max(100_000).nullable().optional(),
    votesAgainst: z.coerce.number().int().min(0).max(100_000).nullable().optional(),
    abstentions: z.coerce.number().int().min(0).max(100_000).nullable().optional(),
    dueOn: z.iso.date().nullable().optional(),
    responsibleStaffId: z.uuid().nullable().optional(),
  })
  .strict()

export type CreateDecisionInput = z.infer<typeof createDecisionSchema>

/**
 * A decision's follow-up: whether it is done, who is responsible, by when.
 *
 * The title, the description and the votes are not here. What a meeting resolved and how it voted
 * is the minute; a later edit that could change either would make the minute worth nothing.
 */
export const updateDecisionSchema = z
  .object({
    status: z.enum(DECISION_STATUSES).optional(),
    dueOn: z.iso.date().nullable().optional(),
    responsibleStaffId: z.uuid().nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one field must be provided',
  })

export type UpdateDecisionInput = z.infer<typeof updateDecisionSchema>

export const listMeetingsSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    q: z.string().trim().max(120).optional(),
    type: z.enum(MEETING_TYPES).optional(),
    status: z.enum(MEETING_STATUSES).optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    sort: z.enum(['soonest', 'latest']).default('latest'),
  })
  .strict()
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'from must not be after to',
    path: ['from'],
  })

export type ListMeetingsQuery = z.infer<typeof listMeetingsSchema>
