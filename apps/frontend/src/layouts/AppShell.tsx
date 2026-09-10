import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet, useLocation } from 'react-router-dom'
import { RouteErrorBoundary } from '@/app/RouteErrorBoundary'
import { useMediaQuery, WIDE_LAYOUT_QUERY } from '@/hooks/useMediaQuery'
import { cn } from '@/lib/cn'
import { useUiStore } from '@/stores/uiStore'
import { MobileNavDrawer } from './MobileNavDrawer'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

/**
 * Three intentional layouts rather than one shrinking layout, as specified in docs/ui-system.md
 * section 5: a full sidebar at 1280px and above, a 64px icon rail from 768px, and a modal drawer
 * below that.
 */
export function AppShell() {
  const { t } = useTranslation('nav')
  // Below 1280px the sidebar is always a rail: there is not enough width for labels beside a
  // table. Above it, the user's own collapse preference applies.
  const wide = useMediaQuery(WIDE_LAYOUT_QUERY)
  const preferCollapsed = useUiStore((state) => state.sidebarCollapsed)
  const collapsed = !wide || preferCollapsed
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

      <aside className={cn('hidden shrink-0 md:block', collapsed ? 'w-sidebar-rail' : 'w-sidebar')}>
        <div className={cn('fixed inset-y-0 left-0', collapsed ? 'w-sidebar-rail' : 'w-sidebar')}>
          <Sidebar variant="desktop" collapsed={collapsed} canToggle={wide} />
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
