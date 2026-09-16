import { z } from 'zod'
import { SMS_SINGLE_SEGMENT } from '../../lib/sms/index.js'

/**
 * Announcement validators.
 *
 * Two things are worth naming. A cooperative may write in either language and is never made to
 * write twice, so one pair of title and body is required and the other is optional. And an
 * announcement's audience is fixed at creation and can be changed only while it is a draft: who a
 * message went to is part of what was sent.
 */

export const ANNOUNCEMENT_AUDIENCES = ['ALL_MEMBERS', 'ACTIVE_MEMBERS', 'STAFF'] as const
export const ANNOUNCEMENT_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const

const title = z.string().trim().min(3).max(140)

/**
 * Four SMS segments.
 *
 * Every announcement can be sent to the members, so the cap is what a message can carry rather
 * than what a notice board could hold. Four segments is a deliberate ceiling and not a technical
 * one: a cooperative paying per segment should be stopped from texting a page of text to five
 * hundred members by accident, and the screen shows the count as it is typed so the limit is never
 * a surprise.
 */
const body = z
  .string()
  .trim()
  .min(3)
  .max(SMS_SINGLE_SEGMENT * 4)

const optional = <T extends z.ZodType<string>>(inner: T) =>
  z
    .union([inner, z.literal('')])
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional()

export const createAnnouncementSchema = z
  .object({
    title,
    titleRw: optional(title),
    body,
    bodyRw: optional(body),
    audience: z.enum(ANNOUNCEMENT_AUDIENCES).default('ACTIVE_MEMBERS'),
  })
  .strict()
export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>

export const updateAnnouncementSchema = z
  .object({
    title: title.optional(),
    titleRw: optional(title),
    body: body.optional(),
    bodyRw: optional(body),
    audience: z.enum(ANNOUNCEMENT_AUDIENCES).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Change at least one field.',
  })
export type UpdateAnnouncementInput = z.infer<typeof updateAnnouncementSchema>

export const publishAnnouncementSchema = z
  .object({
    /**
     * Whether to send it as an SMS as well as publishing it.
     *
     * Explicit and never defaulted to true. A cooperative's members mostly do not have
     * smartphones, so SMS is how they are actually reached — and it costs money per message, so
     * the decision is one somebody takes rather than one the software takes for them.
     */
    sendSms: z.boolean().default(false),
  })
  .strict()
export type PublishAnnouncementInput = z.infer<typeof publishAnnouncementSchema>

export const archiveAnnouncementSchema = z
  .object({
    /** Never optional: a withdrawn notice nobody can explain is one nobody can audit. */
    reason: z.string().trim().min(3).max(280),
  })
  .strict()
export type ArchiveAnnouncementInput = z.infer<typeof archiveAnnouncementSchema>

export const listAnnouncementsSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    status: z.enum(ANNOUNCEMENT_STATUSES).optional(),
    audience: z.enum(ANNOUNCEMENT_AUDIENCES).optional(),
    q: z.string().trim().min(2).max(120).optional(),
  })
  .strict()
export type ListAnnouncementsQuery = z.infer<typeof listAnnouncementsSchema>

export const announcementIdSchema = z.object({ id: z.uuid() }).strict()
