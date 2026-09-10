import { Slot } from '@radix-ui/react-slot'
import { Loader2 } from 'lucide-react'
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link'
export type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-primary-600 text-ink-inverse hover:bg-primary-700 active:bg-primary-800 disabled:bg-primary-600',
  secondary:
    'bg-surface text-ink border border-line-strong hover:bg-surface-subtle active:bg-surface-subtle',
  ghost: 'bg-transparent text-ink-secondary hover:bg-surface-subtle hover:text-ink',
  danger: 'bg-danger-fg text-ink-inverse hover:brightness-110 active:brightness-95',
  link: 'bg-transparent text-primary-600 underline underline-offset-2 hover:text-primary-700',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-9 px-4 text-base gap-2',
  lg: 'h-10 px-5 text-base gap-2',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Shows a spinner in place of the leading icon and disables the control, keeping the label. */
  loading?: boolean
  leadingIcon?: ReactNode
  trailingIcon?: ReactNode
  /** Renders the child element instead of a button, for links that should look like buttons. */
  asChild?: boolean
}

/**
 * The label never disappears while loading: a button that turns into a bare spinner loses the
 * reader's place, and a screen reader loses the accessible name.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = 'primary',
    size = 'md',
    loading = false,
    leadingIcon,
    trailingIcon,
    asChild = false,
    disabled,
    children,
    type,
    ...props
  },
  ref,
) {
  const isDisabled = disabled === true || loading
  const classes = cn(
    'inline-flex items-center justify-center rounded-md font-medium whitespace-nowrap',
    'transition-colors duration-100',
    'disabled:cursor-not-allowed disabled:opacity-55',
    VARIANTS[variant],
    SIZES[size],
    className,
  )

  // Radix Slot merges props onto exactly one child, so in asChild mode the caller's element is
  // passed through untouched. Icons belong inside that element rather than beside it.
  if (asChild) {
    return (
      <Slot ref={ref} className={classes} aria-disabled={isDisabled || undefined} {...props}>
        {children}
      </Slot>
    )
  }

  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={classes}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin" />
      ) : (
        leadingIcon
      )}
      {children}
      {trailingIcon}
    </button>
  )
})
