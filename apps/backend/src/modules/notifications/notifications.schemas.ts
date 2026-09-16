import { z } from 'zod'

/**
 * Notification validators.
 *
 * The types and severities are restated here rather than imported from the Prisma client, for the
 * same reason every other module does it: a query parameter is validated against what the API
 * accepts, which is a contract, not against whatever the current schema happens to hold.
 */

export const NOTIFICATION_TYPES = [
  'LOW_STOCK',
  'MEETING_REMINDER',
  'REPORT_READY',
  'MEMBER_INCOMPLETE',
  'DOCUMENT',
  'TASK',
  'SYSTEM',
] as const

export const NOTIFICATION_SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'] as const

export const listNotificationsSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    type: z.enum(NOTIFICATION_TYPES).optional(),
    severity: z.enum(NOTIFICATION_SEVERITIES).optional(),
    /**
     * Dismissed rows are out of the list by default and can be asked for on their own, because
     * "were we warned about this?" is a question asked after the event.
     */
    dismissed: z.enum(['exclude', 'only', 'include']).default('exclude'),
    unreadOnly: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
  })
  .strict()
export type ListNotificationsQuery = z.infer<typeof listNotificationsSchema>

export const notificationIdSchema = z.object({ id: z.uuid() }).strict()
