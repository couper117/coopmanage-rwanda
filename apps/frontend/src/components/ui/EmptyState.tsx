import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  /** One sentence saying what to do next. Never left blank. */
  description: string
  action?: ReactNode
  className?: string
}

/** A small line icon, a heading, one sentence, one action. Never a decorative illustration. */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      {Icon ? (
        <Icon aria-hidden="true" className="mb-3 size-6 text-ink-disabled" strokeWidth={1.75} />
      ) : null}
      <h3 className="text-lg font-semibold text-ink">{title}</h3>
      <p className="mt-1 max-w-prose text-base text-ink-muted">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}
