import { z } from 'zod'
import { LOCALES, RWANDA_PROVINCES, SYSTEM_SETTING_KEYS } from '@coopmanage/shared'

export const idParamSchema = z.object({ id: z.uuid() }).strict()

export const listCooperativesSchema = z
  .object({
    q: z.string().trim().max(120).optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'ARCHIVED']).optional(),
    typeKey: z.string().trim().max(40).optional(),
    includeDemo: z.enum(['true', 'false']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict()

/**
 * Creating a cooperative also creates its first manager, because a cooperative with no manager
 * cannot be administered and would need a second privileged action to become usable. The two are
 * one request and one transaction.
 */
export const createCooperativeSchema = z
  .object({
    name: z.string().trim().min(3).max(160),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z][A-Z0-9-]{2,23}$/, 'upper-case letters, digits and hyphens only'),
    typeKey: z.string().trim().min(2).max(40),
    registrationNumber: z
      .string()
      .trim()
      .max(60)
      .transform((value) => (value.length === 0 ? null : value))
      .nullable()
      .optional(),
    province: z.enum(RWANDA_PROVINCES),
    district: z.string().trim().min(2).max(60),
    sector: z.string().trim().min(2).max(60),
    cell: z.string().trim().min(1).max(60),
    village: z.string().trim().min(1).max(60),
    defaultLocale: z.enum(LOCALES).optional(),
    manager: z
      .object({
        email: z.email().max(160).trim().toLowerCase(),
        fullName: z.string().trim().min(2).max(120),
      })
      .strict(),
  })
  .strict()

export const updateCooperativeStatusSchema = z
  .object({
    status: z.enum(['ACTIVE', 'SUSPENDED', 'ARCHIVED']).optional(),
    name: z.string().trim().min(3).max(160).optional(),
    reason: z
      .string()
      .trim()
      .max(280)
      .transform((value) => (value.length === 0 ? null : value))
      .nullable()
      .optional(),
  })
  .strict()
  .refine((value) => value.status !== undefined || value.name !== undefined, {
    message: 'status or name must be provided',
  })

export const listUsersSchema = z
  .object({
    q: z.string().trim().max(120).optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
    platformAdmin: z.enum(['true', 'false']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict()

export const createUserSchema = z
  .object({
    email: z.email().max(160).trim().toLowerCase(),
    fullName: z.string().trim().min(2).max(120),
    isPlatformAdmin: z.boolean().default(false),
    locale: z.enum(LOCALES).optional(),
  })
  .strict()

export const updateUserSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120).optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
    isPlatformAdmin: z.boolean().optional(),
    reason: z
      .string()
      .trim()
      .max(280)
      .transform((value) => (value.length === 0 ? null : value))
      .nullable()
      .optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.fullName !== undefined ||
      value.status !== undefined ||
      value.isPlatformAdmin !== undefined,
    { message: 'at least one field must be provided' },
  )

export const systemSettingKeySchema = z.object({ key: z.enum(SYSTEM_SETTING_KEYS) }).strict()

export const putSystemSettingSchema = z.object({ value: z.unknown() }).strict()

export const SYSTEM_SETTING_VALIDATORS = {
  defaultCooperativeLocale: z.enum(LOCALES),
} as const
