import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'
import '../src/i18n'

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
  window.localStorage.clear()
})
