import { apiRequest, apiRequestCollection } from '@/lib/apiClient'

/**
 * Notifications, as the interface sees them.
 *
 * The server sends a **key and its parameters**, never a finished sentence, so the same row reads
 * in English or in Kinyarwanda depending on who opens it — and a notification written last year
 * still reads correctly in a language the cooperative switched to since.
 *
 * Two endpoints, deliberately. The bell is on every screen and asks repeatedly, so it gets the
 * counts and the newest five; the centre is opened now and then, so it gets the paged list. Giving
 * the bell the whole list would make the commonest request the most expensive one.
 */

export const NOTIFICATION_TYPES = [
  'LOW_STOCK',
  'MEETING_REMINDER',
  'REPORT_READY',
  'MEMBER_INCOMPLETE',
  'DOCUMENT',
  'TASK',
  'SYSTEM',
] as const
export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

export const NOTIFICATION_SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'] as const
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number]

export interface NotificationRow {
  id: string
  type: NotificationType
  severity: NotificationSeverity
  messageKey: string
  messageParams: Record<string, unknown> | null
  entityType: string | null
  entityId: string | null
  /** The screen this is about, so a reader can act on it rather than go looking. */
  actionUrl: string | null
  /** True when it was addressed to this reader alone rather than to the whole cooperative. */
  personal: boolean
  readAt: string | null
  createdAt: string
}

export interface NotificationSummary {
  unread: number
  unreadByType: Partial<Record<NotificationType, number>>
  latest: NotificationRow[]
}

export interface NotificationFilters {
  page: number
  pageSize: number
  type?: NotificationType
  severity?: NotificationSeverity
  dismissed: 'exclude' | 'only' | 'include'
  unreadOnly: boolean
}

export function listNotifications(filters: NotificationFilters) {
  return apiRequestCollection<NotificationRow>('/notifications', {
    query: {
      page: filters.page,
      pageSize: filters.pageSize,
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.severity ? { severity: filters.severity } : {}),
      dismissed: filters.dismissed,
      unreadOnly: filters.unreadOnly ? 'true' : 'false',
    },
  })
}

export function fetchNotificationSummary(): Promise<NotificationSummary> {
  return apiRequest<NotificationSummary>('/notifications/summary')
}

export function markNotificationRead(id: string): Promise<NotificationRow> {
  return apiRequest<NotificationRow>(`/notifications/${id}/read`, { method: 'POST' })
}

export function markAllNotificationsRead(): Promise<{ marked: number }> {
  return apiRequest<{ marked: number }>('/notifications/read-all', { method: 'POST' })
}

export function dismissNotification(id: string): Promise<NotificationRow> {
  return apiRequest<NotificationRow>(`/notifications/${id}/dismiss`, { method: 'POST' })
}
