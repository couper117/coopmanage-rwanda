import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet, useLocation } from 'react-router-dom'
import { RouteErrorBoundary } from '@/app/RouteErrorBoundary'
import { ShortcutsDialog } from '@/components/ShortcutsDialog'
import { Skeleton } from '@/components/ui'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
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
/**
 * What fills the page while a screen's code is being fetched.
 *
 * Deliberately the same shape as the screens' own loading state — a heading-sized bar and a block
 * — rather than a spinner. A spinner says "something is happening"; this says "a screen is coming",
 * and it does not move, which matters on a slow connection where a spinner turns for ten seconds
 * and reads as a fault.
 */
function RouteFallback() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

export function AppShell() {
  const { t } = useTranslation('nav')
  // Below 1280px the sidebar is always a rail: there is not enough width for labels beside a
  // table. Above it, the user's own collapse preference applies.
  const wide = useMediaQuery(WIDE_LAYOUT_QUERY)
  const preferCollapsed = useUiStore((state) => state.sidebarCollapsed)
  const collapsed = !wide || preferCollapsed
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen)
  const location = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const openShortcuts = useCallback(() => setShortcutsOpen(true), [])
  useKeyboardShortcuts({ onHelp: openShortcuts })

  // The drawer must not survive navigation. Escape, the scrim, the focus trap and focus
  // restoration are handled by the dialog primitive inside MobileNavDrawer.
  useEffect(() => {
    setMobileNavOpen(false)
  }, [location.pathname, setMobileNavOpen])

  return (
    <div className="flex min-h-dvh bg-surface-sunken">
      {/*
        The link's own fragment navigation moves the focus starting point in a current browser,
        but not in every one a cooperative's office computer runs. Focusing the landmark directly
        makes the next Tab land in the content everywhere, which is the whole point of the link.
      */}
      <a
        href="#main-content"
        className="skip-link"
        onClick={(event) => {
          event.preventDefault()
          mainRef.current?.focus()
        }}
      >
        {t('skipToContent')}
      </a>

      {/*
        The chrome is marked rather than left for the print stylesheet to guess at. A landmark
        selector would catch the sidebar, but the top bar is a div and a future screen may add
        another, so `data-print` is the explicit signal.
      */}
      <aside
        data-print="hide"
        className={cn('hidden shrink-0 md:block', collapsed ? 'w-sidebar-rail' : 'w-sidebar')}
      >
        <div className={cn('fixed inset-y-0 left-0', collapsed ? 'w-sidebar-rail' : 'w-sidebar')}>
          <Sidebar variant="desktop" collapsed={collapsed} canToggle={wide} />
        </div>
      </aside>

      <MobileNavDrawer />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

      <div className="flex min-w-0 flex-1 flex-col">
        <div data-print="hide">
          <TopBar />
        </div>
        <main
          id="main-content"
          ref={mainRef}
          // Focusable by script only, so it can receive the skip link's focus without becoming a
          // stop in the Tab order — and without a ring around the whole page when it does.
          tabIndex={-1}
          className="flex-1 px-4 py-5 outline-none sm:px-6"
        >
          <div className="mx-auto flex max-w-content flex-col gap-5">
            {/*
              A failure in one screen must not take the shell with it. The boundary sits inside
              the layout, so the sidebar and top bar keep working and the user can navigate away.
            */}
            <RouteErrorBoundary key={location.pathname}>
              {/*
                Every feature screen is loaded on demand, so the first page a cooperative opens
                does not carry the code for the eleven it did not. On a district office connection
                that is the difference between a few seconds and a few tens of seconds.

                The fallback is the same skeleton the screens use while their own data loads, so a
                navigation looks like one wait rather than two.
              */}
              <Suspense fallback={<RouteFallback />}>
                <Outlet />
              </Suspense>
            </RouteErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  )
}
