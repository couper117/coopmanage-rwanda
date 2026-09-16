import { create } from 'zustand'

/**
 * Three states, because "offline" covers two situations a cooperative has to handle differently.
 *
 * - `online` — the last request that finished, finished.
 * - `offline` — the browser says there is no network at all. Nothing will work until it returns,
 *   and a reader should stop trying.
 * - `unreachable` — the browser has a network and the server is not answering. That is a district
 *   office whose link to the outside has dropped while the office wifi is perfectly fine, or a
 *   deployment in progress. The work already on the screen is still good and the next attempt may
 *   well succeed, which is a different thing to tell somebody.
 *
 * The state is not derived from `navigator.onLine` alone, because in this product's setting that
 * flag is often true while nothing can be reached. It is set by what actually happened to the last
 * request.
 */
export type ConnectionState = 'online' | 'offline' | 'unreachable'

interface ConnectionStoreState {
  /** What the browser thinks. False only when there is genuinely no network interface. */
  browserOnline: boolean
  /** False once a request has failed to reach the server, until one succeeds. */
  serverReachable: boolean
  /** When the server was last reached, so a screen can say how old what it shows is. */
  lastReachedAt: number | null
  setBrowserOnline: (online: boolean) => void
  reportReached: () => void
  reportUnreachable: () => void
}

export const useConnectionStore = create<ConnectionStoreState>()((set) => ({
  browserOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
  serverReachable: true,
  lastReachedAt: null,
  setBrowserOnline: (online) =>
    set(
      online
        ? { browserOnline: true }
        : // No network means the server is unreachable by definition; saying otherwise would let
          // the indicator claim a connection the browser has already ruled out.
          { browserOnline: false, serverReachable: false },
    ),
  reportReached: () => set({ serverReachable: true, lastReachedAt: Date.now() }),
  reportUnreachable: () => set({ serverReachable: false }),
}))

/**
 * The state, for anything outside React.
 *
 * The API client reports into this store on every request, and it is not a component. Reading and
 * writing through this object rather than through the hook keeps the client free of React.
 */
export const connectionState = {
  get(): ConnectionState {
    const { browserOnline, serverReachable } = useConnectionStore.getState()
    if (!browserOnline) return 'offline'
    return serverReachable ? 'online' : 'unreachable'
  },
  reached(): void {
    useConnectionStore.getState().reportReached()
  },
  unreachable(): void {
    useConnectionStore.getState().reportUnreachable()
  },
}

/**
 * Starts listening to the browser's own connectivity events. Called once, by the component that
 * owns the router, alongside the session restore.
 */
export function watchBrowserConnection(): () => void {
  if (typeof window === 'undefined') return () => undefined
  const { setBrowserOnline } = useConnectionStore.getState()
  const goOnline = (): void => setBrowserOnline(true)
  const goOffline = (): void => setBrowserOnline(false)
  window.addEventListener('online', goOnline)
  window.addEventListener('offline', goOffline)
  return () => {
    window.removeEventListener('online', goOnline)
    window.removeEventListener('offline', goOffline)
  }
}
