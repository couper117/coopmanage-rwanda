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
const DocumentsPage = lazy(async () => {
  await loadNamespaces(['documents'])
  return { default: (await import('@/pages/documents/DocumentsPage')).DocumentsPage }
})

/**
 * Documents, mounted inside the application shell.
 *
 * One screen, with the detail, the upload and the archive as dialogs over it. A document is looked
 * at and put back rather than worked on for long stretches, so a route per document would mean a
 * navigation each way for something a dialog does in place — and the list keeps its filters while
 * a paper is read.
 *
 * `documents:view` opens it. Adding needs `documents:upload` and archiving needs
 * `documents:archive`, both checked on the screen and again on every request. There is no route
 * that serves a file: the bytes come from an authenticated endpoint and never from a URL.
 */
export const documentRoutes: RouteObject[] = [
  {
    path: 'documents',
    element: (
      <RequirePermission permission="documents:view">
        <DocumentsPage />
      </RequirePermission>
    ),
  },
]
