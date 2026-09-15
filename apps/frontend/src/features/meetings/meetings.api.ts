import type { PageMeta } from '@coopmanage/shared'
import { apiRequest, apiRequestCollection } from '@/lib/apiClient'

/**
 * Meetings, as the interface sees them.
 *
 * Two things carry over from the server's design and shape every screen built on this.
 *
 * **The agenda and the attendance are sent whole.** A `PUT` of the list as it should now read,
 * not a sequence of add, move and remove. So the screens hold the whole list in local state while
 * it is being edited and send it once — which is also why they can offer "move up" and "remove"
 * without a request each.
 *
 * **Quorum is a figure the server computes.** `presentCount`, `quorumRequired` and `quorumMet`
 * come back with every meeting and nothing here recalculates them. `quorumMet` is `null` where no
 * quorum is set, which the screens must show as "not required" rather than "not met".
 */

export const MEETING_TYPES = [
  'GENERAL_ASSEMBLY',
  'BOARD',
  'COMMITTEE',
  'EXTRAORDINARY',
  'OTHER',
] as const
export type MeetingType = (typeof MEETING_TYPES)[number]

export const MEETING_STATUSES = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const
export type MeetingStatus = (typeof MEETING_STATUSES)[number]

export const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'EXCUSED'] as const
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number]

export const DECISION_TYPES = ['RESOLUTION', 'ACTION', 'NOTE'] as const
export type DecisionType = (typeof DECISION_TYPES)[number]

export const DECISION_STATUSES = ['OPEN', 'DONE', 'CANCELLED'] as const
export type DecisionStatus = (typeof DECISION_STATUSES)[number]

/** The statuses a meeting may move to from where it is. Mirrors the server, which enforces it. */
export const NEXT_STATUSES: Readonly<Record<MeetingStatus, readonly MeetingStatus[]>> = {
  SCHEDULED: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
}

/** True when a meeting's record is closed: its agenda, attendance and decisions are fixed. */
export function isClosed(status: MeetingStatus): boolean {
  return status === 'COMPLETED' || status === 'CANCELLED'
}

export interface AgendaItemRow {
  id: string
  position: number
  title: string
  description: string | null
  presenterStaffId: string | null
  presenterName: string | null
}

export interface AttendeeRow {
  id: string
  memberId: string | null
  staffId: string | null
  guestName: string | null
  name: string
  status: AttendanceStatus
  note: string | null
}

export interface DecisionRow {
  id: string
  agendaItemId: string | null
  title: string
  description: string | null
  decisionType: DecisionType
  votesFor: number | null
  votesAgainst: number | null
  abstentions: number | null
  dueOn: string | null
  responsibleStaffId: string | null
  responsibleName: string | null
  status: DecisionStatus
  createdAt: string
}

export interface MeetingRow {
  id: string
  reference: string
  title: string
  type: MeetingType
  scheduledFor: string
  endsAt: string | null
  location: string | null
  status: MeetingStatus
  quorumRequired: number | null
  notes: string | null
  cancelReason: string | null
  minutesDocumentId: string | null
  minutesTitle: string | null
  createdBy: string | null
  /** Everybody marked present: members, staff and guests. Who was in the room. */
  presentCount: number
  /**
   * Members marked present, which is the only figure quorum is measured against. A guest or a
   * member of staff is in the room and is not a member, and counting either towards the quorum
   * would let an assembly reach one without the members it needs.
   */
  memberPresentCount: number
  attendeeCount: number
  agendaCount: number
  decisionCount: number
  /** Null where the cooperative's rules set no quorum: "not required", not "not met". */
  quorumMet: boolean | null
  createdAt: string
  updatedAt: string
}

export interface MeetingDetail extends MeetingRow {
  agenda: AgendaItemRow[]
  attendees: AttendeeRow[]
  decisions: DecisionRow[]
  documents: { id: string; title: string; fileName: string; category: string }[]
}

export interface MeetingFilters {
  q: string
  type: MeetingType | ''
  status: MeetingStatus | ''
  from: string
  to: string
  sort: 'soonest' | 'latest'
  page: number
  pageSize: number
}

export const EMPTY_MEETING_FILTERS: MeetingFilters = {
  q: '',
  type: '',
  status: '',
  from: '',
  to: '',
  sort: 'latest',
  page: 1,
  pageSize: 25,
}

export function countActiveMeetingFilters(filters: MeetingFilters): number {
  let active = 0
  if (filters.q.trim().length > 0) active += 1
  if (filters.type !== '') active += 1
  if (filters.status !== '') active += 1
  if (filters.from !== '') active += 1
  if (filters.to !== '') active += 1
  return active
}

export function listMeetings(
  filters: MeetingFilters,
): Promise<{ items: MeetingRow[]; meta: PageMeta | undefined }> {
  return apiRequestCollection<MeetingRow>('/meetings', {
    query: {
      page: filters.page,
      pageSize: filters.pageSize,
      sort: filters.sort,
      ...(filters.q.trim() ? { q: filters.q.trim() } : {}),
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.from ? { from: filters.from } : {}),
      ...(filters.to ? { to: filters.to } : {}),
    },
  })
}

export function fetchMeeting(id: string): Promise<MeetingDetail> {
  return apiRequest<MeetingDetail>(`/meetings/${id}`)
}

export interface AttendanceOptions {
  members: { id: string; name: string; memberCode: string; position: string }[]
  staff: { id: string; name: string; roleKey: string }[]
}

export function fetchAttendanceOptions(): Promise<AttendanceOptions> {
  return apiRequest<AttendanceOptions>('/meetings/options')
}

export interface MeetingInput {
  title: string
  type: MeetingType
  /** An ISO moment. A general assembly is called for two in the afternoon, not for a date. */
  scheduledFor: string
  endsAt: string | null
  location: string | null
  quorumRequired: number | null
  notes: string | null
}

export function createMeeting(input: MeetingInput): Promise<MeetingDetail> {
  return apiRequest<MeetingDetail>('/meetings', { method: 'POST', body: input })
}

export function updateMeeting(
  id: string,
  changes: Partial<MeetingInput> & { minutesDocumentId?: string | null },
): Promise<MeetingDetail> {
  return apiRequest<MeetingDetail>(`/meetings/${id}`, { method: 'PATCH', body: changes })
}

export function setMeetingStatus(
  id: string,
  status: MeetingStatus,
  reason?: string,
): Promise<MeetingDetail> {
  return apiRequest<MeetingDetail>(`/meetings/${id}/status`, {
    method: 'POST',
    body: { status, ...(reason ? { reason } : {}) },
  })
}

export interface AgendaDraftItem {
  title: string
  description: string | null
  presenterStaffId: string | null
}

export function putAgenda(id: string, items: AgendaDraftItem[]): Promise<MeetingDetail> {
  return apiRequest<MeetingDetail>(`/meetings/${id}/agenda`, { method: 'PUT', body: { items } })
}

export interface AttendanceDraftEntry {
  memberId?: string | null
  staffId?: string | null
  guestName?: string | null
  status: AttendanceStatus
  note?: string | null
}

export function putAttendance(id: string, entries: AttendanceDraftEntry[]): Promise<MeetingDetail> {
  return apiRequest<MeetingDetail>(`/meetings/${id}/attendance`, {
    method: 'PUT',
    body: { entries },
  })
}

export interface DecisionInput {
  title: string
  description: string | null
  decisionType: DecisionType
  agendaItemId: string | null
  votesFor: number | null
  votesAgainst: number | null
  abstentions: number | null
  dueOn: string | null
  responsibleStaffId: string | null
}

export function createDecision(id: string, input: DecisionInput): Promise<MeetingDetail> {
  return apiRequest<MeetingDetail>(`/meetings/${id}/decisions`, { method: 'POST', body: input })
}

/** The follow-up only. What the meeting resolved and how it voted cannot be changed. */
export function updateDecision(
  meetingId: string,
  decisionId: string,
  changes: { status?: DecisionStatus; dueOn?: string | null; responsibleStaffId?: string | null },
): Promise<MeetingDetail> {
  return apiRequest<MeetingDetail>(`/meetings/${meetingId}/decisions/${decisionId}`, {
    method: 'PATCH',
    body: changes,
  })
}
