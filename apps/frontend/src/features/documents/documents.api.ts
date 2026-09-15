import type { PageMeta } from '@coopmanage/shared'
import {
  apiRequest,
  apiRequestCollection,
  apiRequestFile,
  type DownloadedFile,
} from '@/lib/apiClient'

/**
 * The cooperative's documents, as the interface sees them.
 *
 * One thing shapes this whole file: **a document is never a URL**. There is no address an
 * `<img src>` or an `<a href>` can point at, because a file that could be fetched without the
 * application's headers would be a file outside the application's permission checks. So a preview
 * and a download both go through `apiRequestFile`, which carries the bearer token and the
 * cooperative header, and the bytes arrive as a blob the page holds for as long as it needs them.
 *
 * The consequence is worth knowing when reading the preview component: an object URL has to be
 * created and revoked by hand, and a preview that is open when the reader navigates away has to
 * clean up after itself.
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
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number]

export const DOCUMENT_VISIBILITIES = ['COOPERATIVE', 'RESTRICTED'] as const
export type DocumentVisibility = (typeof DOCUMENT_VISIBILITIES)[number]

export const DOCUMENT_SORTS = ['newest', 'oldest', 'title', 'size'] as const
export type DocumentSort = (typeof DOCUMENT_SORTS)[number]

export const ARCHIVED_FILTERS = ['exclude', 'only', 'include'] as const
export type ArchivedFilter = (typeof ARCHIVED_FILTERS)[number]

export interface DocumentRow {
  id: string
  title: string
  category: DocumentCategory
  fileName: string
  mimeType: string
  /** A decimal string, because a size is a bigint on the server and JSON has no such number. */
  sizeBytes: string
  checksumSha256: string
  visibility: DocumentVisibility
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
  /** Whether the server will serve this type inline. Nothing else decides what may be previewed. */
  canPreview: boolean
  createdAt: string
  updatedAt: string
}

export interface DocumentFilters {
  q: string
  category: DocumentCategory | ''
  memberId: string
  meetingId: string
  archived: ArchivedFilter
  sort: DocumentSort
  page: number
  pageSize: number
}

export const EMPTY_DOCUMENT_FILTERS: DocumentFilters = {
  q: '',
  category: '',
  memberId: '',
  meetingId: '',
  archived: 'exclude',
  sort: 'newest',
  page: 1,
  pageSize: 25,
}

export function countActiveDocumentFilters(filters: DocumentFilters): number {
  let active = 0
  if (filters.q.trim().length > 0) active += 1
  if (filters.category !== '') active += 1
  if (filters.memberId !== '') active += 1
  if (filters.meetingId !== '') active += 1
  if (filters.archived !== 'exclude') active += 1
  return active
}

function documentQuery(filters: DocumentFilters): Record<string, string | number> {
  return {
    page: filters.page,
    pageSize: filters.pageSize,
    sort: filters.sort,
    archived: filters.archived,
    ...(filters.q.trim() ? { q: filters.q.trim() } : {}),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.memberId ? { memberId: filters.memberId } : {}),
    ...(filters.meetingId ? { meetingId: filters.meetingId } : {}),
  }
}

export function listDocuments(
  filters: DocumentFilters,
): Promise<{ items: DocumentRow[]; meta: PageMeta | undefined }> {
  return apiRequestCollection<DocumentRow>('/documents', { query: documentQuery(filters) })
}

export function fetchDocument(id: string): Promise<DocumentRow> {
  return apiRequest<DocumentRow>(`/documents/${id}`)
}

export interface DocumentOptions {
  categories: DocumentCategory[]
  extensions: string[]
  mimeTypes: string[]
}

export function fetchDocumentOptions(): Promise<DocumentOptions> {
  return apiRequest<DocumentOptions>('/documents/options')
}

export interface UploadDocumentInput {
  file: File
  title: string
  category: DocumentCategory
  description: string
  visibility: DocumentVisibility
  memberId: string
  meetingId: string
  /** As typed: a comma-separated list, which the server splits, trims and lower-cases. */
  tags: string
}

/**
 * Uploads a document.
 *
 * The body is `FormData`, so the browser sets the multipart boundary and `apiRequest` is not used:
 * it would serialise the body as JSON and set a content type that does not match. The file is sent
 * under `file`, which is the only field name the endpoint accepts.
 */
export function uploadDocument(input: UploadDocumentInput): Promise<DocumentRow> {
  const form = new FormData()
  form.append('file', input.file, input.file.name)
  form.append('title', input.title)
  form.append('category', input.category)
  form.append('visibility', input.visibility)
  if (input.description.trim()) form.append('description', input.description.trim())
  if (input.memberId) form.append('memberId', input.memberId)
  if (input.meetingId) form.append('meetingId', input.meetingId)
  if (input.tags.trim()) form.append('tags', input.tags.trim())

  return apiRequest<DocumentRow>('/documents', { method: 'POST', body: form })
}

export interface UpdateDocumentInput {
  title?: string
  category?: DocumentCategory
  description?: string | null
  visibility?: DocumentVisibility
  memberId?: string | null
  meetingId?: string | null
  tags?: string[]
}

export function updateDocument(id: string, changes: UpdateDocumentInput): Promise<DocumentRow> {
  return apiRequest<DocumentRow>(`/documents/${id}`, { method: 'PATCH', body: changes })
}

export function archiveDocument(id: string, reason: string): Promise<DocumentRow> {
  return apiRequest<DocumentRow>(`/documents/${id}/archive`, {
    method: 'POST',
    body: { reason },
  })
}

export function restoreDocument(id: string): Promise<DocumentRow> {
  return apiRequest<DocumentRow>(`/documents/${id}/restore`, { method: 'POST' })
}

/** The bytes, as an attachment. */
export function downloadDocument(row: DocumentRow): Promise<DownloadedFile> {
  return apiRequestFile(`/documents/${row.id}/download`, {
    accept: 'application/octet-stream',
    fallbackFilename: row.fileName,
  })
}

/** The bytes, for showing in the page. The server still decides whether a type may be shown. */
export function previewDocument(row: DocumentRow): Promise<DownloadedFile> {
  return apiRequestFile(`/documents/${row.id}/download`, {
    query: { disposition: 'inline' },
    accept: row.mimeType,
    fallbackFilename: row.fileName,
  })
}

/**
 * A file size a person can read.
 *
 * Kilobytes are 1024 bytes, which is what a file manager on the machine shows, so the figure here
 * matches the one the reader sees beside the file they just chose. One decimal place at most: the
 * difference between 2.4 MB and 2.43 MB is of no interest to anybody.
 */
export function formatFileSize(bytes: string): {
  unit: 'bytes' | 'kilobytes' | 'megabytes'
  size: string
} {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value < 1024) {
    return { unit: 'bytes', size: String(Number.isFinite(value) ? value : 0) }
  }
  if (value < 1024 * 1024) {
    return { unit: 'kilobytes', size: (value / 1024).toFixed(value < 10 * 1024 ? 1 : 0) }
  }
  return { unit: 'megabytes', size: (value / (1024 * 1024)).toFixed(1) }
}
