import { useEffect, useState } from 'react'

export type ConnectionState = 'online' | 'offline'

/**
 * Browser connectivity. Phase 13 extends this with a server reachability probe so the indicator
 * can distinguish "no network" from "server not answering"; the state union is already shaped for
 * that, so the indicator will not need rewriting.
 */
export function useOnlineStatus(): ConnectionState {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )

  useEffect(() => {
    const goOnline = (): void => setOnline(true)
    const goOffline = (): void => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  return online ? 'online' : 'offline'
}
