import { useTranslation } from 'react-i18next'
import { Alert, Button } from '@/components/ui'
import { type DisplayableError, useApiError } from '@/hooks/useApiErrorMessage'

/**
 * A load that failed, with the one thing a reader can do about it.
 *
 * `docs/ui-system.md` §8 says every error carries a plain sentence and "Try again". Twenty-five
 * screens wrote that by hand and nine forgot the button, which the Phase 16 pass found — so this is
 * the pattern once, and a screen that fails to load has nothing to remember.
 *
 * For a **load**. A mutation that failed keeps its form on screen with the message above it, and
 * the submit button is the retry; putting a second "Try again" beside it would be two buttons that
 * do the same thing.
 */
export function LoadError({
  error,
  onRetry,
  title,
  describe: describeOverride,
}: {
  error: unknown
  /** The query's own `refetch`. */
  onRetry: () => unknown
  /** Names what failed to load, where the message alone would not say. */
  title?: string
  /** A module's own error describer, where it has one. Defaults to the generic one. */
  describe?: (error: unknown) => DisplayableError
}) {
  const { t } = useTranslation('common')
  const generic = useApiError()
  const describe = describeOverride ?? generic

  return (
    <Alert
      tone="danger"
      title={title}
      action={
        <Button variant="secondary" size="sm" onClick={() => void onRetry()}>
          {t('actions.retry')}
        </Button>
      }
    >
      {describe(error).message}
    </Alert>
  )
}
