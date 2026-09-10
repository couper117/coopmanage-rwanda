import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet, useLocation } from 'react-router-dom'
import { cn } from '@/lib/cn'
import { useUiStore } from '@/stores/uiStore'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

/**
 * Three intentional layouts rather than one shrinking layout:
 * a full sidebar on desktop, an icon rail on tablet, and an off-canvas drawer below 1024px.
 */
export function AppShell() {
  const { t } = useTranslation('nav')
  const collapsed = useUiStore((state) => state.sidebarCollapsed)
  const mobileNavOpen = useUiStore((state) => state.mobileNavOpen)
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen)
  const location = useLocation()

  // The drawer must not survive navigation, and Escape must always close it.
  useEffect(() => {
    setMobileNavOpen(false)
  }, [location.pathname, setMobileNavOpen])

  useEffect(() => {
    if (!mobileNavOpen) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMobileNavOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mobileNavOpen, setMobileNavOpen])

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

      {mobileNavOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label={t('closeMenu')}
            className="absolute inset-0 bg-ink/40"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-sidebar shadow-overlay">
            <Sidebar variant="mobile" />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main id="main-content" className="flex-1 px-4 py-5 sm:px-6">
          <div className="mx-auto flex max-w-content flex-col gap-5">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
