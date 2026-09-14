import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
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
 * Built on Radix so the behaviour that is genuinely hard to get right comes for free: focus is
 * trapped, Escape closes, focus returns to whatever opened it, and the page behind is removed from
 * the accessibility tree.
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

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (busy && !next) return
        onOpenChange(next)
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <DialogPrimitive.Content
          aria-describedby={description ? undefined : ''}
          onEscapeKeyDown={(event) => busy && event.preventDefault()}
          onInteractOutside={(event) => busy && event.preventDefault()}
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

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>

          {footer ? (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3">
              {footer}
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

export const DialogClose = DialogPrimitive.Close
