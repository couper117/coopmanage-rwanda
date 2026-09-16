import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApiError } from '@/hooks/useApiErrorMessage'
import { useAuthStore } from '@/stores/authStore'
import {
  dismissNotification,
  fetchNotificationSummary,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationFilters,
} from './notifications.api'

/**
 * Server state for notifications.
 *
 * The summary is refetched on an interval, which nothing else in this application does. The
 * justification is narrow: a notification is raised by something happening elsewhere — a
 * storekeeper's movement taking a product below its minimum — so there is no mutation on this
 * reader's side to invalidate a cache from. Sixty seconds is slow enough to be invisible on a
 * district-office connection and quick enough that a warning is not stale by the time anybody
 * acts on it.
 *
 * It refetches only while the tab is in the foreground: a browser left open overnight on a metered
 * connection should not spend the night asking.
 */
export const notificationKeys = {
  all: ['notifications'] as const,
  scope: (cooperativeId: string | null) => ['notifications', cooperativeId] as const,
  summary: (cooperativeId: string | null) => ['notifications', cooperativeId, 'summary'] as const,
  list: (cooperativeId: string | null, filters: NotificationFilters) =>
    ['notifications', cooperativeId, 'list', filters] as const,
}

const REFRESH_MS = 60_000

function useCooperativeId(): string | null {
  return useAuthStore((state) => state.activeCooperativeId)
}

export function useNotificationSummary() {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: notificationKeys.summary(cooperativeId),
    queryFn: fetchNotificationSummary,
    enabled: cooperativeId !== null,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
  })
}

export function useNotifications(filters: NotificationFilters) {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: notificationKeys.list(cooperativeId, filters),
    queryFn: () => listNotifications(filters),
    enabled: cooperativeId !== null,
  })
}

/**
 * Marking read, marking all read, and dismissing.
 *
 * Each invalidates the whole namespace rather than patching a row, because every one of them
 * changes the list, the counts and the bell at the same time.
 */
export function useMarkNotificationRead() {
  const queryClient = useQueryClient()
  const cooperativeId = useCooperativeId()
  return useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: notificationKeys.scope(cooperativeId) }),
  })
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient()
  const cooperativeId = useCooperativeId()
  return useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: notificationKeys.scope(cooperativeId) }),
  })
}

export function useDismissNotification() {
  const queryClient = useQueryClient()
  const cooperativeId = useCooperativeId()
  return useMutation({
    mutationFn: (id: string) => dismissNotification(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: notificationKeys.scope(cooperativeId) }),
  })
}

export function useNotificationError() {
  return useApiError()
}
