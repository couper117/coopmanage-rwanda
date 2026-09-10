import { forwardRef, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid = false, rows = 4, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(
        'w-full rounded-md border bg-surface px-3 py-2 text-base text-ink',
        'transition-colors focus:border-primary-600',
        'disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:text-ink-disabled',
        invalid ? 'border-danger-fg' : 'border-line-strong',
        className,
      )}
      {...props}
    />
  )
})
