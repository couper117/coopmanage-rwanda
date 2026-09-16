import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, type ReactNode } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { hydrateCache, persistCache } from './persistCache'

/**
 * Restores the last-seen data once the session is known, then keeps saving it.
 *
 * The timing is the whole reason this is a component rather than two calls beside the query
 * client. The cache is stored per reader and per cooperative, so it cannot be hydrated until the
 * refresh cookie has been exchanged and both are known — which is after the application has
 * started rendering. Hydrating earlier would mean either one shared key, which on a shared office
 * computer shows one person's figures to the next, or no scoping at all.
 *
 * It renders its children throughout. A reader waiting for a hydrate they cannot see would be a
 * blank screen in exchange for a cache whose whole purpose is to avoid one.
 */
export function PersistedCache({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const userId = useAuthStore((state) => state.user?.id ?? null)
  const cooperativeId = useAuthStore((state) => state.activeCooperativeId)
  /**
   * Which reader and cooperative have been hydrated, held in a ref rather than in state.
   *
   * Nothing renders from it: it exists so a second run of this effect — a re-render, React's
   * development double-invoke — does not hydrate twice. State would mean setting state inside an
   * effect for a value no output depends on, which is a cascading render for nothing.
   */
  const restoredFor = useRef<string | null>(null)

  useEffect(() => {
    if (userId === null || cooperativeId === null) return

    const signature = `${userId}:${cooperativeId}`
    const session = { userId, cooperativeId }

    // Hydrated once per reader and cooperative. Switching cooperative loads that cooperative's own
    // stored cache; every query key is scoped by cooperative as well, so the two cannot mix.
    if (restoredFor.current !== signature) {
      restoredFor.current = signature
      hydrateCache(queryClient, session)
    }

    return persistCache(queryClient, session)
  }, [queryClient, userId, cooperativeId])

  return children
}
