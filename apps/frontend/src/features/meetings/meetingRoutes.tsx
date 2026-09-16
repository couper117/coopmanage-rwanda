import { lazy } from 'react'
import type { RouteObject } from 'react-router-dom'
import { RequirePermission } from '@/features/auth/RequireAuth'
import { loadNamespaces } from '@/i18n'

/**
 * Every screen here is loaded on demand.
 *
 * `lazy` rather than a direct import, so the first page a cooperative opens does not carry the code
 * for the screens it did not ask for. The shell holds the one `Suspense` boundary and shows the
 * same skeleton the screens use for their own data, so a navigation looks like one wait rather than
 * two.
 *
 * The loader awaits the screen's **strings** as well as its code, so a screen never renders
 * with its translation keys showing and then corrects itself. `docs/ui-system.md` §13 records it.
 */
const MeetingDetailPage = lazy(async () => {
  await loadNamespaces(['meetings', 'documents'])
  return { default: (await import('@/pages/meetings/MeetingDetailPage')).MeetingDetailPage }
})
const MeetingsPage = lazy(async () => {
  await loadNamespaces(['meetings', 'documents'])
  return { default: (await import('@/pages/meetings/MeetingsPage')).MeetingsPage }
})

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
