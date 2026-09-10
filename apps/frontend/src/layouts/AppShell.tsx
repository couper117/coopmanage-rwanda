import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet, useLocation } from 'react-router-dom'
import { RouteErrorBoundary } from '@/app/RouteErrorBoundary'
import { cn } from '@/lib/cn'
import { useUiStore } from '@/stores/uiStore'
import { MobileNavDrawer } from './MobileNavDrawer'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

/**
 * Three intentional layouts rather than one shrinking layout:
 * a full sidebar on desktop, an icon rail on tablet, and a modal drawer below 1024px.
 */
export function AppShell() {
  const { t } = useTranslation('nav')
  const collapsed = useUiStore((state) => state.sidebarCollapsed)
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen)
  const location = useLocation()

  // The drawer must not survive navigation. Escape, the scrim, the focus trap and focus
  // restoration are handled by the dialog primitive inside MobileNavDrawer.
  useEffect(() => {
    setMobileNavOpen(false)
  }, [location.pathname, setMobileNavOpen])

  return (
    <div className="flex min-h-dvh bg-surface-sunken">
      <a href="#main-content" className="skip-link">
        {t('skipToContent')}
      </a>

      <aside className={cn('hidden shrink-0 lg:block', collapsed ? 'w-sidebar-rail' : 'w-sidebar')}>
        <div className={cn('fixed inset-y-0 left-0', collapsed ? 'w-sidebar-rail' : 'w-sidebar')}>
          <Sidebar variant="desktop" />
        </div>
      </aside>

      <MobileNavDrawer />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main id="main-content" className="flex-1 px-4 py-5 sm:px-6">
          <div className="mx-auto flex max-w-content flex-col gap-5">
            {/*
              A failure in one screen must not take the shell with it. The boundary sits inside
              the layout, so the sidebar and top bar keep working and the user can navigate away.
            */}
            <RouteErrorBoundary key={location.pathname}>
              <Outlet />
            </RouteErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  )
}
