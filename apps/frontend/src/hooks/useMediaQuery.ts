import { useCallback, useSyncExternalStore } from 'react'

/**
 * Subscribes to a CSS media query. Used where a layout decision cannot be expressed in CSS alone,
 * such as the sidebar, whose collapsed state changes which elements render rather than only how
 * they look.
 *
 * Built on `useSyncExternalStore` because that is what it is: an external, mutable browser value
 * that React must read consistently. Doing it with `useState` plus an effect means writing state
 * during the effect, which risks a cascading render and a first paint at the wrong breakpoint.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {}
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    [query],
  )

  const getSnapshot = useCallback(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia(query).matches
  }, [query])

  // On the server there is no viewport, so the narrow layout is assumed. The application is a
  // single-page client render, so this only matters if server rendering is added later.
  const getServerSnapshot = useCallback(() => false, [])

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/** The breakpoint above which the sidebar can show its labels. Matches Tailwind's `xl`. */
export const WIDE_LAYOUT_QUERY = '(min-width: 1280px)'
