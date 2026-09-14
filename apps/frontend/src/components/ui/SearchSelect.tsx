import { Loader2, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { cn } from '@/lib/cn'

export interface SearchOption {
  value: string
  label: string
  /** A second line, for the code or place that tells two people of the same name apart. */
  hint?: string
}

export interface SearchSelectProps {
  /** The current selection, or null. Held by the parent, like every other control here. */
  value: SearchOption | null
  onChange: (option: SearchOption | null) => void
  /** What the parent found for the current query. Ordering is the parent's business. */
  options: SearchOption[]
  /** The text in the box. The parent owns it so it can debounce and fetch. */
  query: string
  onQueryChange: (query: string) => void
  loading?: boolean
  placeholder?: string
  /** Shown in the list when a query found nothing. */
  emptyLabel: string
  loadingLabel: string
  /** The accessible name of the control that clears the selection. */
  clearLabel: string
  invalid?: boolean
  disabled?: boolean
  id?: string
  'aria-describedby'?: string
}

/**
 * A picker over a list too long to put in a dropdown.
 *
 * The native `<select>` is the right control almost everywhere in this product and is used
 * everywhere it fits. It does not fit here: a cooperative has hundreds of members, the list lives
 * on the server, and finding one means typing part of a name, part of a member code or the last
 * digits of a phone number. That is a different job and needs a different control.
 *
 * Built on an ordinary text input rather than on a portalled listbox, for two reasons. A portal
 * inside a dialog is where focus handling goes wrong, and on the phones this product is used on a
 * list that escapes its container is a list that ends up half off the screen. The options render
 * in the form's own flow, absolutely positioned against a wrapper, so nothing leaves the dialog.
 *
 * Keyboard support is the whole of the contract: the arrows move the highlight, Enter takes it,
 * Escape closes without changing anything, and `aria-activedescendant` tells a screen reader which
 * option is highlighted without moving focus off the input. A control that can only be used with
 * a mouse would exclude the staff who work fastest.
 */
export function SearchSelect({
  value,
  onChange,
  options,
  query,
  onQueryChange,
  loading = false,
  placeholder,
  emptyLabel,
  loadingLabel,
  clearLabel,
  invalid = false,
  disabled = false,
  id,
  'aria-describedby': describedBy,
}: SearchSelectProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const listId = `${inputId}-options`
  const [open, setOpen] = useState(false)
  /**
   * Which option is highlighted, held as its value rather than its position.
   *
   * A position would need correcting every time the list changed, which means either an effect
   * that fires a second render or a stale index pointing at somebody the reader is no longer
   * looking at. A value needs neither: it is looked up in whatever the list holds now, and falls
   * back to the first option when what it names has gone.
   */
  const [highlightedValue, setHighlightedValue] = useState<string | null>(null)
  const wrapper = useRef<HTMLDivElement>(null)

  // A click anywhere else closes the list. Without this the options stay over the rest of the
  // form after the user has moved on, which reads as a stuck screen.
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent | TouchEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
    }
  }, [open])

  function choose(option: SearchOption) {
    onChange(option)
    onQueryChange('')
    setHighlightedValue(null)
    setOpen(false)
  }

  const found = options.findIndex((option) => option.value === highlightedValue)
  const highlighted = found === -1 ? 0 : found

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      if (options.length === 0) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      const next = options[(highlighted + step + options.length) % options.length]
      if (next) setHighlightedValue(next.value)
      return
    }

    if (event.key === 'Enter') {
      const option = options[highlighted]
      if (open && option) {
        // Only when the list is open and something is highlighted, so Enter in a closed box
        // submits the form as it would in any other field.
        event.preventDefault()
        choose(option)
      }
      return
    }

    if (event.key === 'Escape' && open) {
      event.preventDefault()
      setOpen(false)
    }
  }

  const highlightedId = options[highlighted] ? `${listId}-${highlighted}` : undefined

  return (
    <div ref={wrapper} className="relative">
      {value ? (
        <div
          className={cn(
            'flex min-h-9 items-center justify-between gap-2 rounded-md border px-3 py-1.5',
            invalid ? 'border-danger-fg bg-danger-bg' : 'border-line-strong bg-surface',
          )}
        >
          <span className="min-w-0">
            <span className="block truncate text-base text-ink">{value.label}</span>
            {value.hint ? (
              <span className="block truncate text-sm text-ink-muted">{value.hint}</span>
            ) : null}
          </span>
          <button
            type="button"
            onClick={() => {
              onChange(null)
              onQueryChange('')
            }}
            disabled={disabled}
            aria-label={clearLabel}
            className="shrink-0 rounded-sm p-1 text-ink-muted transition-colors hover:bg-surface-subtle hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
      ) : (
        <>
          <div className="relative">
            <input
              id={inputId}
              type="text"
              role="combobox"
              autoComplete="off"
              aria-expanded={open}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={open ? highlightedId : undefined}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              disabled={disabled}
              placeholder={placeholder}
              value={query}
              onChange={(event) => {
                onQueryChange(event.target.value)
                setOpen(true)
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={onKeyDown}
              className={cn(
                'h-9 w-full rounded-md border bg-surface px-3 text-base text-ink',
                'transition-colors focus:border-primary-600',
                'disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:text-ink-disabled',
                invalid ? 'border-danger-fg' : 'border-line-strong',
              )}
            />
            {loading ? (
              <Loader2
                aria-hidden="true"
                className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-ink-muted"
              />
            ) : null}
          </div>

          {open ? (
            <ul
              id={listId}
              role="listbox"
              className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-line-strong bg-surface py-1 shadow-lg"
            >
              {loading && options.length === 0 ? (
                <li className="px-3 py-2 text-sm text-ink-muted">{loadingLabel}</li>
              ) : null}
              {!loading && options.length === 0 ? (
                <li className="px-3 py-2 text-sm text-ink-muted">{emptyLabel}</li>
              ) : null}
              {options.map((option, index) => (
                <li
                  key={option.value}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === highlighted}
                  // The pointer event rather than the click, so the option is taken before the
                  // input loses focus and the outside-click handler closes the list underneath it.
                  onMouseDown={(event) => {
                    event.preventDefault()
                    choose(option)
                  }}
                  onMouseEnter={() => setHighlightedValue(option.value)}
                  className={cn(
                    'cursor-pointer px-3 py-2',
                    index === highlighted ? 'bg-surface-subtle' : '',
                  )}
                >
                  <span className="block truncate text-base text-ink">{option.label}</span>
                  {option.hint ? (
                    <span className="block truncate text-sm text-ink-muted">{option.hint}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </div>
  )
}
