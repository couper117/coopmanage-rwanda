import type { MouseEvent, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { cn } from '@/lib/cn'
import { useUiStore } from '@/stores/uiStore'
import { Skeleton } from './Skeleton'

/** Below this width a list becomes stacked records rather than a table. */
const TABLE_QUERY = '(min-width: 768px)'

export interface Column<TRow> {
  /** Stable key, also used as the React key for the cell. */
  key: string
  header: string
  /** Money and quantities are right-aligned and tabular; text is left-aligned. */
  align?: 'left' | 'right'
  /** Hidden below 1024px, for columns that are useful but not identifying. */
  secondary?: boolean
  render: (row: TRow) => ReactNode
  /** Fixed width, for an actions or status column that should not stretch. */
  width?: string
}

export interface DataTableProps<TRow> {
  rows: TRow[]
  columns: Column<TRow>[]
  rowKey: (row: TRow) => string
  /** Describes the table for a screen reader. Required. */
  caption: string
  loading?: boolean
  /** Shown when there are no rows at all. */
  empty?: ReactNode
  /** A footer row, for totals that reflect the current filter. */
  footer?: ReactNode
  /** Marks a row as needing attention, for example an inactive member of staff. */
  rowMuted?: (row: TRow) => boolean
  onRowClick?: (row: TRow) => void
  /**
   * How each row reads on a phone. Tables are never horizontally scrolled on a small screen; each
   * list states the two or three fields that matter and the rest is on the detail view.
   */
  mobileRow?: (row: TRow) => ReactNode
}

/**
 * The table, which is the core of this product and gets the most attention in
 * `docs/ui-system.md` section 7.
 *
 * Sticky header, per-column alignment, hover, density from the user's own preference, a real
 * `<caption>` and `<th scope="col">` so it is navigable with a screen reader, and an explicit
 * mobile shape rather than a shrunken desktop one.
 */
/**
 * A row click, unless the click was really on something inside the row.
 *
 * A table that both opens a detail view on the row and carries per-row buttons — download, archive,
 * restore — would otherwise do both at once: the click on the button bubbles to the row. That was
 * exactly what the documents screen did on its first run, opening the detail dialog underneath the
 * archive dialog.
 *
 * `closest` is used rather than comparing the target, because the click usually lands on an icon or
 * a span inside the button rather than on the button itself.
 */
function handleRowClick(event: MouseEvent<HTMLElement>, act: () => void): void {
  const target = event.target as HTMLElement | null
  if (target?.closest('button, a, input, select, textarea, label, [role="button"]')) return
  act()
}

export function DataTable<TRow>({
  rows,
  columns,
  rowKey,
  caption,
  loading = false,
  empty,
  footer,
  rowMuted,
  onRowClick,
  mobileRow,
}: DataTableProps<TRow>) {
  const { t } = useTranslation('common')
  const density = useUiStore((state) => state.density)
  const rowHeight = density === 'compact' ? 'h-9' : 'h-11'

  /**
   * One shape or the other, chosen in JavaScript rather than with `hidden md:block`.
   *
   * Rendering both and letting CSS hide one puts every row in the document twice. Browsers cope,
   * because `display: none` also removes a subtree from the accessibility tree, but it doubles the
   * work for a long list and it makes every row ambiguous to anything that reads the DOM rather
   * than the styles.
   */
  const asTable = useMediaQuery(TABLE_QUERY) || !mobileRow

  if (loading) {
    return (
      <div className="flex flex-col gap-2 p-4" aria-busy="true" aria-live="polite">
        <span className="sr-only">{t('state.loading')}</span>
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-9 w-full" />
        ))}
      </div>
    )
  }

  if (rows.length === 0) return <>{empty}</>

  return (
    <>
      {/* Desktop and tablet: a real table. */}
      {asTable ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-base">
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr className="border-b border-line bg-surface-subtle">
                {columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    style={column.width ? { width: column.width } : undefined}
                    className={cn(
                      'px-3 py-2 text-xs font-semibold tracking-wider text-ink-secondary uppercase',
                      column.align === 'right' ? 'text-right' : 'text-left',
                      column.secondary && 'hidden lg:table-cell',
                    )}
                  >
                    {column.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={
                    onRowClick ? (event) => handleRowClick(event, () => onRowClick(row)) : undefined
                  }
                  className={cn(
                    rowHeight,
                    'border-b border-line last:border-b-0',
                    onRowClick && 'cursor-pointer',
                    'hover:bg-primary-50',
                    rowMuted?.(row) && 'text-ink-muted',
                  )}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn(
                        'px-3',
                        column.align === 'right' ? 'text-right tabular-nums' : 'text-left',
                        column.secondary && 'hidden lg:table-cell',
                      )}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {footer ? (
              <tfoot>
                <tr className="border-t border-line-strong bg-surface-subtle font-medium">
                  {footer}
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      ) : null}

      {/* Phone: stacked records, with only the fields that matter. */}
      {!asTable && mobileRow ? (
        <ul className="divide-y divide-line">
          {rows.map((row) => (
            <li key={rowKey(row)} className={cn(rowMuted?.(row) && 'text-ink-muted')}>
              {/*
                A clickable card is a real button, not a div with a click handler. Otherwise the
                row is unreachable by keyboard and invisible to a screen reader as an action.
              */}
              {onRowClick ? (
                <button
                  type="button"
                  onClick={() => onRowClick(row)}
                  className="w-full px-4 py-3 text-left hover:bg-primary-50"
                >
                  {mobileRow(row)}
                </button>
              ) : (
                <div className="px-4 py-3">{mobileRow(row)}</div>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  )
}
