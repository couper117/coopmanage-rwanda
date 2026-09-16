import { lazy } from 'react'
import type { RouteObject } from 'react-router-dom'
import { RequirePermission } from '@/features/auth/RequireAuth'
import { loadNamespaces } from '@/i18n'

const AssistantPage = lazy(async () => {
  await loadNamespaces(['assistant'])
  return { default: (await import('@/pages/AssistantPage')).AssistantPage }
})

/**
 * Ask CoopManage.
 *
 * `assistant:use` opens it and every role has it. What a reader can learn is decided by the rest of
 * their permissions, on the server, where the tool catalogue is filtered before a question is read.
 */
export const assistantRoutes: RouteObject[] = [
  {
    path: 'assistant',
    element: (
      <RequirePermission permission="assistant:use">
        <AssistantPage />
      </RequirePermission>
    ),
  },
]
