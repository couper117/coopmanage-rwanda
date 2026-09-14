import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { useApiError, type DisplayableError } from '@/hooks/useApiErrorMessage'
import { ApiError } from '@/lib/apiClient'
import { useAuthStore } from '@/stores/authStore'
import {
  createMember,
  CONTRIBUTION_STATUSES,
  CONTRIBUTION_TYPES,
  DEFAULT_MEMBER_SORT,
  EMPTY_CONTRIBUTION_FILTERS,
  EMPTY_MEMBER_FILTERS,
  fetchMember,
  fetchMemberContributions,
  fetchMemberFormOptions,
  fetchMembersCsv,
  fetchMemberShares,
  fetchMemberStats,
  fetchMemberSummary,
  fetchMemberTimeline,
  listContributions,
  listMembers,
  MEMBER_GENDERS,
  MEMBER_POSITIONS,
  MEMBER_SORTS,
  MEMBER_STATUSES,
  recordContribution,
  setMemberStatus,
  updateMember,
  voidContribution,
  type ContributionFilters,
  type ContributionInput,
  type ContributionStatus,
  type ContributionType,
  type MemberFilters,
  type MemberGender,
  type MemberInput,
  type MemberPosition,
  type MemberSort,
  type MemberStatus,
  type MemberStatusChange,
} from './members.api'

/**
 * Server state for the member register.
 *
 * Every key is namespaced under `members` and carries the cooperative it belongs to, so switching
 * tenant can never show the previous cooperative's roster from cache. Mutations invalidate the
 * whole namespace rather than patching a row: a status change alters the stat tiles, the list
 * order and the profile at once, and refetching is both simpler and more truthful than
 * reconciling three views by hand.
 */
export const memberKeys = {
  all: ['members'] as const,
  scope: (cooperativeId: string | null) => ['members', cooperativeId] as const,
  list: (cooperativeId: string | null, filters: MemberFilters) =>
    ['members', cooperativeId, 'list', filters] as const,
  stats: (cooperativeId: string | null) => ['members', cooperativeId, 'stats'] as const,
  formOptions: (cooperativeId: string | null) => ['members', cooperativeId, 'formOptions'] as const,
  detail: (cooperativeId: string | null, id: string) =>
    ['members', cooperativeId, 'detail', id] as const,
  summary: (cooperativeId: string | null, id: string) =>
    ['members', cooperativeId, 'summary', id] as const,
  timeline: (cooperativeId: string | null, id: string) =>
    ['members', cooperativeId, 'timeline', id] as const,
  ledger: (cooperativeId: string | null, filters: ContributionFilters) =>
    ['members', cooperativeId, 'ledger', filters] as const,
  lookup: (cooperativeId: string | null, query: string) =>
    ['members', cooperativeId, 'lookup', query] as const,
  shares: (cooperativeId: string | null, id: string) =>
    ['members', cooperativeId, 'shares', id] as const,
  contributions: (cooperativeId: string | null, id: string) =>
    ['members', cooperativeId, 'contributions', id] as const,
}

function useCooperativeId(): string | null {
  return useAuthStore((state) => state.activeCooperativeId)
}

/**
 * Holds a value still until typing stops, so the search field does not send one request per
 * keystroke over a register that can hold thousands of members.
 */
export function useDebouncedValue<TValue>(value: TValue, delay = 300): TValue {
  const [settled, setSettled] = useState(value)

  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])

  return settled
}

/**
 * Refusals that are particular to the register, mapped to sentences that say what to do about
 * them. The shared hook translates everything else.
 */
const MEMBER_MESSAGE_KEYS: Readonly<Record<string, string>> = {
  'errors.member.nationalIdTaken': 'apiErrors.nationalIdTaken',
  'errors.contribution.alreadyVoid': 'apiErrors.contributionAlreadyVoid',
}

export function useMemberError(): (error: unknown) => DisplayableError {
  const describeError = useApiError()
  const { t } = useTranslation('members')

  return useCallback(
    (error: unknown): DisplayableError => {
      const described = describeError(error)
      if (!(error instanceof ApiError)) return described
      const key = MEMBER_MESSAGE_KEYS[error.messageKey]
      if (!key) return described
      return { ...described, message: t(key, { ...error.messageParams }) }
    },
    [describeError, t],
  )
}

/**
 * Dates on the member screens.
 *
 * A date-only value from the API is midnight UTC. Formatting it directly would show the previous
 * day to anybody west of Greenwich, so it is read at midday instead. Both languages use the
 * day-month-year order Rwandan offices write.
 */
function parseApiDate(value: string): Date {
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value)
}

function intlLocale(language: string | undefined): string {
  return language === 'rw' ? 'en-RW' : 'en-GB'
}

export function useFormatDate(): (value: string) => string {
  const { i18n } = useTranslation('members')
  const locale = intlLocale(i18n.resolvedLanguage)
  return useCallback(
    (value: string) =>
      new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(parseApiDate(value)),
    [locale],
  )
}

export function useFormatDateTime(): (value: string) => string {
  const { i18n } = useTranslation('members')
  const locale = intlLocale(i18n.resolvedLanguage)
  return useCallback(
    (value: string) =>
      new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
        parseApiDate(value),
      ),
    [locale],
  )
}

export function useFormatNumber(): (value: number) => string {
  const { i18n } = useTranslation('members')
  const locale = intlLocale(i18n.resolvedLanguage)
  return useCallback((value: number) => new Intl.NumberFormat(locale).format(value), [locale])
}

/** Today, as the server writes dates, for a form default. */
export function todayIso(): string {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function oneOf<TValue extends string>(
  allowed: readonly TValue[],
  value: string | null,
): TValue | '' {
  return allowed.find((candidate) => candidate === value) ?? ''
}

function readPage(value: string | null): number {
  const page = Number(value)
  return Number.isInteger(page) && page >= 1 ? page : 1
}

export function readFiltersFromParams(params: URLSearchParams): MemberFilters {
  return {
    q: params.get('q') ?? '',
    status: oneOf<MemberStatus>(MEMBER_STATUSES, params.get('status')),
    position: oneOf<MemberPosition>(MEMBER_POSITIONS, params.get('position')),
    gender: oneOf<MemberGender>(MEMBER_GENDERS, params.get('gender')),
    district: params.get('district') ?? '',
    sector: params.get('sector') ?? '',
    joinedFrom: params.get('joinedFrom') ?? '',
    joinedTo: params.get('joinedTo') ?? '',
    hasPhone: oneOf<'true' | 'false'>(['true', 'false'], params.get('hasPhone')),
    sort: oneOf<MemberSort>(MEMBER_SORTS, params.get('sort')) || DEFAULT_MEMBER_SORT,
    page: readPage(params.get('page')),
    pageSize: EMPTY_MEMBER_FILTERS.pageSize,
  }
}

/** Only what differs from the default is written, so a shared link stays readable. */
function writeFiltersToParams(filters: MemberFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.q) params.set('q', filters.q)
  if (filters.status) params.set('status', filters.status)
  if (filters.position) params.set('position', filters.position)
  if (filters.gender) params.set('gender', filters.gender)
  if (filters.district) params.set('district', filters.district)
  if (filters.sector) params.set('sector', filters.sector)
  if (filters.joinedFrom) params.set('joinedFrom', filters.joinedFrom)
  if (filters.joinedTo) params.set('joinedTo', filters.joinedTo)
  if (filters.hasPhone) params.set('hasPhone', filters.hasPhone)
  if (filters.sort !== DEFAULT_MEMBER_SORT) params.set('sort', filters.sort)
  if (filters.page > 1) params.set('page', String(filters.page))
  return params
}

export interface MemberFilterState {
  filters: MemberFilters
  /** Merges changes and returns to page one, unless the change is itself a page. */
  patch: (changes: Partial<MemberFilters>) => void
  clear: () => void
}

/**
 * The filter state lives in the URL rather than in component state, so a filtered view of the
 * register can be bookmarked, shared with a colleague and reached again by the back button.
 */
export function useMemberFilters(): MemberFilterState {
  const [params, setParams] = useSearchParams()

  const patch = useCallback(
    (changes: Partial<MemberFilters>) => {
      setParams(
        (current) => {
          const merged = { ...readFiltersFromParams(current), ...changes }
          if (changes.page === undefined) merged.page = 1
          return writeFiltersToParams(merged)
        },
        // Turning a page is a place you can go back to; retyping a filter is not.
        { replace: changes.page === undefined },
      )
    },
    [setParams],
  )

  const clear = useCallback(() => {
    setParams(new URLSearchParams(), { replace: true })
  }, [setParams])

  return { filters: readFiltersFromParams(params), patch, clear }
}

export function useMembersList(filters: MemberFilters) {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: memberKeys.list(cooperativeId, filters),
    queryFn: () => listMembers(filters),
    enabled: cooperativeId !== null,
  })
}

export function useMemberStats() {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: memberKeys.stats(cooperativeId),
    queryFn: fetchMemberStats,
    enabled: cooperativeId !== null,
  })
}

export function useMemberFormOptions(enabled = true) {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: memberKeys.formOptions(cooperativeId),
    queryFn: fetchMemberFormOptions,
    enabled: enabled && cooperativeId !== null,
    staleTime: 10 * 60_000,
  })
}

export function useMember(id: string | undefined) {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: memberKeys.detail(cooperativeId, id ?? 'none'),
    queryFn: () => fetchMember(id as string),
    enabled: id !== undefined && cooperativeId !== null,
  })
}

export function useMemberSummary(id: string | undefined) {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: memberKeys.summary(cooperativeId, id ?? 'none'),
    queryFn: () => fetchMemberSummary(id as string),
    enabled: id !== undefined && cooperativeId !== null,
  })
}

export function useMemberTimeline(id: string | undefined) {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: memberKeys.timeline(cooperativeId, id ?? 'none'),
    queryFn: () => fetchMemberTimeline(id as string),
    enabled: id !== undefined && cooperativeId !== null,
  })
}

/** `enabled` carries the `shares:view` permission: without it the request would only be refused. */
export function useMemberShares(id: string | undefined, enabled: boolean) {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: memberKeys.shares(cooperativeId, id ?? 'none'),
    queryFn: () => fetchMemberShares(id as string),
    enabled: enabled && id !== undefined && cooperativeId !== null,
  })
}

export function useMemberContributions(id: string | undefined, enabled: boolean) {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: memberKeys.contributions(cooperativeId, id ?? 'none'),
    queryFn: () => fetchMemberContributions(id as string),
    enabled: enabled && id !== undefined && cooperativeId !== null,
  })
}

/** One invalidation for the whole feature, for the reason given on `memberKeys`. */
function useMemberMutation<TInput, TResult>(mutationFn: (input: TInput) => Promise<TResult>) {
  const cooperativeId = useCooperativeId()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: memberKeys.scope(cooperativeId) }),
  })
}

export function useCreateMember() {
  return useMemberMutation((input: MemberInput) => createMember(input))
}

export function useUpdateMember() {
  return useMemberMutation((input: { id: string; changes: Partial<MemberInput> }) =>
    updateMember(input.id, input.changes),
  )
}

export function useSetMemberStatus() {
  return useMemberMutation((input: { id: string; change: MemberStatusChange }) =>
    setMemberStatus(input.id, input.change),
  )
}

export function useRecordContribution() {
  return useMemberMutation((input: { memberId: string; contribution: ContributionInput }) =>
    recordContribution(input.memberId, input.contribution),
  )
}

/**
 * Downloads the register as a file.
 *
 * The browser's sandbox has no way to hand a file to the user other than a click on an anchor, so
 * one is made, clicked and removed. The object URL is revoked afterwards, because it pins the
 * whole file in memory until the tab closes otherwise.
 */
export function useExportMembers() {
  return useMutation({
    mutationFn: fetchMembersCsv,
    onSuccess: ({ blob, filename }) => {
      if (typeof URL.createObjectURL !== 'function') return
      const href = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = href
      link.download = filename
      link.rel = 'noopener'
      document.body.append(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(href)
    },
  })
}

/**
 * The contributions ledger, filtered from the URL for the same reason the register is: a view
 * narrowed to one month is something an accountant sends to the manager as a link.
 */
export interface ContributionFilterState {
  filters: ContributionFilters
  setFilter: <TKey extends keyof ContributionFilters>(
    key: TKey,
    value: ContributionFilters[TKey],
  ) => void
  clearFilters: () => void
  goToPage: (page: number) => void
}

function readContributionFilters(params: URLSearchParams): ContributionFilters {
  const type = params.get('type') ?? ''
  const status = params.get('status') ?? ''
  const page = Number.parseInt(params.get('page') ?? '1', 10)
  const pageSize = Number.parseInt(params.get('pageSize') ?? '25', 10)

  return {
    memberId: params.get('memberId') ?? '',
    // An unrecognised value in the address bar is dropped rather than sent on, so a stale or
    // hand-edited link shows the unfiltered ledger instead of an error.
    type: CONTRIBUTION_TYPES.some((value) => value === type) ? (type as ContributionType) : '',
    status: CONTRIBUTION_STATUSES.some((value) => value === status)
      ? (status as ContributionStatus)
      : '',
    from: /^\d{4}-\d{2}-\d{2}$/.test(params.get('from') ?? '')
      ? (params.get('from') as string)
      : '',
    to: /^\d{4}-\d{2}-\d{2}$/.test(params.get('to') ?? '') ? (params.get('to') as string) : '',
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: Number.isFinite(pageSize) && pageSize > 0 && pageSize <= 100 ? pageSize : 25,
  }
}

export function useContributionFilters(): ContributionFilterState {
  const [params, setParams] = useSearchParams()
  const filters = readContributionFilters(params)

  const write = useCallback(
    (next: ContributionFilters) => {
      const updated = new URLSearchParams()
      for (const [key, value] of Object.entries(next)) {
        if (value === '' || value === undefined) continue
        if (key === 'page' && value === 1) continue
        if (key === 'pageSize' && value === 25) continue
        updated.set(key, String(value))
      }
      setParams(updated, { replace: true })
    },
    [setParams],
  )

  const setFilter = useCallback(
    <TKey extends keyof ContributionFilters>(key: TKey, value: ContributionFilters[TKey]) => {
      // Any change to a filter returns to the first page: staying on page four of a narrower
      // result is how a user ends up looking at an empty table and thinking there is nothing.
      write({ ...filters, [key]: value, page: 1 })
    },
    [filters, write],
  )

  return {
    filters,
    setFilter,
    clearFilters: useCallback(() => write(EMPTY_CONTRIBUTION_FILTERS), [write]),
    goToPage: useCallback((page: number) => write({ ...filters, page }), [filters, write]),
  }
}

export function useContributionsList(filters: ContributionFilters) {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: memberKeys.ledger(cooperativeId, filters),
    queryFn: () => listContributions(filters),
    enabled: cooperativeId !== null,
  })
}

export function useVoidContribution() {
  return useMemberMutation((input: { id: string; reason: string }) =>
    voidContribution(input.id, input.reason),
  )
}

/**
 * A short list of members matching what somebody has typed, for a picker.
 *
 * Separate from `useMembersList` because it answers a different question. The register is a
 * screen with filters, ordering and pages; this is ten candidates to choose one from, and it is
 * what lets an expense name the member it was paid to. Without it the member profile's payments
 * figure could never be anything but nil, because nothing would ever set `memberId` on a ledger
 * row.
 *
 * Exited and suspended members are included deliberately: a final settlement to somebody who has
 * left the cooperative is exactly the kind of payment that has to be attributable.
 */
export function useMemberLookup(query: string, enabled: boolean) {
  const cooperativeId = useCooperativeId()
  const debounced = useDebouncedValue(query.trim(), 250)

  return useQuery({
    queryKey: memberKeys.lookup(cooperativeId, debounced),
    queryFn: () =>
      listMembers({ ...EMPTY_MEMBER_FILTERS, q: debounced, sort: 'lastName', pageSize: 10 }),
    enabled: enabled && cooperativeId !== null,
    // The previous ten stay on screen while the next ten are fetched, so the list does not blink
    // empty between keystrokes and offer "no members found" to somebody mid-word.
    placeholderData: keepPreviousData,
  })
}
