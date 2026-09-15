import { z } from 'zod'

/**
 * Document validators.
 *
 * The file itself is not validated here. Zod checks the shape of a value; a file's shape is its
 * first bytes, and that check lives in `fileTypes.ts` where the extension, the declared type and
 * the content are compared against each other. What this file validates is everything typed
 * alongside the upload.
 *
 * Upload metadata arrives as multipart text fields, so every value is a string on the wire. The
 * coercions below are the price of that, and they are narrow on purpose: `tags` accepts a
 * comma-separated list because that is what a form field can carry, and nothing accepts a value it
 * cannot use.
 */

export const DOCUMENT_CATEGORIES = [
  'REGISTRATION',
  'FINANCIAL',
  'MEMBER',
  'CONTRACT',
  'CERTIFICATE',
  'MEETING_MINUTES',
  'REPORT',
  'OTHER',
] as const

export const DOCUMENT_VISIBILITIES = ['COOPERATIVE', 'RESTRICTED'] as const

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional()

/** An optional identifier from a form field, where an empty field means "not set". */
const optionalUuid = z
  .string()
  .trim()
  .transform((value) => (value.length === 0 ? null : value))
  .nullable()
  .optional()
  .refine(
    (value) =>
      value === null ||
      value === undefined ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
    { message: 'must be an identifier' },
  )

/**
 * Tags as a form field: `land, title, 2026`.
 *
 * Trimmed, emptied entries dropped, lower-cased so a search for "contract" finds "Contract", and
 * de-duplicated. Capped at ten, because a document with thirty tags has none.
 */
const tagList = z
  .string()
  .max(400)
  .transform((value) =>
    Array.from(
      new Set(
        value
          .split(',')
          .map((tag) => tag.trim().toLowerCase())
          .filter((tag) => tag.length > 0 && tag.length <= 40),
      ),
    ).slice(0, 10),
  )
  .optional()

export const uploadDocumentSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    category: z.enum(DOCUMENT_CATEGORIES).default('OTHER'),
    description: optionalText(2000),
    visibility: z.enum(DOCUMENT_VISIBILITIES).default('COOPERATIVE'),
    memberId: optionalUuid,
    meetingId: optionalUuid,
    tags: tagList,
  })
  .strict()

export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>

/**
 * What can be changed after the fact: everything except the file.
 *
 * The bytes, the name, the size and the checksum are fixed for good. A document whose content could
 * be swapped while its title and its history stayed the same would be worse than no document store
 * at all — the new file would inherit the old one's provenance. A corrected version is a new upload,
 * and the old one is archived.
 */
export const updateDocumentSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    category: z.enum(DOCUMENT_CATEGORIES).optional(),
    description: optionalText(2000),
    visibility: z.enum(DOCUMENT_VISIBILITIES).optional(),
    memberId: z.uuid().nullable().optional(),
    meetingId: z.uuid().nullable().optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one field must be provided',
  })

export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>

export const archiveDocumentSchema = z
  .object({
    reason: z.string().trim().min(1).max(280),
  })
  .strict()

export type ArchiveDocumentInput = z.infer<typeof archiveDocumentSchema>

export const documentIdSchema = z.object({ id: z.uuid() }).strict()

export const DOCUMENT_SORTS = ['newest', 'oldest', 'title', 'size'] as const

export const listDocumentsSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    /** Matches the title, the filename, the description and the tags. */
    q: z.string().trim().max(120).optional(),
    category: z.enum(DOCUMENT_CATEGORIES).optional(),
    memberId: z.uuid().optional(),
    meetingId: z.uuid().optional(),
    /**
     * Archived documents are out of the list by default and never gone. A cooperative looking for
     * last year's superseded contract has to be able to find it, so the filter is a switch rather
     * than the absence of one.
     */
    archived: z.enum(['exclude', 'only', 'include']).default('exclude'),
    sort: z.enum(DOCUMENT_SORTS).default('newest'),
  })
  .strict()

export type ListDocumentsQuery = z.infer<typeof listDocumentsSchema>

/** A download is an attachment unless the caller asks for a preview and the type allows one. */
export const downloadDocumentSchema = z
  .object({
    disposition: z.enum(['attachment', 'inline']).default('attachment'),
  })
  .strict()

export type DownloadDocumentQuery = z.infer<typeof downloadDocumentSchema>
