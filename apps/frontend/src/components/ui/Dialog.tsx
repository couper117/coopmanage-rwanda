import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { type ReactNode, type RefObject, useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'

export type DialogWidth = 'sm' | 'md' | 'lg'

const WIDTHS: Record<DialogWidth, string> = {
  sm: 'max-w-[480px]',
  md: 'max-w-[640px]',
  lg: 'max-w-[800px]',
}

export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** One sentence of context. Also the dialog's accessible description. */
  description?: string
  width?: DialogWidth
  /** Footer content, usually a cancel and a confirm button. */
  footer?: ReactNode
  children?: ReactNode
  /**
   * Blocks closing by scrim, Escape or the close button. Used while a submission is in flight, so
   * a half-finished write cannot be abandoned by a stray click.
   */
  busy?: boolean
}

/**
 * Where focus goes when the dialog opens: the first field, so a person can start typing; failing
 * that, the first footer button, which is Cancel — the safe answer to a confirmation. Radix's own
 * default is the first tabbable element, which here is the close cross in the header, and a
 * keyboard user who opens a form and finds themselves on "Close" has been sent the wrong way.
 */
const FIRST_FIELD = [
  'input:not([type="hidden"]):not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
]
  .map((field) => `[data-dialog-body] ${field}`)
  .join(', ')

/**
 * Remembers what was focused when the dialog opened, so it can be focused again when it closes.
 *
 * Radix restores focus to its own `Dialog.Trigger`, and every dialog in this application is opened
 * from state by an ordinary button instead — a row's action, a page header's button — so it has
 * no trigger to return to, and focus fell to the page body. A keyboard user closing a form then
 * had to Tab from the top of the page back to where they were. Under jsdom this showed up as the
 * Phase 16 keyboard walkthrough failing at "focus comes back", which is why it is a test.
 *
 * A layout effect on a sibling rendered *before* the content: React runs effects in tree order, so
 * this one sees the opener still focused, before Radix moves focus into the dialog.
 */
function RememberOpener({
  open,
  openerRef,
}: {
  open: boolean
  openerRef: RefObject<Element | null>
}) {
  useLayoutEffect(() => {
    if (open) openerRef.current = document.activeElement
  }, [open, openerRef])
  return null
}

/**
 * Built on Radix so the behaviour that is genuinely hard to get right comes for free: focus is
 * trapped, Escape closes, and the page behind is removed from the accessibility tree. Focus is
 * returned to the opener by `RememberOpener`, for the reason given there.
 *
 * The body scrolls inside the dialog rather than the dialog growing past the viewport, so a long
 * form on a laptop still shows its footer buttons.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  width = 'md',
  footer,
  children,
  busy = false,
}: DialogProps) {
  const { t } = useTranslation('common')
  const openerRef = useRef<Element | null>(null)

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (busy && !next) return
        onOpenChange(next)
      }}
    >
      <RememberOpener open={open} openerRef={openerRef} />
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <DialogPrimitive.Content
          aria-describedby={description ? undefined : ''}
          onEscapeKeyDown={(event) => busy && event.preventDefault()}
          onInteractOutside={(event) => busy && event.preventDefault()}
          onOpenAutoFocus={(event) => {
            const content = event.currentTarget as HTMLElement
            const target =
              content.querySelector<HTMLElement>(FIRST_FIELD) ??
              content.querySelector<HTMLElement>('[data-dialog-footer] button:not([disabled])')
            if (target) {
              event.preventDefault()
              target.focus()
            }
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            const previous = openerRef.current
            // The opener may have gone with the dialog — a row whose record was just voided, say.
            // The content landmark is then the nearest place to put a keyboard user down.
            const target =
              previous instanceof HTMLElement && previous.isConnected
                ? previous
                : document.getElementById('main-content')
            target?.focus()
          }}
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col',
            'rounded-lg border border-line bg-surface shadow-overlay outline-none',
            WIDTHS[width],
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-lg font-semibold text-ink">
                {title}
              </DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-0.5 text-sm text-ink-muted">
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            <DialogPrimitive.Close
              disabled={busy}
              aria-label={t('actions.close')}
              className="-mr-1 rounded-md p-1.5 text-ink-muted hover:bg-surface-subtle hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X aria-hidden="true" className="size-4" />
            </DialogPrimitive.Close>
          </div>

          <div data-dialog-body className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {children}
          </div>

          {footer ? (
            <div
              data-dialog-footer
              className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3"
            >
              {footer}
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

export const DialogClose = DialogPrimitive.Close
