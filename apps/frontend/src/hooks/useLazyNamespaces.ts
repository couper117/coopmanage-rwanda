import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { currentLanguage, hasNamespaces, loadNamespaces, type FeatureNamespace } from '@/i18n'

/**
 * Fetches translations for a panel rather than for a screen.
 *
 * Routes load their strings in the lazy loader, before the screen renders, which is right when the
 * whole screen needs them. This is for the other case: a screen that is otherwise eager and
 * carries **one** block whose strings are large and which most readers cannot even see.
 *
 * The dashboard's recent-activity list is that block. It quotes whichever module wrote each entry,
 * so it needs nearly every namespace — the cost `AUDIT_MESSAGE_NAMESPACES` exists to record — and
 * only a reader holding `audit:view` has an activity list at all. Bundling those strings into the
 * first download so that a storekeeper can not-see them is exactly the waste the split was for.
 *
 * So the block asks for its own strings once the page is on screen and renders a skeleton in its
 * own place until they arrive. It never shows a key at a reader, and it never delays a figure
 * above it.
 *
 * Returns true the moment the strings are present — synchronously, when a screen visited earlier
 * in the session already loaded them, so revisiting the dashboard does not flash a skeleton.
 */
export function useLazyNamespaces(namespaces: readonly FeatureNamespace[]): boolean {
  const { i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? i18n.language
  // The list is a module constant at every call site; joining it keeps the effect from re-running
  // on a caller that happens to build the array inline.
  const names = namespaces.join(',')

  /**
   * What has been loaded, rather than whether it is loading.
   *
   * Holding the language and the list this resolved for means a language change is answered by the
   * derived value below going false on the same render, with no effect that sets state on the way
   * in. React rightly warns about that pattern: it costs a second render of the whole page and, in
   * this component, would have shown a skeleton for a frame on every single visit.
   */
  const [loaded, setLoaded] = useState<string | null>(null)
  const signature = `${language}:${names}`

  useEffect(() => {
    let cancelled = false
    void loadNamespaces(namespaces, currentLanguage()).then(() => {
      if (!cancelled) setLoaded(signature)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `signature` stands in for the array
  }, [signature])

  return loaded === signature || hasNamespaces(namespaces, currentLanguage())
}
