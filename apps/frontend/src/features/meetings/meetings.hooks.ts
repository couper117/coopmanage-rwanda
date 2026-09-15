import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useApiError } from '@/hooks/useApiErrorMessage'
import { useAuthStore } from '@/stores/authStore'
import {
  createDecision,
  createMeeting,
  fetchAttendanceOptions,
  fetchMeeting,
  listMeetings,
  putAgenda,
  putAttendance,
  setMeetingStatus,
  updateDecision,
  updateMeeting,
  type AgendaDraftItem,
  type AttendanceDraftEntry,
  type DecisionInput,
  type DecisionStatus,
  type MeetingFilters,
  type MeetingInput,
  type MeetingStatus,
} from './meetings.api'

/**
 * Server state for meetings.
 *
 * Every write returns the whole meeting, so the detail query is set from the response rather than
 * refetched: the agenda, the attendance, the quorum count and the decisions all change together
 * when any one of them is saved, and asking again for what the server has just sent would be a
 * second round trip over a district office connection for no new information.
 */
export const meetingKeys = {
  all: ['meetings'] as const,
  scope: (cooperativeId: string | null) => ['meetings', cooperativeId] as const,
  list: (cooperativeId: string | null, filters: MeetingFilters) =>
    ['meetings', cooperativeId, 'list', filters] as const,
  one: (cooperativeId: string | null, id: string | undefined) =>
    ['meetings', cooperativeId, 'one', id] as const,
  options: (cooperativeId: string | null) => ['meetings', cooperativeId, 'options'] as const,
}

function useCooperativeId(): string | null {
  return useAuthStore((state) => state.activeCooperativeId)
}

export function useMeetingsList(filters: MeetingFilters) {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: meetingKeys.list(cooperativeId, filters),
    queryFn: () => listMeetings(filters),
    enabled: cooperativeId !== null,
  })
}

export function useMeeting(id: string | undefined) {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: meetingKeys.one(cooperativeId, id),
    queryFn: () => fetchMeeting(id as string),
    enabled: cooperativeId !== null && typeof id === 'string',
  })
}

export function useAttendanceOptions(enabled: boolean) {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: meetingKeys.options(cooperativeId),
    queryFn: fetchAttendanceOptions,
    enabled: enabled && cooperativeId !== null,
    // The register changes when a member is registered, which is rare within a sitting.
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * A write that returns the meeting.
 *
 * The detail query is written from the response and the list is invalidated, because a saved
 * attendance changes the present count the list shows.
 */
function useMeetingWrite<TInput>(fn: (input: TInput) => ReturnType<typeof fetchMeeting>) {
  const client = useQueryClient()
  const cooperativeId = useCooperativeId()

  return useMutation({
    mutationFn: fn,
    onSuccess: (meeting) => {
      client.setQueryData(meetingKeys.one(cooperativeId, meeting.id), meeting)
      void client.invalidateQueries({
        queryKey: meetingKeys.list(cooperativeId, undefined as never),
      })
      void client.invalidateQueries({ queryKey: meetingKeys.scope(cooperativeId) })
    },
  })
}

export function useCreateMeeting() {
  return useMeetingWrite((input: MeetingInput) => createMeeting(input))
}

export function useUpdateMeeting() {
  return useMeetingWrite(
    (input: {
      id: string
      changes: Partial<MeetingInput> & { minutesDocumentId?: string | null }
    }) => updateMeeting(input.id, input.changes),
  )
}

export function useSetMeetingStatus() {
  return useMeetingWrite((input: { id: string; status: MeetingStatus; reason?: string }) =>
    setMeetingStatus(input.id, input.status, input.reason),
  )
}

export function usePutAgenda() {
  return useMeetingWrite((input: { id: string; items: AgendaDraftItem[] }) =>
    putAgenda(input.id, input.items),
  )
}

export function usePutAttendance() {
  return useMeetingWrite((input: { id: string; entries: AttendanceDraftEntry[] }) =>
    putAttendance(input.id, input.entries),
  )
}

export function useCreateDecision() {
  return useMeetingWrite((input: { id: string; decision: DecisionInput }) =>
    createDecision(input.id, input.decision),
  )
}

export function useUpdateDecision() {
  return useMeetingWrite(
    (input: {
      meetingId: string
      decisionId: string
      changes: {
        status?: DecisionStatus
        dueOn?: string | null
        responsibleStaffId?: string | null
      }
    }) => updateDecision(input.meetingId, input.decisionId, input.changes),
  )
}

export function useMeetingsError() {
  return useApiError()
}

/** A meeting's moment, written out: the date and the time it was called for. */
export function useFormatMeetingTime(): (iso: string) => string {
  const { i18n } = useTranslation()
  const locale = i18n.language === 'rw' ? 'rw' : 'en'
  return useCallback(
    (iso: string) =>
      new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(iso),
      ),
    [locale],
  )
}

export function useFormatMeetingDate(): (iso: string) => string {
  const { i18n } = useTranslation()
  const locale = i18n.language === 'rw' ? 'rw' : 'en'
  return useCallback(
    (iso: string) =>
      new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
        new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso),
      ),
    [locale],
  )
}

/** The local-time value an `<input type="datetime-local">` needs, from an ISO moment. */
export function toLocalInputValue(iso: string): string {
  const date = new Date(iso)
  const offset = date.getTimezoneOffset() * 60 * 1000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

/** Back the other way: what the form holds is local, and the API takes a moment in UTC. */
export function fromLocalInputValue(value: string): string {
  return new Date(value).toISOString()
}
