import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApiError } from '@/hooks/useApiErrorMessage'
import { useAuthStore } from '@/stores/authStore'
import {
  archiveAnnouncement,
  createAnnouncement,
  fetchAnnouncement,
  fetchAudience,
  fetchSmsProvider,
  listAnnouncements,
  listMessages,
  publishAnnouncement,
  sendSms,
  updateAnnouncement,
  type AnnouncementFilters,
  type AnnouncementInput,
  type SmsFilters,
} from './announcements.api'

/**
 * Server state for announcements and the message log.
 *
 * Publishing invalidates the log as well as the list, because a publish that sent messages has
 * just written a row per member — and the log is the screen a cooperative goes to next when it
 * wants to know who was reached.
 */
export const announcementKeys = {
  all: ['announcements'] as const,
  scope: (cooperativeId: string | null) => ['announcements', cooperativeId] as const,
  list: (cooperativeId: string | null, filters: AnnouncementFilters) =>
    ['announcements', cooperativeId, 'list', filters] as const,
  one: (cooperativeId: string | null, id: string | undefined) =>
    ['announcements', cooperativeId, 'one', id] as const,
  audience: (cooperativeId: string | null, id: string | undefined) =>
    ['announcements', cooperativeId, 'audience', id] as const,
  messages: (cooperativeId: string | null, filters: SmsFilters) =>
    ['announcements', cooperativeId, 'messages', filters] as const,
  provider: (cooperativeId: string | null) => ['announcements', cooperativeId, 'provider'] as const,
}

function useCooperativeId(): string | null {
  return useAuthStore((state) => state.activeCooperativeId)
}

export function useAnnouncements(filters: AnnouncementFilters) {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: announcementKeys.list(cooperativeId, filters),
    queryFn: () => listAnnouncements(filters),
    enabled: cooperativeId !== null,
  })
}

export function useAnnouncement(id: string | undefined) {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: announcementKeys.one(cooperativeId, id),
    queryFn: () => fetchAnnouncement(id as string),
    enabled: cooperativeId !== null && id !== undefined,
  })
}

/**
 * Who it would reach and what it would cost.
 *
 * Fetched when the publish dialog opens rather than with the list: the numbers depend on the
 * register as it is now, and a count read half an hour ago is a count that could send a message to
 * somebody who has since left.
 */
export function useAudiencePreview(id: string | undefined, enabled: boolean) {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: announcementKeys.audience(cooperativeId, id),
    queryFn: () => fetchAudience(id as string),
    enabled: enabled && cooperativeId !== null && id !== undefined,
    staleTime: 0,
  })
}

export function useSmsProvider() {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: announcementKeys.provider(cooperativeId),
    queryFn: fetchSmsProvider,
    enabled: cooperativeId !== null,
    // Which provider is live changes on a deployment, not during a session.
    staleTime: 60 * 60 * 1000,
  })
}

export function useMessages(filters: SmsFilters) {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: announcementKeys.messages(cooperativeId, filters),
    queryFn: () => listMessages(filters),
    enabled: cooperativeId !== null,
  })
}

function useInvalidate() {
  const queryClient = useQueryClient()
  const cooperativeId = useCooperativeId()
  return () => queryClient.invalidateQueries({ queryKey: announcementKeys.scope(cooperativeId) })
}

export function useCreateAnnouncement() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: AnnouncementInput) => createAnnouncement(input),
    onSuccess: () => invalidate(),
  })
}

export function useUpdateAnnouncement() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: { id: string; changes: Partial<AnnouncementInput> }) =>
      updateAnnouncement(input.id, input.changes),
    onSuccess: () => invalidate(),
  })
}

export function usePublishAnnouncement() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: { id: string; sendSms: boolean }) =>
      publishAnnouncement(input.id, input.sendSms),
    onSuccess: () => invalidate(),
  })
}

export function useArchiveAnnouncement() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: { id: string; reason: string }) =>
      archiveAnnouncement(input.id, input.reason),
    onSuccess: () => invalidate(),
  })
}

export function useSendSms() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: { memberIds: string[]; body: string }) =>
      sendSms(input.memberIds, input.body),
    onSuccess: () => invalidate(),
  })
}

export function useAnnouncementError() {
  return useApiError()
}
