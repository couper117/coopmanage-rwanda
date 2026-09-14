import { z } from 'zod'
import { isRwandanPhone, normalizeRwandanPhone, RWANDA_PROVINCES } from '@coopmanage/shared'

/**
 * Member validators.
 *
 * The product rule that shapes all of this: **a member needs a name and nothing else.** Farmers and
 * ordinary members have no smartphones and often no phone at all, no email, and may not have their
 * national identity card to hand when a secretary registers them at a meeting. Every field except
 * the name is optional, and the joining date defaults to today.
 *
 * Anything optional accepts an empty string and stores null, because a form submits `''` for a
 * field the user left alone and "not given" must not become the literal empty string.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional()

/**
 * A phone number is checked before it is normalised, so a number that cannot be understood is
 * refused rather than quietly turned into null — which would look to the user like the field had
 * been cleared. An empty string genuinely means "not given".
 */
const optionalPhone = z
  .string()
  .trim()
  .refine((value) => value.length === 0 || isRwandanPhone(value), {
    message: 'not a Rwandan mobile number',
  })
  .transform((value) => (value.length === 0 ? null : normalizeRwandanPhone(value)))
  .nullable()
  .optional()

const optionalEmail = z
  .string()
  .trim()
  .refine((value) => value.length === 0 || z.email().safeParse(value).success, {
    message: 'not a valid email address',
  })
  .transform((value) => (value.length === 0 ? null : value.toLowerCase()))
  .nullable()
  .optional()

/**
 * Rwandan national identity numbers are sixteen digits. Spaces are stripped, because that is how
 * they are printed on the card and therefore how they are read out and typed.
 */
const optionalNationalId = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s/g, ''))
  .refine((value) => value.length === 0 || /^\d{16}$/.test(value), {
    message: 'a national identity number is sixteen digits',
  })
  .transform((value) => (value.length === 0 ? null : value))
  .nullable()
  .optional()

export const GENDERS = ['FEMALE', 'MALE', 'OTHER', 'UNSPECIFIED'] as const
export const POSITIONS = [
  'MEMBER',
  'COMMITTEE',
  'SECRETARY',
  'TREASURER',
  'VICE_CHAIR',
  'CHAIRPERSON',
] as const
export const MEMBER_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'EXITED'] as const

export const memberIdSchema = z.object({ id: z.uuid() }).strict()

export const createMemberSchema = z
  .object({
    // The only required fields. Everything else can be filled in later, from the office.
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),

    gender: z.enum(GENDERS).optional(),
    dateOfBirth: z.iso.date().nullable().optional(),
    nationalId: optionalNationalId,
    phone: optionalPhone,
    email: optionalEmail,
    province: z.enum(RWANDA_PROVINCES).nullable().optional(),
    district: optionalText(60),
    sector: optionalText(60),
    cell: optionalText(60),
    village: optionalText(60),
    /** Defaults to today, because that is when a member registered at the desk joined. */
    joinedOn: z.iso.date().optional(),
    position: z.enum(POSITIONS).optional(),
    notes: optionalText(2000),
  })
  .strict()

export type CreateMemberInput = z.infer<typeof createMemberSchema>

export const updateMemberSchema = createMemberSchema
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one field must be provided',
  })

export type UpdateMemberInput = z.infer<typeof updateMemberSchema>

/**
 * A status change, not a deletion. A member is deactivated, suspended or marked as having left;
 * the record and its history always remain, which is what makes the cooperative's books
 * defensible.
 */
export const memberStatusSchema = z
  .object({
    status: z.enum(MEMBER_STATUSES),
    reason: optionalText(280),
    /** Required when the status is EXITED, so the register says when they left. */
    exitedOn: z.iso.date().nullable().optional(),
  })
  .strict()
  .refine((value) => value.status !== 'EXITED' || value.exitedOn != null, {
    // Not merely present: an actual date. An explicit null was being accepted and the service
    // then filled in today, so the register would say a member left today when they left in
    // March. That is exactly the figure a dispute over an old contribution turns on.
    message: 'an exit date is required when a member has left',
    path: ['exitedOn'],
  })

const SORTABLE = [
  'lastName',
  '-lastName',
  'memberCode',
  '-memberCode',
  'joinedOn',
  '-joinedOn',
] as const

export const listMembersSchema = z
  .object({
    /** Free text over name, member code and phone number. */
    q: z.string().trim().max(120).optional(),
    status: z.enum(MEMBER_STATUSES).optional(),
    position: z.enum(POSITIONS).optional(),
    gender: z.enum(GENDERS).optional(),
    district: z.string().trim().max(60).optional(),
    sector: z.string().trim().max(60).optional(),
    joinedFrom: z.iso.date().optional(),
    joinedTo: z.iso.date().optional(),
    /** Members with no phone number are the norm, so filtering on it has to be possible. */
    hasPhone: z.enum(['true', 'false']).optional(),
    sort: z.enum(SORTABLE).default('lastName'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict()
  .refine((value) => !value.joinedFrom || !value.joinedTo || value.joinedFrom <= value.joinedTo, {
    message: 'the end of the range must not be before its start',
    path: ['joinedTo'],
  })

export type ListMembersQuery = z.infer<typeof listMembersSchema>

/**
 * The export takes the same filters as the list, so the file a cooperative downloads contains
 * exactly the rows they were looking at. Declared from the same shape rather than derived from
 * the list schema, because a refined object cannot be narrowed further.
 */
export const exportMembersSchema = z
  .object({
    q: z.string().trim().max(120).optional(),
    status: z.enum(MEMBER_STATUSES).optional(),
    position: z.enum(POSITIONS).optional(),
    gender: z.enum(GENDERS).optional(),
    district: z.string().trim().max(60).optional(),
    sector: z.string().trim().max(60).optional(),
    joinedFrom: z.iso.date().optional(),
    joinedTo: z.iso.date().optional(),
    hasPhone: z.enum(['true', 'false']).optional(),
    sort: z.enum(SORTABLE).default('lastName'),
  })
  .strict()

export const SHARE_TYPES = ['PURCHASE', 'TRANSFER_IN', 'TRANSFER_OUT', 'REDEMPTION'] as const
export const CONTRIBUTION_TYPES = [
  'MEMBERSHIP_FEE',
  'SAVINGS',
  'SHARE_CAPITAL',
  'SPECIAL_LEVY',
  'PENALTY',
  'OTHER',
] as const
export const PAYMENT_METHODS = ['CASH', 'MOBILE_MONEY', 'BANK', 'CHEQUE', 'OTHER'] as const

/**
 * Amounts arrive as strings and are parsed by `lib/money.ts`, never by Zod's number coercion:
 * `z.number()` would put the value through a float on the way in and undo the whole point of the
 * decimal type. Zod checks the shape; money.ts checks the value.
 */
const amountString = z.union([z.string().trim().min(1), z.number()])

export const recordShareSchema = z
  .object({
    type: z.enum(SHARE_TYPES),
    quantity: z.coerce.number().int().min(1).max(1_000_000),
    unitValue: amountString,
    issuedOn: z.iso.date().optional(),
    certificateNo: optionalText(60),
    counterpartyMemberId: z.uuid().nullable().optional(),
    note: optionalText(280),
    /** Required for a purchase: which income category the money lands in. */
    categoryId: z.uuid().optional(),
    method: z.enum(PAYMENT_METHODS).optional(),
  })
  .strict()
  .refine((value) => value.type !== 'PURCHASE' || value.categoryId !== undefined, {
    message: 'a share purchase must say which income category it belongs to',
    path: ['categoryId'],
  })
  .refine(
    (value) =>
      (value.type !== 'TRANSFER_IN' && value.type !== 'TRANSFER_OUT') ||
      value.counterpartyMemberId != null,
    { message: 'a transfer must name the other member', path: ['counterpartyMemberId'] },
  )

export type RecordShareInput = z.infer<typeof recordShareSchema>

export const recordContributionSchema = z
  .object({
    type: z.enum(CONTRIBUTION_TYPES),
    amount: amountString,
    paidOn: z.iso.date().optional(),
    method: z.enum(PAYMENT_METHODS),
    reference: optionalText(60),
    note: optionalText(280),
    categoryId: z.uuid(),
  })
  .strict()

export type RecordContributionInput = z.infer<typeof recordContributionSchema>

export const voidSchema = z.object({ reason: optionalText(280) }).strict()

/** A share movement is addressed by the member it belongs to as well as by its own identifier. */
export const memberShareIdSchema = z.object({ id: z.uuid(), shareId: z.uuid() }).strict()

export const listContributionsSchema = z
  .object({
    memberId: z.uuid().optional(),
    type: z.enum(CONTRIBUTION_TYPES).optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    status: z.enum(['POSTED', 'VOID']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict()
