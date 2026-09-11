import { z } from 'zod'

/** Strict: an unrecognised filter is rejected rather than ignored and quietly widening the result. */
export const auditQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(200).optional(),
  action: z.string().trim().min(1).max(80).optional(),
  entityType: z.string().trim().min(1).max(60).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
})

export type AuditQuery = z.infer<typeof auditQuerySchema>
