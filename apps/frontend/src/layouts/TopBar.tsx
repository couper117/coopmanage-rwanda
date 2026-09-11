import { Menu } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ConnectionIndicator } from '@/components/ConnectionIndicator'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { UserMenu } from '@/components/UserMenu'
import { Badge } from '@/components/ui'
import { useActiveMembership } from '@/features/auth/useSession'
import { useUiStore } from '@/stores/uiStore'

export function TopBar() {
  const { t } = useTranslation(['nav', 'common'])
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen)
  const membership = useActiveMembership()

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
      <button
        type="button"
        onClick={() => setMobileNavOpen(true)}
        className="-ml-1 rounded-md p-1.5 text-ink-secondary hover:bg-surface-subtle hover:text-ink md:hidden"
        aria-label={t('nav:openMenu')}
      >
        <Menu aria-hidden="true" className="size-5" strokeWidth={1.75} />
      </button>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        {membership ? (
          <>
            <p className="truncate text-base font-medium text-ink">{membership.cooperativeName}</p>
            {/*
              A demonstration cooperative is labelled everywhere its name appears, so nobody
              mistakes seeded figures for their own records.
            */}
            {membership.isDemo ? (
              <Badge tone="warning" className="shrink-0">
                {t('common:demoData')}
              </Badge>
            ) : null}
          </>
        ) : (
          <p className="hidden truncate text-sm font-medium text-ink-secondary sm:block">
            {t('common:appTagline')}
          </p>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <ConnectionIndicator />
        <LanguageSwitcher />
        <UserMenu />
      </div>
    </header>
  )
}
