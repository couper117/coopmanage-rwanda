import { z } from 'zod'
import { ALL_PERMISSIONS, ROLE_KEYS } from '@coopmanage/shared'

/**
 * A staff member may only ever hold a cooperative role. `SYSTEM_ADMIN` is a platform role and is
 * excluded here, so no cooperative can grant platform access to anyone by inviting them.
 */
export const COOPERATIVE_ROLE_KEYS = ROLE_KEYS.filter((key) => key !== 'SYSTEM_ADMIN')

export const staffIdSchema = z.object({ id: z.uuid() }).strict()

export const listStaffSchema = z
  .object({
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
    roleKey: z.enum(COOPERATIVE_ROLE_KEYS as [string, ...string[]]).optional(),
  })
  .strict()

export const inviteStaffSchema = z
  .object({
    email: z.email().max(160).trim().toLowerCase(),
    fullName: z.string().trim().min(2).max(120),
    roleKey: z.enum(COOPERATIVE_ROLE_KEYS as [string, ...string[]]),
    jobTitle: z
      .string()
      .trim()
      .max(80)
      .transform((value) => (value.length === 0 ? null : value))
      .nullable()
      .optional(),
  })
  .strict()

export const updateStaffSchema = z
  .object({
    roleKey: z.enum(COOPERATIVE_ROLE_KEYS as [string, ...string[]]).optional(),
    jobTitle: z
      .string()
      .trim()
      .max(80)
      .transform((value) => (value.length === 0 ? null : value))
      .nullable()
      .optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one field must be provided',
  })

export const deactivateStaffSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .max(280)
      .transform((value) => (value.length === 0 ? null : value))
      .nullable()
      .optional(),
  })
  .strict()

/**
 * Overrides are replaced as a whole set rather than patched one at a time, so the request states
 * the complete intended exception list and two administrators editing at once cannot merge into a
 * combination neither of them chose.
 *
 * Only cooperative-scope permissions may be overridden: a `platform:*` grant here would be a
 * privilege escalation out of the tenant.
 */
export const putOverridesSchema = z
  .object({
    overrides: z
      .array(
        z
          .object({
            permission: z.enum(
              ALL_PERMISSIONS.filter((key) => !key.startsWith('platform:')) as [
                string,
                ...string[],
              ],
            ),
            effect: z.enum(['GRANT', 'DENY']),
            reason: z
              .string()
              .trim()
              .max(280)
              .transform((value) => (value.length === 0 ? null : value))
              .nullable()
              .optional(),
          })
          .strict(),
      )
      .max(60),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.overrides.map((override) => override.permission)).size ===
      value.overrides.length,
    { message: 'each permission may appear only once' },
  )
