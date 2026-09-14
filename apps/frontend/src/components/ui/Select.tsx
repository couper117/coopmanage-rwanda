import { forwardRef, type SelectHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  options: SelectOption[]
  /** Shown as a disabled first entry when the field has no value yet. */
  placeholder?: string
  invalid?: boolean
}

/**
 * A native `<select>`, deliberately.
 *
 * A custom listbox is a lot of behaviour to get right and the native control already has all of
 * it: keyboard support, type-ahead, and the platform's own picker on a phone, which is far easier
 * to use on a small screen than anything rendered in the page. The searchable picker in Phase 4 is
 * a different component for a different job, over hundreds of server-searched members.
 *
 * Note for React Hook Form: this is always controlled, because `value={value ?? ''}` is what makes
 * the placeholder show for an empty field. Spreading `register(name)` alone therefore pins it to
 * the placeholder — the registration supplies `onChange` but no `value`. Pass the value back as
 * well, from `useWatch`, or drive it with a `Controller`.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, options, placeholder, invalid = false, value, ...props },
  ref,
) {
  return (
    <div className="relative">
      <select
        ref={ref}
        value={value ?? ''}
        aria-invalid={invalid || undefined}
        className={cn(
          'h-9 w-full appearance-none rounded-md border bg-surface py-0 pr-9 pl-3 text-base text-ink',
          'transition-colors focus:border-primary-600',
          'disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:text-ink-disabled',
          invalid ? 'border-danger-fg' : 'border-line-strong',
          className,
        )}
        {...props}
      >
        {placeholder ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-muted"
      />
    </div>
  )
})
