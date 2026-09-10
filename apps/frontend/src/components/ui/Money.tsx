import { formatMoney, formatQuantity } from '@coopmanage/shared'
import { cn } from '@/lib/cn'

export interface MoneyProps {
  /** A decimal string from the API, never a JavaScript number. */
  value: string
  currency?: string
  withCurrency?: boolean
  /** Colours income green and expenses red, alongside a sign so colour is never the only cue. */
  tone?: 'neutral' | 'in' | 'out'
  className?: string
}

export function Money({
  value,
  currency,
  withCurrency = true,
  tone = 'neutral',
  className,
}: MoneyProps) {
  const formatted = formatMoney(value, {
    ...(currency ? { currency } : {}),
    withCurrency,
  })
  const prefix = tone === 'in' ? '+' : tone === 'out' ? '−' : ''

  return (
    <span
      data-numeric=""
      className={cn(
        'tabular-nums',
        tone === 'in' && 'text-success-fg',
        tone === 'out' && 'text-danger-fg',
        className,
      )}
    >
      {prefix}
      {formatted}
    </span>
  )
}

export interface QuantityProps {
  value: string
  unit?: string
  className?: string
}

export function Quantity({ value, unit, className }: QuantityProps) {
  return (
    <span data-numeric="" className={cn('tabular-nums', className)}>
      {formatQuantity(value, unit)}
    </span>
  )
}
