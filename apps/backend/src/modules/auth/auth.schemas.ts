import { z } from 'zod'
import { LOCALES, MAX_PASSWORD_LENGTH } from '@coopmanage/shared'

/**
 * Every schema is strict: an unknown key is rejected rather than stripped. A typo in a field name
 * must fail loudly instead of being silently ignored and leaving the value unchanged.
 *
 * Passwords are bounded but not otherwise shaped here. The real rule lives in
 * `checkPassword` in the shared package and is applied by `assertPasswordAcceptable`, so the
 * message a user sees says which rule they broke rather than "invalid format".
 */

const email = z.string().trim().toLowerCase().min(1).max(255).email()

const rawPassword = z.string().min(1).max(MAX_PASSWORD_LENGTH)

export const loginSchema = z.strictObject({
  email,
  password: rawPassword,
})

export const forgotPasswordSchema = z.strictObject({ email })

export const resetPasswordSchema = z.strictObject({
  token: z.string().min(20).max(200),
  password: rawPassword,
})

export const changePasswordSchema = z.strictObject({
  currentPassword: rawPassword,
  newPassword: rawPassword,
})

export const updateProfileSchema = z
  .strictObject({
    fullName: z.string().trim().min(2).max(120).optional(),
    // Optional and nullable throughout the system: plenty of Rwandan cooperative staff share a
    // phone, and an empty string clears it rather than storing "".
    phone: z
      .string()
      .trim()
      .max(30)
      .regex(/^[\d+\s()-]*$/, 'may contain digits, spaces and + ( ) - only')
      .nullish()
      .transform((value) => (value === undefined ? undefined : value === '' ? null : value)),
    locale: z.enum(LOCALES).optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'provide at least one field to change',
  })

export const sessionIdSchema = z.strictObject({
  id: z.string().uuid(),
})

export type LoginInput = z.infer<typeof loginSchema>
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>
