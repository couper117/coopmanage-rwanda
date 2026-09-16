import { z } from 'zod'
import { SMS_SINGLE_SEGMENT } from '../../lib/sms/index.js'

/**
 * SMS validators.
 *
 * The body cap is four segments. Not a technical limit — a gateway will carry more — but a
 * deliberate one: a cooperative paying per segment should be stopped from sending a page of text
 * to five hundred members by accident, and anything longer than four segments is a document rather
 * than a message. The screen shows the segment count as it is typed, so the cap is never a
 * surprise.
 */
const MAX_SEGMENTS = 4

export const sendSmsSchema = z
  .object({
    memberIds: z.array(z.uuid()).min(1).max(500),
    body: z
      .string()
      .trim()
      .min(3)
      .max(SMS_SINGLE_SEGMENT * MAX_SEGMENTS),
  })
  .strict()
export type SendSmsInput = z.infer<typeof sendSmsSchema>

export const SMS_STATUSES = ['QUEUED', 'SENT', 'FAILED'] as const

export const listSmsSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    status: z.enum(SMS_STATUSES).optional(),
    announcementId: z.uuid().optional(),
    memberId: z.uuid().optional(),
  })
  .strict()
export type ListSmsQuery = z.infer<typeof listSmsSchema>
