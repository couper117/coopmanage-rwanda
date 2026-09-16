import { useCallback, useState } from 'react'

/**
 * Keeps what somebody was typing, so a reload does not throw it away.
 *
 * The situation is specific and it is the one Phase 13 exists for. A treasurer is halfway through
 * a sale with eleven lines on it. The district office's connection drops, or the laptop's battery
 * goes, or somebody reloads the tab out of habit. Without this the eleven lines are gone and the
 * afternoon starts again; with it they are still there, and the screen offers them back.
 *
 * **Offered, not silently restored.** A form that quietly fills itself with yesterday's half-typed
 * entry is worse than an empty one: somebody submits it without reading. So a draft is announced —
 * "you were in the middle of this" — and it is the reader who says whether to take it up or throw
 * it away.
 *
 * **Scoped and short-lived.** The key names the cooperative and the form, so one cooperative's
 * half-written sale cannot appear on another's screen, and a draft older than a day is discarded
 * rather than offered: a form from last week is not something anybody is in the middle of.
 *
 * **Never a money record.** A draft is what was typed into a form. Nothing here writes to the
 * cooperative's books, nothing is queued for sending later, and nothing is retried on the
 * cooperative's behalf. An unsent entry stays unsent and visible, which is the honest state — a
 * queue of financial writes waiting for a connection would be a second source of truth about the
 * cooperative's money.
 */

const PREFIX = 'coopmanage.draft'

/** A day. A form somebody left open last week is not one they are in the middle of. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000

interface StoredDraft<TValues> {
  savedAt: number
  values: TValues
}

function keyFor(cooperativeId: string | null, form: string, recordId?: string): string {
  return [PREFIX, cooperativeId ?? 'none', form, recordId ?? 'new'].join(':')
}

function readDraft<TValues>(key: string, now: number): TValues | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredDraft<TValues>
    if (typeof parsed !== 'object' || parsed === null) return null
    if (now - parsed.savedAt > MAX_AGE_MS) {
      window.localStorage.removeItem(key)
      return null
    }
    return parsed.values
  } catch {
    // A private window, cleared site data, a browser set to block storage. Nothing to restore.
    return null
  }
}

export interface FormDraft<TValues> {
  /** What was found in storage when the form opened, or null. Offer it; never apply it silently. */
  offered: TValues | null
  /** Saves the current values. Throttled by the caller's own typing, not by a timer. */
  save: (values: TValues) => void
  /** Called when the reader takes the draft up, or throws it away. Both clear the offer. */
  dismiss: () => void
  /** Called after a successful submit: what was typed has been recorded, so the draft is done. */
  clear: () => void
}

/**
 * Reads any stored draft once, on mount, and returns a saver.
 *
 * Deliberately not a controlled hook over the form's state: this product's forms are React Hook
 * Form or plain `useState`, and a draft hook that owned the values would have to be wired into
 * both. It stores what it is handed and reports what it found.
 */
export function useFormDraft<TValues>(options: {
  cooperativeId: string | null
  /** A stable name for the form: `sale`, `member`, `finance-entry`. */
  form: string
  /** The record being edited, so two open drafts of different records do not collide. */
  recordId?: string
  /** False while the form is not open, so nothing is read or written for a closed dialog. */
  enabled?: boolean
}): FormDraft<TValues> {
  const { cooperativeId, form, recordId, enabled = true } = options
  const key = keyFor(cooperativeId, form, recordId)

  /**
   * Read once, when the form opens.
   *
   * Every caller mounts its form only while it is open — the pattern this codebase uses instead of
   * reset effects — so "on mount" and "when the form opens" are the same moment, and the key
   * cannot change underneath a mounted form: a dialog for a different record is a different mount,
   * and a form whose record comes from the route remounts with it.
   *
   * A lazy initialiser rather than an effect, because an effect would render the form empty and
   * then offer the draft a frame later: a flicker on the one screen where somebody is looking for
   * their work.
   */
  const [stored, setStored] = useState<TValues | null>(() => {
    if (!enabled || typeof window === 'undefined') return null
    return readDraft<TValues>(key, Date.now())
  })

  const save = useCallback(
    (values: TValues) => {
      if (!enabled || typeof window === 'undefined') return
      try {
        const payload: StoredDraft<TValues> = { savedAt: Date.now(), values }
        window.localStorage.setItem(key, JSON.stringify(payload))
      } catch {
        // Storage full or refused. The form still works; only the reload safety net is lost.
      }
    },
    [enabled, key],
  )

  const clear = useCallback(() => {
    setStored(null)
    if (typeof window === 'undefined') return
    try {
      window.localStorage.removeItem(key)
    } catch {
      // As above.
    }
  }, [key])

  /** The reader has answered the offer by taking it up. The stored copy stays until they submit. */
  const dismiss = useCallback(() => setStored(null), [])

  return { offered: stored, save, dismiss, clear }
}

/** Removes every stored draft. Called on sign-out, like the persisted cache. */
export function clearAllDrafts(): void {
  if (typeof window === 'undefined') return
  try {
    const keys: string[] = []
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (key?.startsWith(PREFIX)) keys.push(key)
    }
    for (const key of keys) window.localStorage.removeItem(key)
  } catch {
    // Nothing to do.
  }
}
