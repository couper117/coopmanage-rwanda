import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent'

const TONES: Record<BadgeTone, { chip: string; dot: string }> = {
  neutral: { chip: 'bg-surface-subtle text-ink-secondary border-line-strong', dot: 'bg-ink-muted' },
  success: { chip: 'bg-success-bg text-success-fg border-success-line', dot: 'bg-success-fg' },
  warning: { chip: 'bg-warning-bg text-warning-fg border-warning-line', dot: 'bg-warning-fg' },
  danger: { chip: 'bg-danger-bg text-danger-fg border-danger-line', dot: 'bg-danger-fg' },
  info: { chip: 'bg-info-bg text-info-fg border-info-line', dot: 'bg-info-fg' },
  accent: { chip: 'bg-accent-100 text-accent-600 border-accent-500/30', dot: 'bg-accent-500' },
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
  /** The dot is on by default so status never rests on colour alone. */
  withDot?: boolean
}

export function Badge({
  tone = 'neutral',
  withDot = true,
  className,
  children,
  ...props
}: BadgeProps) {
  const styles = TONES[tone]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-xs font-medium',
        styles.chip,
        className,
      )}
      {...props}
    >
      {withDot ? (
        <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', styles.dot)} />
      ) : null}
      {children}
    </span>
  )
}
