import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useVisibleNavigation } from './useVisibleNavigation'

/**
 * How long after `g` a letter still counts. Long enough to be typed as two deliberate keys, short
 * enough that a `g` pressed by accident does not turn the next letter into a page change.
 */
export const SHORTCUT_SEQUENCE_MS = 1500

/**
 * Whether a keystroke belongs to what the reader is doing rather than to the page: somebody typing
 * a member's name into a field, or working inside a dialog, keeps every key.
 */
export function keystrokeIsTaken(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return true
  const active = document.activeElement
  const tag = active?.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  if (active instanceof HTMLElement && active.isContentEditable) return true
  if (document.querySelector('[role="dialog"]')) return true
  return false
}

/**
 * The application's keyboard shortcuts, documented in `docs/ui-system.md` §9 and listed for the
 * reader by the `?` dialog.
 *
 * - `g` then a letter goes to a screen: the letter is the item's `shortcut` in `NAV_GROUPS`, and
 *   only screens the reader can see are reachable — the same list the sidebar shows, from the same
 *   hook, so there is no second navigation with its own rules.
 * - `?` opens the list of shortcuts.
 * - `/` focuses search, which the search box handles itself so the shortcut exists exactly where
 *   the box does.
 *
 * Every shortcut is a plain key with no modifier, so none collides with a screen reader's own
 * bindings or a browser's, and all of them yield to a field or a dialog that has focus.
 */
export function useKeyboardShortcuts({ onHelp }: { onHelp: () => void }): void {
  const navigate = useNavigate()
  const groups = useVisibleNavigation()
  const armedUntil = useRef(0)

  useEffect(() => {
    const targets = new Map<string, string>()
    for (const group of groups) {
      for (const item of group.items) {
        if (item.shortcut) targets.set(item.shortcut, item.to)
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (keystrokeIsTaken(event)) return

      if (event.key === '?') {
        event.preventDefault()
        armedUntil.current = 0
        onHelp()
        return
      }

      if (event.key === 'g') {
        event.preventDefault()
        armedUntil.current = Date.now() + SHORTCUT_SEQUENCE_MS
        return
      }

      if (armedUntil.current === 0) return
      const armed = Date.now() <= armedUntil.current
      armedUntil.current = 0
      if (!armed) return

      const to = targets.get(event.key)
      if (to === undefined) return
      event.preventDefault()
      void navigate(to)
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [groups, navigate, onHelp])
}
