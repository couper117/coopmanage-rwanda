import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '@/lib/apiClient'
import { toI18nKey } from '@/lib/messageKey'

/**
 * Turns any thrown value into a sentence a cooperative officer can act on. It never shows a status
 * code, a stack trace or the raw server message when a translation exists.
 */
export function useApiErrorMessage(): (error: unknown) => string {
  const { t } = useTranslation(['errors', 'validation', 'common'])

  return useCallback(
    (error: unknown): string => {
      if (error instanceof ApiError) {
        return t(toI18nKey(error.messageKey), {
          ...error.messageParams,
          defaultValue: error.message,
        })
      }
      return t('errors:unexpected.body')
    },
    [t],
  )
}
