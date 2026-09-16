import { lazy } from 'react'
import type { RouteObject } from 'react-router-dom'
import { RequirePermission } from '@/features/auth/RequireAuth'
import { loadNamespaces } from '@/i18n'

/**
 * Announcements and the log of what was sent, both loaded on demand with their strings.
 */
const AnnouncementsPage = lazy(async () => {
  await loadNamespaces(['announcements'])
  return { default: (await import('@/pages/announcements/AnnouncementsPage')).AnnouncementsPage }
})

const MessagesPage = lazy(async () => {
  await loadNamespaces(['announcements'])
  return { default: (await import('@/pages/announcements/MessagesPage')).MessagesPage }
})

/**
 * Two screens, and the second is deliberately not a nav item.
 *
 * The message log belongs to the announcements it records — a cooperative reaches it from the
 * message count on a notice, or from the button beside the list — and a nav entry for it would
 * suggest sending messages is a thing done on its own rather than a way of delivering an
 * announcement.
 *
 * Reading and writing notices is `announcements:view` and `announcements:manage`. The log is
 * `sms:send`, because it holds the body of every message and a reminder about an unpaid
 * contribution names the member and the amount.
 */
export const announcementRoutes: RouteObject[] = [
  {
    path: 'announcements',
    element: (
      <RequirePermission permission="announcements:view">
        <AnnouncementsPage />
      </RequirePermission>
    ),
  },
  {
    path: 'announcements/messages',
    element: (
      <RequirePermission permission="sms:send">
        <MessagesPage />
      </RequirePermission>
    ),
  },
]
