import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid = false, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'h-9 w-full rounded-md border bg-surface px-3 text-base text-ink',
        'transition-colors',
        'focus:border-primary-600',
        'disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:text-ink-disabled',
        invalid ? 'border-danger-fg' : 'border-line-strong',
        className,
      )}
      {...props}
    />
  )
})
