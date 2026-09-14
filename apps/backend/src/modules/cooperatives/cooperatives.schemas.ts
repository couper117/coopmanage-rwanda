import { z } from 'zod'
import {
  COOPERATIVE_SETTING_KEYS,
  isRwandanPhone,
  normalizeRwandanPhone,
  LOCALES,
  OPTIONAL_MODULES,
  RWANDA_PROVINCES,
} from '@coopmanage/shared'

/**
 * Validators for the cooperative profile and its settings. Every object is strict, so an unknown
 * field is rejected rather than silently dropped: a typo in a client must not look like success.
 */

const trimmedString = (max: number) => z.string().trim().min(1).max(max)
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional()

/**
 * Separators are stripped before the digits are checked, so `0788123456`,
 * `+250 788 123 456` and `250-788-123-456` are all accepted and all stored as `+250788123456`.
 * An empty string clears the field.
 */
const phone = z
  .string()
  .trim()
  // Checked before normalising, so a number that cannot be understood is refused rather than
  // quietly turned into null, which would look to the user like the field had been cleared.
  .refine((value) => value.length === 0 || isRwandanPhone(value), {
    message: 'not a Rwandan mobile number',
  })
  .transform((value) => (value.length === 0 ? null : normalizeRwandanPhone(value)))
  .nullable()
  .optional()

export const updateCooperativeSchema = z
  .object({
    name: trimmedString(160).optional(),
    registrationNumber: optionalText(60),
    tinNumber: optionalText(30),
    province: z.enum(RWANDA_PROVINCES).optional(),
    district: trimmedString(60).optional(),
    sector: trimmedString(60).optional(),
    cell: trimmedString(60).optional(),
    village: trimmedString(60).optional(),
    addressLine: optionalText(200),
    phone,
    email: z.email().max(160).nullable().optional(),
    foundedOn: z.iso.date().nullable().optional(),
    defaultLocale: z.enum(LOCALES).optional(),
    memberCodePrefix: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z0-9-]{1,11}$/, 'upper-case letters, digits and hyphens only')
      .optional(),
    fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
  })
  .strict()
  // A PATCH that names no field is a client bug, not a no-op to absorb quietly.
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one field must be provided',
  })

export type UpdateCooperativeInput = z.infer<typeof updateCooperativeSchema>

export const settingKeySchema = z.object({ key: z.enum(COOPERATIVE_SETTING_KEYS) }).strict()

/**
 * One validator per setting key. `PUT /settings/:key` looks the value up here, so a key can never
 * be written with a shape the screens reading it do not expect.
 */
export const COOPERATIVE_SETTING_VALIDATORS = {
  enabledModules: z.array(z.enum(OPTIONAL_MODULES)).max(OPTIONAL_MODULES.length),
} as const

export const putSettingSchema = z.object({ value: z.unknown() }).strict()
