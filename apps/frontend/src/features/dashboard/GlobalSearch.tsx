import { Loader2, Search, X } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { SEARCH_KINDS, type SearchHit, type SearchKind } from './dashboard.api'
import { useSearch } from './dashboard.hooks'

/**
 * One box that finds anything in the cooperative.
 *
 * A cooperative's register runs to hundreds of members, its catalogue to dozens of products and
 * its sales to thousands of rows, and the fastest way to reach any of them is to type part of what
 * you remember: half a name, a member code, the last digits of a phone number, a sale's reference.
 * That is what this is for, and it is why it sits in the top bar on every screen rather than on the
 * dashboard alone.
 *
 * **Grouped by kind, ordered by match.** The server ranks by how well each row matched and returns
 * at most five of each kind, so one noisy resource cannot crowd out the rest. The groups are laid
 * out in the order of their best hit, so a member code typed in full puts members first without
 * hiding the sale that quotes it.
 *
 * **Nothing the reader may not open is here**, and not because it was filtered out — the server
 * never queried it. A kind their role does not cover is named below the results, because a
 * storekeeper searching for a member should be told the register was not searched rather than
 * conclude the member does not exist.
 *
 * Built on a plain input and an absolutely positioned list rather than a portal, the same choice
 * and for the same reasons as `SearchSelect`: on a phone a list that escapes its container ends up
 * half off the screen. Keyboard support is the whole contract — `/` from anywhere puts the cursor
 * here, the arrows move the highlight, Enter opens it, Escape closes without navigating.
 */

/** The order groups fall back to when two kinds matched equally well. */
const KIND_ORDER: Readonly<Record<SearchKind, number>> = {
  member: 0,
  product: 1,
  sale: 2,
  buyer: 3,
  document: 4,
  meeting: 5,
}

interface Group {
  kind: SearchKind
  hits: SearchHit[]
}

/** Groups the hits by kind, keeping each group in the order the server ranked them. */
function group(hits: SearchHit[]): Group[] {
  const groups = new Map<SearchKind, SearchHit[]>()
  for (const hit of hits) {
    const existing = groups.get(hit.kind)
    if (existing) existing.push(hit)
    else groups.set(hit.kind, [hit])
  }

  return [...groups.entries()]
    .map(([kind, rows]) => ({ kind, hits: rows }))
    .sort((a, b) => {
      const best = (rows: SearchHit[]) => Math.max(...rows.map((hit) => hit.score))
      const difference = best(b.hits) - best(a.hits)
      return difference !== 0 ? difference : KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
    })
}

export function GlobalSearch() {
  const { t } = useTranslation(['dashboard', 'common'])
  const navigate = useNavigate()
  const inputId = useId()
  const listId = `${inputId}-results`
  const input = useRef<HTMLInputElement>(null)
  const wrapper = useRef<HTMLDivElement>(null)

  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  /**
   * The highlighted hit, held as its id rather than its position — a position would point at
   * whoever happens to be in that slot after the next keystroke, which is how a reader ends up
   * opening the wrong member.
   */
  const [highlightedId, setHighlightedId] = useState<string | null>(null)

  const results = useSearch(query)
  const groups = group(results.data?.hits ?? [])
  const flat = groups.flatMap((entry) => entry.hits)
  const found = flat.findIndex((hit) => hit.id === highlightedId)
  const highlighted = found === -1 ? 0 : found

  const close = useCallback(() => {
    setOpen(false)
    setHighlightedId(null)
  }, [])

  // `/` is the shortcut every reader of this kind of product already knows. It must not fire while
  // somebody is typing a member's name into a form, so a field with focus keeps the keystroke.
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
      const active = document.activeElement
      const tag = active?.tagName.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return
      if (active instanceof HTMLElement && active.isContentEditable) return
      event.preventDefault()
      input.current?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  // A click anywhere else closes the list, so it does not sit over the screen the reader moved on
  // to, which reads as a stuck page.
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent | TouchEvent) {
      if (!wrapper.current?.contains(event.target as Node)) close()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
    }
  }, [open, close])

  function go(hit: SearchHit) {
    setQuery('')
    close()
    void navigate(hit.href)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      // Escape closes the list and leaves the text alone, so a mistyped search can be corrected
      // rather than retyped. A second Escape, on a closed list, clears the box.
      if (open) close()
      else setQuery('')
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      if (flat.length === 0) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      const next = flat[(highlighted + step + flat.length) % flat.length]
      if (next) setHighlightedId(next.id)
      return
    }
    if (event.key === 'Enter') {
      const hit = flat[highlighted]
      if (open && hit) {
        event.preventDefault()
        go(hit)
      }
    }
  }

  const short = query.trim().length > 0 && query.trim().length < 2
  const showList = open && query.trim().length > 0

  return (
    <div ref={wrapper} className="relative hidden min-w-0 flex-1 sm:block">
      <label className="sr-only" htmlFor={inputId}>
        {t('dashboard:search.label')}
      </label>
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
        />
        <input
          ref={input}
          id={inputId}
          type="search"
          role="combobox"
          autoComplete="off"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={
            showList && flat[highlighted] ? `${inputId}-hit-${flat[highlighted].id}` : undefined
          }
          value={query}
          placeholder={t('dashboard:search.placeholder')}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
            setHighlightedId(null)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="h-9 w-full max-w-md rounded-md border border-line bg-surface-subtle pl-8 pr-8 text-sm text-ink placeholder:text-ink-muted focus-visible:border-primary-600 focus-visible:bg-surface focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-600"
        />
        {query.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              setQuery('')
              close()
              input.current?.focus()
            }}
            aria-label={t('dashboard:search.close')}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-ink-muted hover:text-ink"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        ) : null}
      </div>

      {showList ? (
        <div
          id={listId}
          className="absolute left-0 top-full z-40 mt-1 w-full max-w-md overflow-hidden rounded-md border border-line-strong bg-surface shadow-overlay"
        >
          {short ? (
            <p className="px-3 py-2.5 text-sm text-ink-muted">{t('dashboard:search.hint')}</p>
          ) : results.isFetching && flat.length === 0 ? (
            <p className="flex items-center gap-2 px-3 py-2.5 text-sm text-ink-muted">
              <Loader2 aria-hidden="true" className="size-4 motion-safe:animate-spin" />
              {t('dashboard:search.searching')}
            </p>
          ) : flat.length === 0 ? (
            <p className="px-3 py-2.5 text-sm text-ink-muted">
              {t('dashboard:search.empty', { query: query.trim() })}
            </p>
          ) : (
            <ul
              role="listbox"
              aria-label={t('dashboard:search.label')}
              className="max-h-80 overflow-y-auto py-1"
            >
              {groups.map((entry) => (
                <li key={entry.kind} role="presentation">
                  <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    {t(`dashboard:search.kind.${entry.kind}`)}
                  </p>
                  <ul role="presentation">
                    {entry.hits.map((hit) => (
                      <li
                        key={hit.id}
                        id={`${inputId}-hit-${hit.id}`}
                        role="option"
                        aria-selected={flat[highlighted]?.id === hit.id}
                        onMouseEnter={() => setHighlightedId(hit.id)}
                        className={
                          flat[highlighted]?.id === hit.id
                            ? 'cursor-pointer bg-primary-50 px-3 py-1.5'
                            : 'cursor-pointer px-3 py-1.5'
                        }
                        // A mouse press, not a click: the pointer-down listener above would close
                        // the list before a click on it ever landed.
                        onMouseDown={(event) => {
                          event.preventDefault()
                          go(hit)
                        }}
                      >
                        <span className="block truncate text-sm text-ink">{hit.title}</span>
                        {hit.subtitle ? (
                          <span className="block truncate text-xs text-ink-muted">
                            {hit.subtitle}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}

          {results.data && results.data.truncated ? (
            <p className="border-t border-line px-3 py-2 text-xs text-ink-muted">
              {t('dashboard:search.truncated')}
            </p>
          ) : null}

          {/*
            Named rather than silently absent, for the same reason the dashboard names a withheld
            block: "nothing found" and "not searched" are different answers, and only one of them
            is true.
          */}
          {results.data && results.data.withheld.length > 0 ? (
            <p className="border-t border-line px-3 py-2 text-xs text-ink-muted">
              {t('dashboard:search.withheld', {
                kinds: SEARCH_KINDS.filter((kind) => results.data?.withheld.includes(kind))
                  .map((kind) => t(`dashboard:search.kind.${kind}`))
                  .join(', '),
              })}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
