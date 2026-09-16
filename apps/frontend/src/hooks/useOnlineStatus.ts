import { useEffect } from 'react'
import {
  useConnectionStore,
  watchBrowserConnection,
  type ConnectionState,
} from '@/stores/connectionStore'

export type { ConnectionState }

/**
 * What state the connection is in, as three answers rather than two.
 *
 * `navigator.onLine` alone is not enough in this product's setting: a district office's wifi is up
 * and its link to the outside is down, and the browser reports "online" throughout. So the state
 * is decided by what actually happened to the last request — the API client reports every success
 * and every failure to reach the server — with the browser's own flag used for the one thing it is
 * reliable about, which is telling you there is no network at all.
 *
 * Phase 1 shaped this as a union for exactly this reason; Phase 13 filled in the third state.
 */
export function useOnlineStatus(): ConnectionState {
  const browserOnline = useConnectionStore((state) => state.browserOnline)
  const serverReachable = useConnectionStore((state) => state.serverReachable)

  if (!browserOnline) return 'offline'
  return serverReachable ? 'online' : 'unreachable'
}

/** How long ago the server was last reached, in milliseconds, or null if never in this session. */
export function useLastReachedAt(): number | null {
  return useConnectionStore((state) => state.lastReachedAt)
}

/**
 * Subscribes to the browser's connectivity events for the life of the application. Called once,
 * by the component that owns the router.
 */
export function useWatchConnection(): void {
  useEffect(() => watchBrowserConnection(), [])
}
