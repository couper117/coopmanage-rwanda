import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, Languages } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { changeLanguage, currentLanguage, SUPPORTED_LANGUAGES, type Language } from '@/i18n'
import { cn } from '@/lib/cn'

/**
 * The switcher writes to localStorage through i18next's detector, so the choice survives a reload.
 * From Phase 2 it also writes to the user record, so it follows the person between devices.
 */
export function LanguageSwitcher() {
  const { t } = useTranslation('common')
  const active = currentLanguage()

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-secondary hover:bg-surface-subtle hover:text-ink"
          aria-label={t('language.label')}
        >
          <Languages aria-hidden="true" className="size-4" strokeWidth={1.75} />
          <span className="uppercase">{active}</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-44 rounded-lg border border-line bg-surface p-1 shadow-overlay"
        >
          {SUPPORTED_LANGUAGES.map((language: Language) => (
            <DropdownMenu.Item
              key={language}
              onSelect={() => {
                changeLanguage(language).catch((error: unknown) => {
                  console.error('Failed to change language', error)
                })
              }}
              className={cn(
                'flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-base',
                'text-ink outline-none data-[highlighted]:bg-surface-subtle',
              )}
            >
              {t(`language.${language}`)}
              {active === language ? (
                <Check aria-hidden="true" className="size-4 text-primary-600" />
              ) : null}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
