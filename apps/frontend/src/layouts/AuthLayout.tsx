import { Sprout } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'

/**
 * The shell for the three screens that exist before a session does.
 *
 * Two intentional layouts rather than one that shrinks: a split with a quiet brand panel from
 * 1024px, and a single centred column below it. The panel carries a wordmark and one sentence,
 * and no illustration — this is the first screen a cooperative's staff see every morning, and it
 * should read as an office system rather than as a product launch page.
 */
export function AuthLayout({
  title,
  description,
  children,
  footer,
}: {
  title: string
  description: string
  children: ReactNode
  footer?: ReactNode
}) {
  const { t } = useTranslation(['common', 'auth'])

  return (
    <div className="flex min-h-dvh bg-surface-sunken">
      <aside className="hidden w-2/5 max-w-lg flex-col justify-between bg-primary-800 p-10 text-ink-inverse lg:flex">
        <div className="flex items-center gap-2">
          <Sprout aria-hidden="true" className="size-5 text-primary-200" strokeWidth={1.75} />
          <span className="text-base font-semibold">{t('common:appName')}</span>
        </div>
        <div>
          <p className="text-xl leading-relaxed font-medium text-balance">
            {t('auth:brand.headline')}
          </p>
          <p className="mt-3 max-w-sm text-base text-white/70">{t('auth:brand.body')}</p>
        </div>
        <p className="text-xs text-white/50">{t('auth:brand.footnote')}</p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex justify-end p-4">
          <LanguageSwitcher />
        </div>
        <main className="flex flex-1 items-start justify-center px-4 pb-12 sm:items-center">
          <div className="w-full max-w-sm">
            <div className="mb-6 flex items-center gap-2 lg:hidden">
              <Sprout aria-hidden="true" className="size-5 text-primary-600" strokeWidth={1.75} />
              <span className="text-base font-semibold text-ink">{t('common:appName')}</span>
            </div>

            <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
            <p className="mt-1.5 text-base text-ink-muted">{description}</p>

            <div className="mt-6">{children}</div>
            {footer ? <div className="mt-6 text-sm text-ink-muted">{footer}</div> : null}
          </div>
        </main>
      </div>
    </div>
  )
}
