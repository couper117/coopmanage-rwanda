import type { RouteObject } from 'react-router-dom'
import { RequirePermission } from '@/features/auth/RequireAuth'
import { MeetingDetailPage } from '@/pages/meetings/MeetingDetailPage'
import { MeetingsPage } from '@/pages/meetings/MeetingsPage'

/**
 * Meetings, mounted inside the application shell.
 *
 * A meeting gets its own route rather than a dialog, unlike a document: the agenda, the attendance
 * and the decisions are worked on across a whole sitting, the page is printed as the minutes, and
 * a cooperative sends somebody a link to a particular assembly.
 *
 * `meetings:view` reads and `meetings:manage` writes — the same split the server enforces. A
 * closed meeting shows no editing controls at all, which the detail page decides from the
 * meeting's own state rather than from a route.
 */
export const meetingRoutes: RouteObject[] = [
  {
    path: 'meetings',
    element: (
      <RequirePermission permission="meetings:view">
        <MeetingsPage />
      </RequirePermission>
    ),
  },
  {
    path: 'meetings/:id',
    element: (
      <RequirePermission permission="meetings:view">
        <MeetingDetailPage />
      </RequirePermission>
    ),
  },
]
