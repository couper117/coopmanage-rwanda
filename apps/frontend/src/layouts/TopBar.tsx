import { Menu } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ConnectionIndicator } from '@/components/ConnectionIndicator'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { useUiStore } from '@/stores/uiStore'

export function TopBar() {
  const { t } = useTranslation(['nav', 'common'])
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen)

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
      <button
        type="button"
        onClick={() => setMobileNavOpen(true)}
        className="-ml-1 rounded-md p-1.5 text-ink-secondary hover:bg-surface-subtle hover:text-ink lg:hidden"
        aria-label={t('nav:openMenu')}
      >
        <Menu aria-hidden="true" className="size-5" strokeWidth={1.75} />
      </button>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink-secondary">{t('common:appTagline')}</p>
      </div>

      <div className="flex items-center gap-2">
        <ConnectionIndicator />
        <LanguageSwitcher />
      </div>
    </header>
  )
}
