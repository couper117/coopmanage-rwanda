import { createHash } from 'node:crypto'
import type { Readable } from 'node:stream'
import type { Prisma } from '@prisma/client'
import { writeAudit } from '../../lib/audit.js'
import type { RequestContext } from '../../lib/context.js'
import { AppError } from '../../lib/errors.js'
import { logger } from '../../lib/logger.js'
import { prisma } from '../../lib/prisma.js'
import { newStorageKey, storage, StorageObjectMissing } from '../../lib/storage/index.js'
import { checkFile, FILE_KINDS, type RejectionReason } from './fileTypes.js'
import type {
  ArchiveDocumentInput,
  ListDocumentsQuery,
  UpdateDocumentInput,
  UploadDocumentInput,
} from './documents.schemas.js'

/**
 * The cooperative's filing cabinet.
 *
 * Three rules run through all of it.
 *
 * **Nothing is publicly readable, ever.** There is no URL that serves a file. A download goes
 * through `readDocument`, which resolves the document within the caller's cooperative, applies the
 * visibility rule, and then opens the object. The storage key is random and never leaves the
 * server: it is not in any list response, not in the detail response, and not in a log line.
 *
 * **A document is archived, never deleted.** A registration certificate, a member's contract and a
 * set of minutes are exactly what an auditor asks for years later. Archiving takes a document out
 * of the working list and records who did it, when, and why.
 *
 * **The file is fixed once stored.** Title, category, description, tags and visibility can all
 * change; the bytes, the name, the size and the checksum cannot. A document whose content could be
 * swapped while its history stayed the same would let a new file inherit an old one's provenance,
 * which is worse than having no document store.
 */

function requireCooperativeId(ctx: RequestContext): string {
  const cooperativeId = ctx.cooperative?.id
  if (!cooperativeId) throw AppError.noCooperativeAccess()
  return cooperativeId
}

/** The refusal each rejection reason produces, as a message the interface can translate. */
const REJECTIONS: Readonly<Record<RejectionReason, { key: string; message: string }>> = {
  empty: { key: 'errors.files.empty', message: 'That file is empty.' },
  extension: {
    key: 'errors.files.extensionNotAccepted',
    message: 'That kind of file is not accepted.',
  },
  mimeMismatch: {
    key: 'errors.files.typeMismatch',
    message: 'That file does not match the kind its name says it is.',
  },
  contentMismatch: {
    key: 'errors.files.contentMismatch',
    message: 'That file does not match the kind its name says it is.',
  },
  executable: {
    key: 'errors.files.executable',
    message: 'That file is a program, and programs are never accepted.',
  },
}

export interface DocumentRow {
  id: string
  title: string
  category: string
  fileName: string
  mimeType: string
  /** A string, because a size is a `bigint` in the database and JSON has no such number. */
  sizeBytes: string
  checksumSha256: string
  visibility: string
  memberId: string | null
  memberName: string | null
  meetingId: string | null
  meetingTitle: string | null
  description: string | null
  tags: string[]
  uploadedBy: string | null
  isArchived: boolean
  archivedAt: string | null
  archiveReason: string | null
  /** Whether this type may be shown in the browser rather than only downloaded. */
  canPreview: boolean
  createdAt: string
  updatedAt: string
}

const ROW_SELECT = {
  id: true,
  title: true,
  category: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  checksumSha256: true,
  visibility: true,
  memberId: true,
  meetingId: true,
  description: true,
  tags: true,
  isArchived: true,
  archivedAt: true,
  archiveReason: true,
  createdAt: true,
  updatedAt: true,
  uploadedById: true,
  member: { select: { firstName: true, lastName: true, memberCode: true } },
  meeting: { select: { title: true, reference: true } },
  uploadedBy: { select: { fullName: true } },
} satisfies Prisma.DocumentSelect

type DocumentRecord = Prisma.DocumentGetPayload<{ select: typeof ROW_SELECT }>

/** Whether a stored MIME type is one this application is willing to render in a browser. */
function previewable(mimeType: string): boolean {
  return Object.values(FILE_KINDS).some(
    (kind) => kind.inlineSafe && kind.canonicalMime === mimeType,
  )
}

function toRow(record: DocumentRecord): DocumentRow {
  return {
    id: record.id,
    title: record.title,
    category: record.category,
    fileName: record.fileName,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes.toString(),
    checksumSha256: record.checksumSha256,
    visibility: record.visibility,
    memberId: record.memberId,
    memberName: record.member
      ? `${record.member.lastName} ${record.member.firstName} (${record.member.memberCode})`
      : null,
    meetingId: record.meetingId,
    meetingTitle: record.meeting ? `${record.meeting.title} (${record.meeting.reference})` : null,
    description: record.description,
    tags: record.tags,
    uploadedBy: record.uploadedBy?.fullName ?? null,
    isArchived: record.isArchived,
    archivedAt: record.archivedAt?.toISOString() ?? null,
    archiveReason: record.archiveReason,
    canPreview: previewable(record.mimeType),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

/**
 * The visibility rule, in one place.
 *
 * `COOPERATIVE` is everybody who may see documents at all. `RESTRICTED` narrows it to the person
 * who uploaded it and to staff holding `documents:archive`, which is the custodian permission —
 * whoever is trusted to take a document out of circulation is trusted to read the sensitive ones.
 *
 * Expressed as a `where` clause rather than as a filter after the fact, so a restricted document is
 * not merely hidden from a list but unreachable: the same clause scopes the detail read, the
 * update, the archive and the download, and a caller who may not see it gets "not found" rather
 * than a refusal that confirms it exists.
 */
function visibilityScope(ctx: RequestContext): Prisma.DocumentWhereInput {
  if (ctx.permissions.has('documents:archive')) return {}
  return {
    OR: [{ visibility: 'COOPERATIVE' }, { uploadedById: ctx.user.id }],
  }
}

function scopeFor(ctx: RequestContext, id?: string): Prisma.DocumentWhereInput {
  return {
    cooperativeId: requireCooperativeId(ctx),
    ...(id ? { id } : {}),
    ...visibilityScope(ctx),
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function listDocuments(
  ctx: RequestContext,
  query: ListDocumentsQuery,
): Promise<{ items: DocumentRow[]; total: number }> {
  const where: Prisma.DocumentWhereInput = {
    ...scopeFor(ctx),
    ...(query.category ? { category: query.category } : {}),
    ...(query.memberId ? { memberId: query.memberId } : {}),
    ...(query.meetingId ? { meetingId: query.meetingId } : {}),
    ...(query.archived === 'exclude' ? { isArchived: false } : {}),
    ...(query.archived === 'only' ? { isArchived: true } : {}),
    ...(query.q
      ? {
          OR: [
            { title: { contains: query.q, mode: 'insensitive' } },
            { fileName: { contains: query.q, mode: 'insensitive' } },
            { description: { contains: query.q, mode: 'insensitive' } },
            // A tag match is exact and lower-cased, because tags are stored lower-cased. A
            // partial tag match would make the tag list useless as a filter.
            { tags: { has: query.q.toLowerCase() } },
          ],
        }
      : {}),
  }

  const orderBy: Prisma.DocumentOrderByWithRelationInput =
    query.sort === 'oldest'
      ? { createdAt: 'asc' }
      : query.sort === 'title'
        ? { title: 'asc' }
        : query.sort === 'size'
          ? { sizeBytes: 'desc' }
          : { createdAt: 'desc' }

  const [records, total] = await Promise.all([
    prisma.document.findMany({
      where,
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: ROW_SELECT,
    }),
    prisma.document.count({ where }),
  ])

  return { items: records.map(toRow), total }
}

export async function getDocument(ctx: RequestContext, id: string): Promise<DocumentRow> {
  const record = await prisma.document.findFirst({ where: scopeFor(ctx, id), select: ROW_SELECT })
  // Not found rather than refused, for a document of another cooperative and for a restricted one
  // this reader may not see: neither should learn that it exists.
  if (!record) throw AppError.notFound()
  return toRow(record)
}

export interface DocumentStream {
  stream: Readable
  fileName: string
  mimeType: string
  sizeBytes: string
  /** `inline` only for a type this application will render, whatever the caller asked for. */
  disposition: 'attachment' | 'inline'
}

/**
 * Opens a document's bytes for streaming.
 *
 * The permission and the tenant are checked before the store is touched, and the store is reached
 * by a key the caller has never seen. A request for `inline` is honoured only for a type on the
 * inline-safe list — a PDF or an image — because serving an uploaded file inline is how a document
 * store becomes a way to run script on a cooperative's own domain.
 */
export async function readDocument(
  ctx: RequestContext,
  id: string,
  disposition: 'attachment' | 'inline',
): Promise<DocumentStream> {
  const record = await prisma.document.findFirst({
    where: scopeFor(ctx, id),
    select: {
      id: true,
      storageKey: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      title: true,
    },
  })
  if (!record) throw AppError.notFound()

  let stream: Readable
  try {
    stream = await storage().read(record.storageKey)
  } catch (error) {
    if (error instanceof StorageObjectMissing) {
      // The row is there and the bytes are not. Logged at error level because it means the store
      // and the database have diverged, which no ordinary use produces, and answered as a
      // service failure rather than a 404: the document exists, it just cannot be served.
      logger.error(
        { documentId: record.id, cooperativeId: ctx.cooperative?.id },
        'a document row has no stored file',
      )
      throw AppError.serviceUnavailable(
        'errors.files.missingContent',
        'The file behind this document could not be found in storage.',
      )
    }
    throw error
  }

  await writeAudit(
    { ctx },
    {
      action: 'document.downloaded',
      entityType: 'Document',
      entityId: record.id,
      messageKey: 'audit.document.downloaded',
      messageParams: { title: record.title, fileName: record.fileName },
    },
  )

  return {
    stream,
    fileName: record.fileName,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes.toString(),
    disposition: disposition === 'inline' && previewable(record.mimeType) ? 'inline' : 'attachment',
  }
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface UploadedFile {
  originalName: string
  declaredMime: string
  bytes: Buffer
}

/**
 * Stores a file and records it.
 *
 * The order matters and is the opposite of the obvious one. The content is validated first, then
 * the bytes are written to the store, and only then is the row created — and if the row fails, the
 * object is removed again. A row written first would leave a document in a cooperative's list with
 * nothing behind it; bytes written and never recorded are invisible to everything and cost only
 * disk, which a later sweep can reclaim.
 */
export async function uploadDocument(
  ctx: RequestContext,
  file: UploadedFile,
  input: UploadDocumentInput,
): Promise<DocumentRow> {
  const cooperativeId = requireCooperativeId(ctx)

  const check = checkFile({
    fileName: file.originalName,
    declaredMime: file.declaredMime,
    bytes: file.bytes,
  })
  if (!check.ok) {
    const rejection = REJECTIONS[check.reason]
    throw AppError.unsupportedFile(rejection.key, rejection.message, {
      extension: check.extension,
    })
  }

  // Both identifiers are resolved within this cooperative, so a document cannot be filed against
  // another cooperative's member or meeting by supplying its identifier.
  if (input.memberId) await requireMember(cooperativeId, input.memberId)
  if (input.meetingId) await requireMeeting(cooperativeId, input.meetingId)

  const checksum = createHash('sha256').update(file.bytes).digest('hex')
  const key = newStorageKey()

  await storage().put(key, file.bytes, check.kind.canonicalMime)

  try {
    const record = await prisma.document.create({
      data: {
        cooperativeId,
        title: input.title,
        category: input.category,
        fileName: check.fileName,
        storageKey: key,
        // The canonical type, not the one the client declared: what is served later is decided by
        // what the content actually is.
        mimeType: check.kind.canonicalMime,
        sizeBytes: BigInt(file.bytes.length),
        checksumSha256: checksum,
        visibility: input.visibility,
        memberId: input.memberId ?? null,
        meetingId: input.meetingId ?? null,
        description: input.description ?? null,
        tags: input.tags ?? [],
        uploadedById: ctx.user.id,
      },
      select: ROW_SELECT,
    })

    await writeAudit(
      { ctx },
      {
        action: 'document.uploaded',
        entityType: 'Document',
        entityId: record.id,
        messageKey: 'audit.document.uploaded',
        messageParams: {
          title: record.title,
          fileName: record.fileName,
          category: `documents.category.${record.category}`,
        },
      },
    )

    return toRow(record)
  } catch (error) {
    // The row did not happen, so the object must not survive it. Failing to clean up is logged
    // rather than thrown: the caller's error is the one worth reporting.
    await storage()
      .remove(key)
      .catch((failure: unknown) => {
        logger.error({ err: failure, key }, 'could not remove an orphaned uploaded file')
      })
    throw error
  }
}

async function requireMember(cooperativeId: string, memberId: string): Promise<void> {
  const member = await prisma.member.findFirst({
    where: { id: memberId, cooperativeId },
    select: { id: true },
  })
  if (!member) throw AppError.notFound()
}

async function requireMeeting(cooperativeId: string, meetingId: string): Promise<void> {
  const meeting = await prisma.meeting.findFirst({
    where: { id: meetingId, cooperativeId },
    select: { id: true },
  })
  if (!meeting) throw AppError.notFound()
}

export async function updateDocument(
  ctx: RequestContext,
  id: string,
  changes: UpdateDocumentInput,
): Promise<DocumentRow> {
  const cooperativeId = requireCooperativeId(ctx)
  const existing = await prisma.document.findFirst({
    where: scopeFor(ctx, id),
    select: { id: true, isArchived: true, title: true },
  })
  if (!existing) throw AppError.notFound()

  // An archived document is the historical record. Editing its title or its category would change
  // what the history says, so the archive has to be lifted first — which is itself recorded.
  if (existing.isArchived) {
    throw AppError.conflict(
      'errors.documents.archivedIsReadOnly',
      'This document is archived. Restore it before changing its details.',
    )
  }

  if (changes.memberId) await requireMember(cooperativeId, changes.memberId)
  if (changes.meetingId) await requireMeeting(cooperativeId, changes.meetingId)

  const record = await prisma.document.update({
    where: { id: existing.id },
    data: {
      ...(changes.title === undefined ? {} : { title: changes.title }),
      ...(changes.category === undefined ? {} : { category: changes.category }),
      ...(changes.description === undefined ? {} : { description: changes.description }),
      ...(changes.visibility === undefined ? {} : { visibility: changes.visibility }),
      ...(changes.memberId === undefined ? {} : { memberId: changes.memberId }),
      ...(changes.meetingId === undefined ? {} : { meetingId: changes.meetingId }),
      ...(changes.tags === undefined ? {} : { tags: changes.tags }),
    },
    select: ROW_SELECT,
  })

  await writeAudit(
    { ctx },
    {
      action: 'document.updated',
      entityType: 'Document',
      entityId: record.id,
      messageKey: 'audit.document.updated',
      messageParams: { title: record.title },
    },
  )

  return toRow(record)
}

/**
 * Takes a document out of the working list.
 *
 * Not a delete, and there is no delete anywhere in this module. The reason is required and stored:
 * "archived" with nothing beside it is the same question at the next audit as a row that simply
 * disappeared.
 */
export async function archiveDocument(
  ctx: RequestContext,
  id: string,
  input: ArchiveDocumentInput,
): Promise<DocumentRow> {
  const existing = await prisma.document.findFirst({
    where: scopeFor(ctx, id),
    select: { id: true, isArchived: true, title: true },
  })
  if (!existing) throw AppError.notFound()

  if (existing.isArchived) {
    throw AppError.conflict(
      'errors.documents.alreadyArchived',
      'This document is already archived.',
    )
  }

  // A document that is a meeting's minutes cannot be archived while the meeting points at it: the
  // minutes are the record of that meeting, and a working meeting with archived minutes reads as a
  // meeting whose minutes were withdrawn.
  const minutesOf = await prisma.meeting.findFirst({
    where: { minutesDocumentId: existing.id },
    select: { reference: true },
  })
  if (minutesOf) {
    throw AppError.conflict(
      'errors.documents.isMinutes',
      `This document is the minutes of meeting ${minutesOf.reference}. Detach it from the meeting first.`,
    )
  }

  const record = await prisma.document.update({
    where: { id: existing.id },
    data: {
      isArchived: true,
      archivedAt: new Date(),
      archivedById: ctx.user.id,
      archiveReason: input.reason,
    },
    select: ROW_SELECT,
  })

  await writeAudit(
    { ctx },
    {
      action: 'document.archived',
      entityType: 'Document',
      entityId: record.id,
      messageKey: 'audit.document.archived',
      messageParams: { title: record.title, reason: input.reason },
    },
  )

  return toRow(record)
}

/** Brings an archived document back into the working list. Recorded, like the archiving was. */
export async function restoreDocument(ctx: RequestContext, id: string): Promise<DocumentRow> {
  const existing = await prisma.document.findFirst({
    where: scopeFor(ctx, id),
    select: { id: true, isArchived: true, title: true },
  })
  if (!existing) throw AppError.notFound()

  if (!existing.isArchived) {
    throw AppError.conflict('errors.documents.notArchived', 'This document is not archived.')
  }

  const record = await prisma.document.update({
    where: { id: existing.id },
    data: { isArchived: false, archivedAt: null, archivedById: null, archiveReason: null },
    select: ROW_SELECT,
  })

  await writeAudit(
    { ctx },
    {
      action: 'document.restored',
      entityType: 'Document',
      entityId: record.id,
      messageKey: 'audit.document.restored',
      messageParams: { title: record.title },
    },
  )

  return toRow(record)
}

/** What the upload form needs: the categories, the accepted types and the size cap. */
export function documentFormOptions(): {
  categories: readonly string[]
  extensions: readonly string[]
  mimeTypes: readonly string[]
} {
  const kinds = Object.values(FILE_KINDS)
  return {
    categories: [
      'REGISTRATION',
      'FINANCIAL',
      'MEMBER',
      'CONTRACT',
      'CERTIFICATE',
      'MEETING_MINUTES',
      'REPORT',
      'OTHER',
    ],
    extensions: kinds.flatMap((kind) => kind.extensions),
    mimeTypes: Array.from(new Set(kinds.flatMap((kind) => kind.mimeTypes))),
  }
}
