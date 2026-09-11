import { useTranslation } from 'react-i18next'

/**
 * Shown for the fraction of a second while the refresh cookie is exchanged for an access token.
 * Deliberately plain: a spinner and a sentence, no skeleton of a screen we may not end up showing.
 */
export function SessionLoading() {
  const { t } = useTranslation('common')
  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-sunken px-4">
      <p role="status" className="text-sm text-ink-muted">
        {t('state.loading')}…
      </p>
    </div>
  )
}
