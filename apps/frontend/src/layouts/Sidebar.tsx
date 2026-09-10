import * as Dialog from '@radix-ui/react-dialog'
import { PanelLeftClose, PanelLeftOpen, Sprout, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router-dom'
import { NAV_GROUPS } from '@/app/navigation'
import { cn } from '@/lib/cn'
import { useUiStore } from '@/stores/uiStore'

interface SidebarProps {
  /** Rendered inside the mobile drawer, which is always expanded and has a close button. */
  variant: 'desktop' | 'mobile'
}

export function Sidebar({ variant }: SidebarProps) {
  const { t } = useTranslation(['nav', 'common'])
  const collapsed = useUiStore((state) => state.sidebarCollapsed) && variant === 'desktop'
  const toggleSidebar = useUiStore((state) => state.toggleSidebar)
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen)

  return (
    <div className="flex h-full flex-col bg-primary-800 text-ink-inverse">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-white/10 px-3">
        <Sprout
          aria-hidden="true"
          className="size-5 shrink-0 text-primary-200"
          strokeWidth={1.75}
        />
        {!collapsed ? (
          <span className="truncate text-base font-semibold">{t('common:appName')}</span>
        ) : null}
        <div className="ml-auto">
          {variant === 'desktop' ? (
            <button
              type="button"
              onClick={toggleSidebar}
              className="rounded-md p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
              aria-label={collapsed ? t('nav:openMenu') : t('nav:closeMenu')}
            >
              {collapsed ? (
                <PanelLeftOpen aria-hidden="true" className="size-4" />
              ) : (
                <PanelLeftClose aria-hidden="true" className="size-4" />
              )}
            </button>
          ) : (
            <Dialog.Close
              className="rounded-md p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
              aria-label={t('nav:closeMenu')}
            >
              <X aria-hidden="true" className="size-4" />
            </Dialog.Close>
          )}
        </div>
      </div>

      <nav aria-label={t('nav:mainNavigation')} className="flex-1 overflow-y-auto px-2 py-3">
        {NAV_GROUPS.map((group) => (
          <div key={group.key} className="mb-4 last:mb-0">
            {!collapsed ? (
              <p className="px-2 pb-1.5 text-2xs font-semibold tracking-wider text-white/70 uppercase">
                {t(`nav:groups.${group.key}`)}
              </p>
            ) : null}
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <li key={item.key}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    onClick={() => variant === 'mobile' && setMobileNavOpen(false)}
                    title={collapsed ? t(`nav:items.${item.key}`) : undefined}
                    aria-label={collapsed ? t(`nav:items.${item.key}`) : undefined}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-base transition-colors',
                        collapsed && 'justify-center',
                        isActive
                          ? 'bg-white/15 font-medium text-white'
                          : 'text-white/75 hover:bg-white/10 hover:text-white',
                      )
                    }
                  >
                    <item.icon
                      aria-hidden="true"
                      className="size-[18px] shrink-0"
                      strokeWidth={1.75}
                    />
                    {!collapsed ? (
                      <span className="truncate">{t(`nav:items.${item.key}`)}</span>
                    ) : null}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  )
}
