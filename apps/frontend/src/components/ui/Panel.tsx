import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

// `title` is omitted from the DOM attributes because a panel heading is rich content, not the
// string that a browser tooltip expects.
export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  /** Removes the body padding, for a panel whose whole body is a table. */
  flush?: boolean
  as?: 'section' | 'div' | 'article'
}

/**
 * The default container. A 1px border rather than a shadow: elevation is reserved for content that
 * genuinely floats above the page.
 */
export function Panel({
  title,
  description,
  actions,
  flush = false,
  as: Component = 'section',
  className,
  children,
  ...props
}: PanelProps) {
  const hasHeader = title !== undefined || description !== undefined || actions !== undefined

  return (
    <Component className={cn('rounded-lg border border-line bg-surface', className)} {...props}>
      {hasHeader ? (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            {title !== undefined ? (
              <h2 className="text-lg font-semibold text-ink">{title}</h2>
            ) : null}
            {description !== undefined ? (
              <p className="mt-0.5 text-sm text-ink-muted">{description}</p>
            ) : null}
          </div>
          {actions !== undefined ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={flush ? undefined : 'p-4'}>{children}</div>
    </Component>
  )
}
