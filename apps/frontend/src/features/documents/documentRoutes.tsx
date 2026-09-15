import type { RouteObject } from 'react-router-dom'
import { RequirePermission } from '@/features/auth/RequireAuth'
import { DocumentsPage } from '@/pages/documents/DocumentsPage'

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
