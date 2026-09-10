import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { routes } from './routes'

export const router = createBrowserRouter(routes)

export function AppRouter() {
  return <RouterProvider router={router} />
}
