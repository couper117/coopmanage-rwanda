import { HEADERS, type PageMeta, type Province } from '@coopmanage/shared'
import { currentLanguage } from '@/i18n'
import { API_BASE_URL, ApiError, apiRequest, apiRequestCollection } from '@/lib/apiClient'
import { authState } from '@/stores/authStore'

/**
 * The member register, as the interface sees it.
 *
 * Two rules from the product brief shape this whole file.
 *
 * **A member needs a name and nothing else.** Every field except the two names is optional on the
 * way in, and an optional field that the user left alone is sent as `''` — which the server stores
 * as null — or omitted entirely where the field is an enum or a date that cannot accept an empty
 * string. Nothing here ever requires a phone number: most members of a Rwandan agricultural
 * cooperative do not have one.
 *
 * **Money is a string on the wire.** Amounts are never put through `Number` or `parseFloat` on
 * their way to or from the server, because a float cannot hold a decimal amount exactly and the
 * cooperative's books have to balance to the franc.
 */

export const MEMBER_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'EXITED'] as const
export type MemberStatus = (typeof MEMBER_STATUSES)[number]

export const MEMBER_POSITIONS = [
  'MEMBER',
  'COMMITTEE',
  'SECRETARY',
  'TREASURER',
  'VICE_CHAIR',
  'CHAIRPERSON',
] as const
export type MemberPosition = (typeof MEMBER_POSITIONS)[number]

export const MEMBER_GENDERS = ['FEMALE', 'MALE', 'OTHER', 'UNSPECIFIED'] as const
export type MemberGender = (typeof MEMBER_GENDERS)[number]

export const CONTRIBUTION_TYPES = [
  'MEMBERSHIP_FEE',
  'SAVINGS',
  'SHARE_CAPITAL',
  'SPECIAL_LEVY',
  'PENALTY',
  'OTHER',
] as const
export type ContributionType = (typeof CONTRIBUTION_TYPES)[number]

export const PAYMENT_METHODS = ['CASH', 'MOBILE_MONEY', 'BANK', 'CHEQUE', 'OTHER'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const SHARE_TYPES = ['PURCHASE', 'TRANSFER_IN', 'TRANSFER_OUT', 'REDEMPTION'] as const
export type ShareType = (typeof SHARE_TYPES)[number]

/** The six orderings the server accepts. A leading `-` is descending. */
export const MEMBER_SORTS = [
  'lastName',
  '-lastName',
  'memberCode',
  '-memberCode',
  'joinedOn',
  '-joinedOn',
] as const
export type MemberSort = (typeof MEMBER_SORTS)[number]

export const DEFAULT_MEMBER_SORT: MemberSort = 'lastName'

export interface MemberListRow {
  id: string
  memberCode: string
  firstName: string
  lastName: string
  fullName: string
  gender: string
  phone: string | null
  district: string | null
  sector: string | null
  joinedOn: string
  position: string
  status: string
  /** All but the last four digits replaced, because a roster on a shared office screen does not
   * need a strong identifier for a real person in full. */
  nationalIdMasked: string | null
}

export interface MemberDetail extends Omit<MemberListRow, 'nationalIdMasked'> {
  dateOfBirth: string | null
  nationalId: string | null
  email: string | null
  province: string | null
  cell: string | null
  village: string | null
  exitedOn: string | null
  exitReason: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Every filter the list screen can apply, all as strings so the whole shape round-trips through
 * the URL and can be used verbatim as a query key.
 */
export interface MemberFilters {
  q: string
  status: MemberStatus | ''
  position: MemberPosition | ''
  gender: MemberGender | ''
  district: string
  sector: string
  joinedFrom: string
  joinedTo: string
  hasPhone: 'true' | 'false' | ''
  sort: MemberSort
  page: number
  pageSize: number
}

export const EMPTY_MEMBER_FILTERS: MemberFilters = {
  q: '',
  status: '',
  position: '',
  gender: '',
  district: '',
  sector: '',
  joinedFrom: '',
  joinedTo: '',
  hasPhone: '',
  sort: DEFAULT_MEMBER_SORT,
  page: 1,
  pageSize: 25,
}

/** The filters that narrow the register, as opposed to ordering and paging it. */
export function countActiveFilters(filters: MemberFilters): number {
  return [
    filters.q,
    filters.status,
    filters.position,
    filters.gender,
    filters.district,
    filters.sector,
    filters.joinedFrom,
    filters.joinedTo,
    filters.hasPhone,
  ].filter((value) => value !== '').length
}

function listQuery(filters: MemberFilters): Record<string, string | number> {
  return {
    q: filters.q,
    status: filters.status,
    position: filters.position,
    gender: filters.gender,
    district: filters.district,
    sector: filters.sector,
    joinedFrom: filters.joinedFrom,
    joinedTo: filters.joinedTo,
    hasPhone: filters.hasPhone,
    sort: filters.sort,
    page: filters.page,
    pageSize: filters.pageSize,
  }
}

export interface MemberPage {
  items: MemberListRow[]
  meta: PageMeta | undefined
}

export function listMembers(filters: MemberFilters): Promise<MemberPage> {
  // The API client drops empty strings, so an unset filter is simply not sent.
  return apiRequestCollection<MemberListRow>('/members', { query: listQuery(filters) })
}

export interface MemberStats {
  total: number
  /** Only the statuses that occur are present, so a missing key means none. */
  byStatus: Partial<Record<MemberStatus, number>>
  newThisMonth: number
  /**
   * Not a data-quality warning: it is how many members cannot be reached by SMS when a meeting is
   * called, and who therefore have to be told another way.
   */
  withoutPhone: number
}

export function fetchMemberStats(): Promise<MemberStats> {
  return apiRequest<MemberStats>('/members/stats')
}

export interface MemberFormOptions {
  incomeCategories: { id: string; name: string; nameRw: string | null }[]
}

export function fetchMemberFormOptions(): Promise<MemberFormOptions> {
  return apiRequest<MemberFormOptions>('/members/form-options')
}

/**
 * Everything the create and edit forms can send.
 *
 * `null` appears only where the server accepts it, which is how a stored value is cleared: a date,
 * a province. `gender`, `position` and `joinedOn` are not nullable on the server, so they are
 * omitted rather than nulled when the field is blank.
 */
export interface MemberInput {
  firstName: string
  lastName: string
  gender?: MemberGender
  dateOfBirth?: string | null
  nationalId?: string
  phone?: string
  email?: string
  province?: Province | null
  district?: string
  sector?: string
  cell?: string
  village?: string
  joinedOn?: string
  position?: MemberPosition
  notes?: string
}

export function createMember(input: MemberInput): Promise<MemberDetail> {
  return apiRequest<MemberDetail>('/members', { method: 'POST', body: input })
}

export function fetchMember(id: string): Promise<MemberDetail> {
  return apiRequest<MemberDetail>(`/members/${id}`)
}

export function updateMember(id: string, changes: Partial<MemberInput>): Promise<MemberDetail> {
  return apiRequest<MemberDetail>(`/members/${id}`, { method: 'PATCH', body: changes })
}

export interface MemberStatusChange {
  status: MemberStatus
  reason?: string
  /** Required by the server when the status is EXITED, so the register says when they left. */
  exitedOn?: string
}

/**
 * A status change, never a deletion. There is no `DELETE /members/:id` and there is no delete
 * button anywhere in this feature: a removed member would take their contribution history with
 * them, and the cooperative's books have to stay defensible years later.
 */
export function setMemberStatus(id: string, change: MemberStatusChange): Promise<MemberDetail> {
  return apiRequest<MemberDetail>(`/members/${id}/status`, { method: 'POST', body: change })
}

export interface MemberSummary {
  member: MemberDetail
  shares: { quantity: number; value: string } | null
  contributions: { count: number; total: string } | null
  payments: { total: string } | null
  /**
   * Blocks whose data arrives in a later phase. The profile names them rather than showing a zero,
   * because "none recorded" and "we cannot tell you yet" are different answers.
   */
  unavailable: string[]
  /** Blocks the caller may not see. The profile says so rather than displaying nothing. */
  withheld: string[]
}

export function fetchMemberSummary(id: string): Promise<MemberSummary> {
  return apiRequest<MemberSummary>(`/members/${id}/summary`)
}

export interface TimelineEntry {
  at: string
  kind: 'REGISTERED' | 'STATUS' | 'SHARE' | 'CONTRIBUTION' | 'PAYMENT'
  /** A translation key in this feature's own namespace, such as `timeline.contribution.SAVINGS`. */
  messageKey: string
  messageParams: Record<string, string | number>
  amount: string | null
}

export function fetchMemberTimeline(id: string): Promise<TimelineEntry[]> {
  return apiRequest<TimelineEntry[]>(`/members/${id}/timeline`)
}

export interface ShareRow {
  id: string
  type: string
  quantity: number
  unitValue: string
  totalValue: string
  issuedOn: string
  certificateNo: string | null
  note: string | null
  status: string
  financeReference: string | null
}

export interface MemberShares {
  items: ShareRow[]
  holding: { quantity: number; value: string }
}

export function fetchMemberShares(id: string): Promise<MemberShares> {
  return apiRequest<MemberShares>(`/members/${id}/shares`)
}

export interface ContributionRow {
  id: string
  memberId: string
  memberCode: string
  memberName: string
  type: string
  amount: string
  paidOn: string
  method: string
  reference: string | null
  status: string
  financeReference: string | null
}

export interface MemberContributions {
  items: ContributionRow[]
  total: number
  totalAmount: string
}

export function fetchMemberContributions(id: string): Promise<MemberContributions> {
  return apiRequest<MemberContributions>(`/members/${id}/contributions`)
}

export interface ContributionInput {
  type: ContributionType
  /** A decimal string, exactly as it was typed. Never a JavaScript number. */
  amount: string
  paidOn?: string
  method: PaymentMethod
  reference?: string
  note?: string
  categoryId: string
}

export function recordContribution(
  memberId: string,
  input: ContributionInput,
): Promise<{ id: string; amount: string; reference: string }> {
  return apiRequest<{ id: string; amount: string; reference: string }>(
    `/members/${memberId}/contributions`,
    { method: 'POST', body: input },
  )
}

export interface DownloadedFile {
  blob: Blob
  filename: string
}

/**
 * The register as a CSV file, under exactly the filters currently on screen.
 *
 * This is the one call in the feature that does not go through `apiRequest`: the response is a
 * file rather than a JSON envelope, so the envelope unwrapping would throw on it. The headers are
 * assembled the same way, and a failure is reported as the same `ApiError` every other call
 * produces, so the screen has one kind of error to handle.
 */
export async function fetchMembersCsv(filters: MemberFilters): Promise<DownloadedFile> {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(listQuery(filters))) {
    // Paging does not apply to a file: the export always covers the whole filtered set.
    if (key === 'page' || key === 'pageSize') continue
    if (value !== '' && value !== undefined) params.set(key, String(value))
  }

  const headers: Record<string, string> = {
    Accept: 'text/csv',
    'Accept-Language': currentLanguage(),
  }
  const token = authState.accessToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const cooperativeId = authState.cooperativeId()
  if (cooperativeId) headers[HEADERS.cooperativeId] = cooperativeId

  const query = params.toString()
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/members/export${query ? `?${query}` : ''}`, {
      headers,
      credentials: 'include',
    })
  } catch {
    throw ApiError.network()
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { code?: string; messageKey?: string; message?: string; requestId?: string }
    } | null
    const body = payload?.error
    throw new ApiError({
      status: response.status,
      code: 'INTERNAL_ERROR',
      messageKey: body?.messageKey ?? 'errors.internal',
      message: body?.message ?? 'The export could not be produced.',
      ...(body?.requestId ? { requestId: body.requestId } : {}),
    })
  }

  return {
    blob: await response.blob(),
    filename: filenameFrom(response.headers.get('Content-Disposition')),
  }
}

/** The server names the file with the cooperative code and the date, which is worth keeping. */
function filenameFrom(disposition: string | null): string {
  const match = disposition ? /filename="?([^";]+)"?/.exec(disposition) : null
  return match?.[1] ?? 'members.csv'
}

/**
 * The whole cooperative's contributions, rather than one member's.
 *
 * Kept in this file because a contribution is a member's money: it is the member-facing view of a
 * ledger row, and the screen that lists them is reached from the register. The accounting view of
 * the same money, with categories and a balance, is the finance module.
 */
export const CONTRIBUTION_STATUSES = ['POSTED', 'VOID'] as const
export type ContributionStatus = (typeof CONTRIBUTION_STATUSES)[number]

export interface ContributionFilters {
  memberId: string
  type: ContributionType | ''
  status: ContributionStatus | ''
  from: string
  to: string
  page: number
  pageSize: number
}

export const EMPTY_CONTRIBUTION_FILTERS: ContributionFilters = {
  memberId: '',
  type: '',
  status: '',
  from: '',
  to: '',
  page: 1,
  pageSize: 25,
}

export function countActiveContributionFilters(filters: ContributionFilters): number {
  const { page: _page, pageSize: _pageSize, ...rest } = filters
  return Object.values(rest).filter((value) => value !== '').length
}

export interface ContributionPage {
  items: ContributionRow[]
  meta: PageMeta & { totalAmount: string }
}

/**
 * The ledger page. `totalAmount` covers the whole filtered set rather than the rows on screen,
 * which is the figure an accountant is actually after when they narrow the list to one month.
 */
export async function listContributions(filters: ContributionFilters): Promise<ContributionPage> {
  const params = new URLSearchParams()
  if (filters.memberId) params.set('memberId', filters.memberId)
  if (filters.type) params.set('type', filters.type)
  if (filters.status) params.set('status', filters.status)
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  params.set('page', String(filters.page))
  params.set('pageSize', String(filters.pageSize))

  const response = await apiRequestCollection<ContributionRow>(
    `/contributions?${params.toString()}`,
  )
  return {
    items: response.items,
    meta: (response.meta ?? {
      page: filters.page,
      pageSize: filters.pageSize,
      total: response.items.length,
      totalPages: 1,
      totalAmount: '0.00',
    }) as PageMeta & { totalAmount: string },
  }
}

/**
 * Cancels a contribution recorded in error.
 *
 * Nothing is deleted. The server writes a reversal of the opposite kind into the ledger and marks
 * the original, so both stay visible and the correction is part of the record rather than a figure
 * that silently changed. The reference of the reversal comes back so the screen can name it.
 */
export function voidContribution(
  id: string,
  reason: string,
): Promise<{ id: string; status: string; reversalReference: string | null }> {
  return apiRequest<{ id: string; status: string; reversalReference: string | null }>(
    `/contributions/${id}/void`,
    { method: 'POST', body: { reason } },
  )
}
