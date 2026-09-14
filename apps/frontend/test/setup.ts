import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'
import '../src/i18n'
import { queryClient } from '../src/app/queryClient'
import { resetSession } from './session'

/**
 * jsdom implements no layout engine, and the Radix primitives the design system is built on rely
 * on a handful of browser APIs that follow from layout. Without these, any test that opens a menu,
 * dialog or select hangs rather than failing, which is far harder to diagnose than a missing
 * element. Everything here is a genuine browser API, not a stub for our own code.
 */
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
}

/**
 * jsdom implements no `matchMedia`, which every browser has and which the layout uses to decide
 * whether the sidebar shows its labels and whether a list renders as a table or as cards. This
 * evaluates min-width and max-width queries against `window.innerWidth`, so a test can set a
 * viewport width and get the layout that width produces.
 *
 * One global resize listener notifies every live query. An earlier version added a listener inside
 * `matchMedia` itself and never removed it, so every component that used a media query leaked one
 * per mount; by the end of a file a single `setViewportWidth` was waking hundreds of dead
 * listeners and a test that should take 40ms took eleven seconds.
 */
type QueryListener = (event: MediaQueryListEvent) => void

const mediaListeners = new Map<string, Set<QueryListener>>()

function matches(query: string): boolean {
  const min = /\(min-width:\s*(\d+)px\)/.exec(query)
  const max = /\(max-width:\s*(\d+)px\)/.exec(query)
  if (min) return window.innerWidth >= Number(min[1])
  if (max) return window.innerWidth <= Number(max[1])
  return false
}

export function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
  for (const [query, listeners] of mediaListeners) {
    const event = { matches: matches(query), media: query } as MediaQueryListEvent
    for (const listener of listeners) listener(event)
  }
  window.dispatchEvent(new Event('resize'))
}

if (!window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList => {
    const add = (listener: QueryListener): void => {
      const set = mediaListeners.get(query) ?? new Set<QueryListener>()
      set.add(listener)
      mediaListeners.set(query, set)
    }
    const remove = (listener: QueryListener): void => {
      const set = mediaListeners.get(query)
      if (!set) return
      set.delete(listener)
      if (set.size === 0) mediaListeners.delete(query)
    }

    return {
      get matches() {
        return matches(query)
      },
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: QueryListener) => add(listener),
      removeEventListener: (_type: string, listener: QueryListener) => remove(listener),
      addListener: add,
      removeListener: remove,
      dispatchEvent: () => true,
    } as unknown as MediaQueryList
  }
}

if (!('PointerEvent' in globalThis)) {
  // jsdom does not implement PointerEvent at all, and Radix triggers open on pointerdown. Without
  // this, menus, dialogs and selects silently never open and the test times out instead of failing.
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number
    readonly pointerType: string
    readonly isPrimary: boolean

    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params)
      this.pointerId = params.pointerId ?? 1
      this.pointerType = params.pointerType ?? 'mouse'
      this.isPrimary = params.isPrimary ?? true
    }
  }
  globalThis.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent
}

if (!('DOMRect' in globalThis)) {
  globalThis.DOMRect = class DOMRect {
    constructor(
      public x = 0,
      public y = 0,
      public width = 0,
      public height = 0,
    ) {}
    get top(): number {
      return this.y
    }
    get left(): number {
      return this.x
    }
    get right(): number {
      return this.x + this.width
    }
    get bottom(): number {
      return this.y + this.height
    }
    toJSON(): object {
      return { ...this }
    }
    static fromRect(rect?: DOMRectInit): DOMRect {
      return new DOMRect(rect?.x, rect?.y, rect?.width, rect?.height)
    }
  }
}

beforeEach(() => {
  // Tests describe a desktop viewport unless they say otherwise, which is where the full sidebar
  // with its labels applies.
  setViewportWidth(1440)

  // Pointer capture and scrollIntoView are used by menus and selects for focus management.
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {}
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {}
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {}
  }
})

afterEach(() => {
  cleanup()

  // Radix's dismissable layers set body styles and aria-hidden on siblings while an overlay is
  // open, and restore them on unmount. A test that ends with one open leaves that state behind,
  // where it slows or confuses whatever renders next. Clearing it is cheap insurance.
  document.body.style.pointerEvents = ''
  document.body.removeAttribute('data-scroll-locked')
  for (const node of document.body.querySelectorAll('[aria-hidden="true"]')) {
    node.removeAttribute('aria-hidden')
  }
  window.localStorage.clear()
  // A session must not leak from one test into the next: a guarded screen rendering because an
  // earlier test signed somebody in would hide exactly the bug these tests exist to catch.
  resetSession()
  // The query client is a module singleton, so a cached result from one test would be served to
  // the next inside its stale time — which reads as "the screen showed nothing" rather than as
  // the leak it is.
  queryClient.clear()
})
