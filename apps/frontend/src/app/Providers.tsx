import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { TooltipProvider } from '@/components/ui'
import { RouteErrorBoundary } from './RouteErrorBoundary'
import { queryClient } from './queryClient'

/**
 * The outermost boundary is a last resort for a failure in a provider itself. Screen-level
 * failures are caught inside the application shell, where the navigation survives them.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <RouteErrorBoundary>{children}</RouteErrorBoundary>
      </TooltipProvider>
    </QueryClientProvider>
  )
}
