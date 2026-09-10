import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  /** One sentence saying what to do next. Never left blank. */
  description: string
  action?: ReactNode
  /**
   * Heading level for the title. Defaults to 2, which is correct directly under a page heading.
   * Use 1 where the empty state *is* the page, such as a not-found screen, and go deeper when it
   * sits inside a titled panel, so heading levels never skip.
   */
  headingLevel?: 1 | 2 | 3 | 4
  className?: string
}

const HEADING_TAGS = { 1: 'h1', 2: 'h2', 3: 'h3', 4: 'h4' } as const

/** A small line icon, a heading, one sentence, one action. Never a decorative illustration. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  headingLevel = 2,
  className,
}: EmptyStateProps) {
  const Heading = HEADING_TAGS[headingLevel]

  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      {Icon ? (
        <Icon aria-hidden="true" className="mb-3 size-6 text-ink-disabled" strokeWidth={1.75} />
      ) : null}
      <Heading className="text-lg font-semibold text-ink">{title}</Heading>
      <p className="mt-1 max-w-prose text-base text-ink-muted">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}
