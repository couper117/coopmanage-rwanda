import { FolderTree, Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/PageHeader'
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Money,
  Panel,
  Switch,
  type Column,
} from '@/components/ui'
import { usePermission } from '@/features/auth/useSession'
import { CategoryDialog } from '@/features/finance/CategoryDialog'
import { FINANCE_KINDS, type CategoryRow, type FinanceKind } from '@/features/finance/finance.api'
import {
  useFinanceCategories,
  useFinanceError,
  useFormatNumber,
  useUpdateCategory,
} from '@/features/finance/finance.hooks'

/**
 * The two lists of categories the books are organised by.
 *
 * Income and expenses are shown as separate lists rather than as one list with a kind column,
 * because that is how they are used: somebody adding a category has already decided which side of
 * the balance they are adding to, and a category's kind can never change afterwards.
 *
 * **Deactivating is the only removal there is.** A category is never deleted, because the entries
 * already posted against it still have to be able to say where the money went, and a report run
 * next year has to name the same category it named last year. Where a category is in use, the
 * control says how many entries depend on it before it is put out of service.
 *
 * Every control here is hidden without `finance:categories:manage`, which is a courtesy to the
 * reader and not the security boundary: the server checks the permission again on every request.
 */

export function CategoriesPage() {
  const { t } = useTranslation(['finance', 'common'])
  const describeError = useFinanceError()

  const canManage = usePermission('finance:categories:manage')

  const [showInactive, setShowInactive] = useState(true)
  const categories = useFinanceCategories({ includeInactive: showInactive })
  const updateCategory = useUpdateCategory()

  const [editing, setEditing] = useState<{
    kind: FinanceKind
    category: CategoryRow | null
  } | null>(null)
  const [changing, setChanging] = useState<CategoryRow | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const rows = categories.data ?? []

  function confirmChange(): void {
    if (!changing) return
    const next = !changing.isActive
    updateCategory.mutate(
      { id: changing.id, changes: { isActive: next } },
      {
        onSuccess: (saved) => {
          setNotice(
            t(next ? 'finance:categories.restored' : 'finance:categories.deactivated', {
              name: saved.name,
            }),
          )
          setChanging(null)
        },
      },
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('finance:categories.title')}
        description={t('finance:categories.description')}
      />

      {notice ? (
        <Alert
          tone="success"
          action={
            <Button variant="ghost" size="sm" onClick={() => setNotice(null)}>
              {t('common:actions.close')}
            </Button>
          }
        >
          {notice}
        </Alert>
      ) : null}

      {categories.isError ? (
        <Alert
          tone="danger"
          title={t('finance:categories.loadFailed')}
          action={
            <Button variant="secondary" size="sm" onClick={() => void categories.refetch()}>
              {t('common:actions.retry')}
            </Button>
          }
        >
          {describeError(categories.error).message}
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-line bg-surface px-4 py-3">
        <Switch
          checked={showInactive}
          onCheckedChange={setShowInactive}
          label={t('finance:categories.showInactive')}
          description={t('finance:categories.showInactiveHint')}
        />
      </div>

      {FINANCE_KINDS.map((kind) => (
        <CategoryList
          key={kind}
          kind={kind}
          rows={rows.filter((row) => row.kind === kind)}
          loading={categories.isPending}
          canManage={canManage}
          onAdd={() => {
            setNotice(null)
            setEditing({ kind, category: null })
          }}
          onEdit={(row) => {
            setNotice(null)
            setEditing({ kind, category: row })
          }}
          onToggle={(row) => {
            setNotice(null)
            updateCategory.reset()
            setChanging(row)
          }}
        />
      ))}

      {editing !== null ? (
        <CategoryDialog
          open
          kind={editing.kind}
          category={editing.category}
          onOpenChange={(open) => {
            if (!open) setEditing(null)
          }}
          onSaved={(saved) =>
            setNotice(
              t(saved.created ? 'finance:categories.added' : 'finance:categories.renamed', {
                name: saved.name,
              }),
            )
          }
        />
      ) : null}

      {/*
        Deactivating is confirmed because it is the closest thing to a removal this module has, and
        the consequence names the entries that already depend on the category so the reader knows
        what stays behind. Restoring is confirmed with the same dialog, in the gentler tone.
      */}
      <ConfirmDialog
        open={changing !== null}
        onOpenChange={(open) => {
          if (!open) setChanging(null)
        }}
        tone={changing?.isActive === true ? 'danger' : 'primary'}
        title={
          changing
            ? t(
                changing.isActive
                  ? 'finance:categories.deactivateTitle'
                  : 'finance:categories.restoreTitle',
                { name: changing.name },
              )
            : ''
        }
        consequence={
          changing
            ? changing.isActive
              ? changing.entryCount > 0
                ? t('finance:categories.deactivateInUse', { entries: changing.entryCount })
                : t('finance:categories.deactivateUnused')
              : t('finance:categories.restoreConsequence')
            : ''
        }
        confirmLabel={t(
          changing?.isActive === true
            ? 'finance:categories.deactivateConfirm'
            : 'finance:categories.restoreConfirm',
        )}
        onConfirm={confirmChange}
        busy={updateCategory.isPending}
        error={updateCategory.isError ? describeError(updateCategory.error).message : null}
      />
    </div>
  )
}

function CategoryList({
  kind,
  rows,
  loading,
  canManage,
  onAdd,
  onEdit,
  onToggle,
}: {
  kind: FinanceKind
  rows: CategoryRow[]
  loading: boolean
  canManage: boolean
  onAdd: () => void
  onEdit: (row: CategoryRow) => void
  onToggle: (row: CategoryRow) => void
}) {
  const { t } = useTranslation(['finance', 'common'])
  const formatNumber = useFormatNumber()

  const columns: Column<CategoryRow>[] = [
    {
      key: 'name',
      header: t('finance:categories.columns.name'),
      render: (row) => (
        <div className="flex min-w-0 flex-col gap-0.5 py-1">
          <span className="font-medium text-ink">{row.name}</span>
          {row.isSystem ? (
            /* A system category can be renamed, but where it came from is worth showing: it
               explains why it was there before anybody added anything. */
            <span className="text-xs text-ink-muted">{t('finance:categories.systemOrigin')}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'nameRw',
      header: t('finance:categories.columns.nameRw'),
      secondary: true,
      render: (row) =>
        row.nameRw ?? <span className="text-ink-muted">{t('finance:categories.noNameRw')}</span>,
    },
    {
      key: 'code',
      header: t('finance:categories.columns.code'),
      secondary: true,
      render: (row) => row.code ?? <span className="text-ink-muted">—</span>,
    },
    {
      key: 'entryCount',
      header: t('finance:categories.columns.entries'),
      align: 'right',
      render: (row) => formatNumber(row.entryCount),
    },
    {
      key: 'total',
      header: t('finance:categories.columns.total'),
      align: 'right',
      render: (row) => <Money value={row.total} tone={kind === 'INCOME' ? 'in' : 'out'} />,
    },
    {
      key: 'isActive',
      header: t('finance:categories.columns.state'),
      render: (row) => (
        <Badge tone={row.isActive ? 'success' : 'neutral'}>
          {t(row.isActive ? 'finance:categories.active' : 'finance:categories.inactive')}
        </Badge>
      ),
    },
  ]

  if (canManage) {
    columns.push({
      key: 'actions',
      header: t('finance:columns.actions'),
      align: 'right',
      width: '14rem',
      render: (row) => (
        <div className="flex flex-wrap items-center justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => onEdit(row)}>
            {t('common:actions.edit')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onToggle(row)}>
            {t(row.isActive ? 'finance:categories.deactivate' : 'finance:categories.restore')}
          </Button>
        </div>
      ),
    })
  }

  return (
    <Panel
      flush
      title={t(kind === 'INCOME' ? 'finance:categories.titleIn' : 'finance:categories.titleOut')}
      description={t(
        kind === 'INCOME'
          ? 'finance:categories.descriptionIn'
          : 'finance:categories.descriptionOut',
      )}
      actions={
        canManage ? (
          <Button
            size="sm"
            leadingIcon={<Plus aria-hidden="true" className="size-4" />}
            onClick={onAdd}
          >
            {t(kind === 'INCOME' ? 'finance:categories.addIn' : 'finance:categories.addOut')}
          </Button>
        ) : undefined
      }
    >
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        caption={t(
          kind === 'INCOME' ? 'finance:categories.captionIn' : 'finance:categories.captionOut',
        )}
        loading={loading}
        rowMuted={(row) => !row.isActive}
        empty={
          <EmptyState
            icon={FolderTree}
            title={t(
              kind === 'INCOME'
                ? 'finance:categories.emptyTitleIn'
                : 'finance:categories.emptyTitleOut',
            )}
            description={t('finance:categories.emptyBody')}
            action={
              canManage ? (
                <Button onClick={onAdd}>
                  {t(kind === 'INCOME' ? 'finance:categories.addIn' : 'finance:categories.addOut')}
                </Button>
              ) : undefined
            }
          />
        }
        mobileRow={(row) => (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-ink">{row.name}</span>
              <Money value={row.total} tone={kind === 'INCOME' ? 'in' : 'out'} />
            </div>
            <p className="text-sm text-ink-muted">
              {row.nameRw ?? t('finance:categories.noNameRw')}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={row.isActive ? 'success' : 'neutral'}>
                {t(row.isActive ? 'finance:categories.active' : 'finance:categories.inactive')}
              </Badge>
              <span className="text-sm text-ink-muted">
                {t('finance:categories.entriesCount', { total: row.entryCount })}
              </span>
            </div>
          </div>
        )}
      />
    </Panel>
  )
}
