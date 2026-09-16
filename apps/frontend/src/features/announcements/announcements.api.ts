import { apiRequest, apiRequestCollection } from '@/lib/apiClient'
// The retry key is the books' own helper rather than a second copy of it: publishing an
// announcement spends the cooperative's money in the same way confirming a sale does.
import { newIdempotencyKey } from '@/features/finance/finance.api'

/**
 * Announcements and the messages that carry them.
 *
 * The shape to notice is `PublishResult`: publishing answers with the announcement *and* what
 * happened to every message. A screen that only said "published" would leave a cooperative that
 * has just spent money on five hundred messages with no idea how many arrived.
 */

export const ANNOUNCEMENT_AUDIENCES = ['ALL_MEMBERS', 'ACTIVE_MEMBERS', 'STAFF'] as const
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number]

export const ANNOUNCEMENT_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const
export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number]

export interface AnnouncementRow {
  id: string
  title: string
  titleRw: string | null
  body: string
  bodyRw: string | null
  audience: AnnouncementAudience
  status: AnnouncementStatus
  publishedAt: string | null
  archivedAt: string | null
  archiveReason: string | null
  createdBy: string | null
  publishedBy: string | null
  messageCount: number
  /** What one copy costs to carry, and whether the text forces the expensive alphabet. */
  segments: number
  unicode: boolean
  createdAt: string
  updatedAt: string
}

export interface AudiencePreview {
  audience: AnnouncementAudience
  total: number
  withPhone: number
  withoutPhone: number
  segments: number
  unicode: boolean
  /** False when the live provider records without delivering, so the dialog says so. */
  delivers: boolean
}

export interface SendResult {
  sent: number
  failed: number
  alreadySent: number
  withoutPhone: number
  segments: number
  delivered: boolean
}

export interface PublishResult {
  announcement: AnnouncementRow
  sms: SendResult | null
}

export interface AnnouncementFilters {
  page: number
  pageSize: number
  status?: AnnouncementStatus
  audience?: AnnouncementAudience
  q?: string
}

export interface AnnouncementInput {
  title: string
  titleRw?: string | null
  body: string
  bodyRw?: string | null
  audience: AnnouncementAudience
}

export function listAnnouncements(filters: AnnouncementFilters) {
  return apiRequestCollection<AnnouncementRow>('/announcements', {
    query: {
      page: filters.page,
      pageSize: filters.pageSize,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.audience ? { audience: filters.audience } : {}),
      ...(filters.q ? { q: filters.q } : {}),
    },
  })
}

export function fetchAnnouncement(id: string): Promise<AnnouncementRow> {
  return apiRequest<AnnouncementRow>(`/announcements/${id}`)
}

export function fetchAudience(id: string): Promise<AudiencePreview> {
  return apiRequest<AudiencePreview>(`/announcements/${id}/audience`)
}

export function createAnnouncement(input: AnnouncementInput): Promise<AnnouncementRow> {
  return apiRequest<AnnouncementRow>('/announcements', { method: 'POST', body: input })
}

export function updateAnnouncement(
  id: string,
  input: Partial<AnnouncementInput>,
): Promise<AnnouncementRow> {
  return apiRequest<AnnouncementRow>(`/announcements/${id}`, { method: 'PATCH', body: input })
}

export function publishAnnouncement(id: string, sendSms: boolean): Promise<PublishResult> {
  return apiRequest<PublishResult>(`/announcements/${id}/publish`, {
    method: 'POST',
    body: { sendSms },
    /**
     * Publishing is the request that spends the cooperative's money, so a retry must not send
     * twice. The message log's dedupe key already makes a repeat harmless; this is what makes the
     * *answer* the same, so a secretary whose first attempt appeared to hang is not told
     * "0 sent, 78 already sent".
     */
    idempotencyKey: newIdempotencyKey(),
  })
}

export function archiveAnnouncement(id: string, reason: string): Promise<AnnouncementRow> {
  return apiRequest<AnnouncementRow>(`/announcements/${id}/archive`, {
    method: 'POST',
    body: { reason },
  })
}

// ---------------------------------------------------------------------------
// The message log
// ---------------------------------------------------------------------------

export const SMS_STATUSES = ['QUEUED', 'SENT', 'FAILED'] as const
export type SmsStatus = (typeof SMS_STATUSES)[number]

export interface SmsLogRow {
  id: string
  toPhone: string
  body: string
  status: SmsStatus
  provider: string
  failureReason: string | null
  sentAt: string | null
  createdAt: string
  memberId: string | null
  memberName: string | null
  memberCode: string | null
  announcementId: string | null
  announcementTitle: string | null
}

export interface SmsFilters {
  page: number
  pageSize: number
  status?: SmsStatus
  announcementId?: string
  memberId?: string
}

export function listMessages(filters: SmsFilters) {
  return apiRequestCollection<SmsLogRow>('/sms/messages', {
    query: {
      page: filters.page,
      pageSize: filters.pageSize,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.announcementId ? { announcementId: filters.announcementId } : {}),
      ...(filters.memberId ? { memberId: filters.memberId } : {}),
    },
  })
}

export interface SmsProviderInfo {
  provider: string
  delivers: boolean
}

export function fetchSmsProvider(): Promise<SmsProviderInfo> {
  return apiRequest<SmsProviderInfo>('/sms/provider')
}

export function sendSms(memberIds: string[], body: string): Promise<SendResult> {
  return apiRequest<SendResult>('/sms/send', {
    method: 'POST',
    body: { memberIds, body },
    // Required by the server for this one endpoint, and refused without it: a text cannot be
    // taken back.
    idempotencyKey: newIdempotencyKey(),
  })
}
