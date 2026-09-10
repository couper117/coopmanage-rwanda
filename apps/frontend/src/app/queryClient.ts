import { QueryClient } from '@tanstack/react-query'
import { ApiError } from '@/lib/apiClient'

/**
 * Reads retry on transient failures only. A mutation never retries automatically here: from
 * Phase 13 a mutation retries only when it carries an idempotency key, because replaying a
 * financial write without one is how systems create duplicate money.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry(failureCount, error) {
        if (error instanceof ApiError && !error.isRetryable) return false
        return failureCount < 2
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    },
    mutations: {
      retry: false,
    },
  },
})
