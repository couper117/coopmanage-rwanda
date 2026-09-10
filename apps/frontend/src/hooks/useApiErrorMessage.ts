import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '@/lib/apiClient'
import { toI18nKey } from '@/lib/messageKey'

export interface DisplayableError {
  /** A translated sentence the user can act on. Never a status code or a stack trace. */
  message: string
  /**
   * The request id, when the failure came from the API. Screens show it as a quiet reference line
   * so a user reporting a problem can quote one string that identifies the exact request.
   */
  requestId: string | undefined
  /** Field name to translation key, ready to hand to a form. */
  fieldErrors: Record<string, string>
}

/**
 * Turns any thrown value into something a screen can display. It never shows a status code, a
 * stack trace or the raw server message when a translation exists for the key.
 */
export function useApiError(): (error: unknown) => DisplayableError {
  const { t } = useTranslation(['errors', 'validation', 'common'])

  return useCallback(
    (error: unknown): DisplayableError => {
      if (error instanceof ApiError) {
        return {
          message: t(toI18nKey(error.messageKey), {
            ...error.messageParams,
            defaultValue: error.message,
          }),
          requestId: error.requestId,
          fieldErrors: error.fieldErrors,
        }
      }
      return { message: t('errors:unexpected.body'), requestId: undefined, fieldErrors: {} }
    },
    [t],
  )
}
