import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { useRestoreSession } from '@/features/auth/useSession'
import { routes } from './routes'

export const router = createBrowserRouter(routes)

/**
 * The session is restored once, above the router, so every screen below it — public or guarded —
 * already knows whether somebody is signed in. Doing it inside a guard instead would re-run it on
 * each navigation and make the login screen unable to tell "not signed in" from "not checked yet".
 */
export function AppRouter() {
  useRestoreSession()
  return <RouterProvider router={router} />
}
