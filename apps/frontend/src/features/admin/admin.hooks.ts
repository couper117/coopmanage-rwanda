import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SelectOption } from '@/components/ui'
import { useApiError, type DisplayableError } from '@/hooks/useApiErrorMessage'
import { ApiError } from '@/lib/apiClient'
import {
  fetchCooperativeTypes,
  type AdminCooperativeFilters,
  type AdminUserFilters,
} from './admin.api'

/**
 * Query keys for the platform screens, in one place so an invalidation after a mutation cannot
 * miss a list that a filter happens to have keyed differently.
 */
export const adminKeys = {
  all: ['admin'] as const,
  cooperatives: (filters: AdminCooperativeFilters) => ['admin', 'cooperatives', filters] as const,
  cooperativeList: ['admin', 'cooperatives'] as const,
  users: (filters: AdminUserFilters) => ['admin', 'users', filters] as const,
  userList: ['admin', 'users'] as const,
  settings: ['admin', 'settings'] as const,
  health: ['admin', 'health'] as const,
  cooperativeTypes: ['admin', 'cooperativeTypes'] as const,
}

/**
 * Holds a value still until typing stops, so a search field does not send one request per
 * keystroke across every cooperative on the platform.
 */
export function useDebouncedValue<TValue>(value: TValue, delay = 250): TValue {
  const [settled, setSettled] = useState(value)

  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])

  return settled
}

/**
 * The refusals that are specific to platform administration, mapped to sentences that say what to
 * do about them. The shared error hook translates everything else; these keys belong to this
 * screen's own namespace because the remedy is particular to it — "ask another administrator",
 * "deactivate the staff first" — rather than a generic conflict message.
 */
const ADMIN_MESSAGE_KEYS: Readonly<Record<string, string>> = {
  'errors.admin.archiveHasStaff': 'apiErrors.archiveHasStaff',
  'errors.admin.notSelf': 'apiErrors.notSelf',
  'errors.admin.lastPlatformAdmin': 'apiErrors.lastPlatformAdmin',
  'errors.admin.cooperativeCodeTaken': 'apiErrors.cooperativeCodeTaken',
  'errors.admin.emailTaken': 'apiErrors.emailTaken',
  'errors.admin.managerSuspended': 'apiErrors.managerSuspended',
  'errors.cooperative.registrationNumberTaken': 'apiErrors.registrationNumberTaken',
}

export function useAdminError(): (error: unknown) => DisplayableError {
  const describeError = useApiError()
  const { t } = useTranslation('admin')

  return useCallback(
    (error: unknown): DisplayableError => {
      const described = describeError(error)
      if (!(error instanceof ApiError)) return described
      const key = ADMIN_MESSAGE_KEYS[error.messageKey]
      if (!key) return described
      return { ...described, message: t(key, { ...error.messageParams }) }
    },
    [describeError, t],
  )
}

/**
 * The cooperative type picker. Types are public reference data with a name per language, so the
 * option labels come from the API rather than from a translation file that would have to be kept
 * in step with the seed.
 */
export function useCooperativeTypeOptions(): {
  options: SelectOption[]
  isPending: boolean
  isError: boolean
} {
  const { i18n } = useTranslation('admin')
  const query = useQuery({
    queryKey: adminKeys.cooperativeTypes,
    queryFn: fetchCooperativeTypes,
    staleTime: 60 * 60_000,
  })

  const kinyarwanda = i18n.resolvedLanguage === 'rw'
  const options = (query.data ?? []).map((type) => ({
    value: type.key,
    label: kinyarwanda ? type.nameRw : type.nameEn,
  }))

  return { options, isPending: query.isPending, isError: query.isError }
}

/**
 * Dates on the platform screens.
 *
 * Kinyarwanda has no distinct CLDR date format in this product, so both languages use the
 * day-month-year order Rwandan offices write, rather than an American one that would read as a
 * different date entirely.
 */
function intlLocale(language: string | undefined): string {
  return language === 'rw' ? 'en-RW' : 'en-GB'
}

export function useFormatDate(): (iso: string) => string {
  const { i18n } = useTranslation('admin')
  const locale = intlLocale(i18n.resolvedLanguage)
  return useCallback(
    (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso)),
    [locale],
  )
}

export function useFormatDateTime(): (iso: string) => string {
  const { i18n } = useTranslation('admin')
  const locale = intlLocale(i18n.resolvedLanguage)
  return useCallback(
    (iso: string) =>
      new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(iso),
      ),
    [locale],
  )
}

export function useFormatNumber(): (value: number) => string {
  const { i18n } = useTranslation('admin')
  const locale = intlLocale(i18n.resolvedLanguage)
  return useCallback((value: number) => new Intl.NumberFormat(locale).format(value), [locale])
}
