import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useApiError } from '@/hooks/useApiErrorMessage'
import { useAuthStore } from '@/stores/authStore'
import { useDebouncedValue } from '@/features/finance/finance.hooks'
import { fetchDashboard, searchEverything } from './dashboard.api'

/**
 * Server state for the dashboard.
 *
 * One key, one request. The figures are recomputed on the server at read time, so the stale time
 * is short: a manager who records a sale and returns to the dashboard should see it, and a minute
 * is long enough to keep a back-and-forth between two screens from refetching on every step.
 */
export const dashboardKeys = {
  all: ['dashboard'] as const,
  scope: (cooperativeId: string | null) => ['dashboard', cooperativeId] as const,
  search: (cooperativeId: string | null, query: string) =>
    ['dashboard', cooperativeId, 'search', query] as const,
}

function useCooperativeId(): string | null {
  return useAuthStore((state) => state.activeCooperativeId)
}

export function useDashboard() {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: dashboardKeys.scope(cooperativeId),
    queryFn: fetchDashboard,
    enabled: cooperativeId !== null,
    staleTime: 60 * 1000,
  })
}

/**
 * The search box.
 *
 * Held still for 250 ms after typing stops, and never sent below two characters — the server
 * refuses one, because a single letter matches most of a register. The previous results stay on
 * screen while the next are fetched, so the list does not blink empty mid-word and offer "nothing
 * found" to somebody halfway through a name.
 */
export function useSearch(query: string) {
  const cooperativeId = useCooperativeId()
  const debounced = useDebouncedValue(query.trim(), 250)

  return useQuery({
    queryKey: dashboardKeys.search(cooperativeId, debounced),
    queryFn: () => searchEverything(debounced),
    enabled: cooperativeId !== null && debounced.length >= 2,
    placeholderData: keepPreviousData,
  })
}

export function useDashboardError() {
  return useApiError()
}
