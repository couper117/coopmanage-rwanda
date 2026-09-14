import { Plus, Ruler } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/PageHeader'
import {
  Alert,
  Badge,
  Button,
  DataTable,
  EmptyState,
  Panel,
  Switch,
  type Column,
} from '@/components/ui'
import { usePermission } from '@/features/auth/useSession'
import { UnitDialog } from '@/features/inventory/UnitDialog'
import type { UnitRow } from '@/features/inventory/inventory.api'
import {
  useFormatNumber,
  useInventoryError,
  useUnitLabel,
  useUnits,
  useUpdateUnit,
} from '@/features/inventory/inventory.hooks'

/**
 * What the cooperative measures in.
 *
 * Kilograms are not assumed anywhere in this product. A dairy cooperative works in litres, a
 * maize cooperative in sacks of a particular size, a mechanisation cooperative in days of tractor
 * hire. So the platform seeds a handful of units that every cooperative shares and lets each
 * cooperative add its own on top.
 *
 * **A shared unit can be chosen but never renamed.** It belongs to the platform rather than to
 * this cooperative, and renaming it would reach every cooperative at once; the server refuses the
 * change with a 409. So a shared unit is marked as shared and carries no edit control at all,
 * which is the honest way to present a control that could only ever fail.
 *
 * **A unit is never deleted.** Quantities already recorded in it name it, so one that has fallen
 * out of use is put out of service: it stops being offered on new products and keeps every
 * product already measured in it.
 *
 * Every control is hidden without `units:manage`, which is a courtesy to the reader and not the
 * security boundary: the server checks the permission again on every request.
 */

export function UnitsPage() {
  const { t } = useTranslation(['inventory', 'common'])
  const describeError = useInventoryError()
  const formatNumber = useFormatNumber()
  const unitLabel = useUnitLabel()

  const canManage = usePermission('units:manage')

  const [showInactive, setShowInactive] = useState(true)
  const units = useUnits({ includeInactive: showInactive })
  const updateUnit = useUpdateUnit()

  const [editing, setEditing] = useState<{ unit: UnitRow | null } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const rows = units.data ?? []

  function toggleActive(row: UnitRow): void {
    setNotice(null)
    updateUnit.reset()
    updateUnit.mutate(
      { id: row.id, changes: { isActive: !row.isActive } },
      {
        onSuccess: (saved) => {
          setNotice(
            t(saved.isActive ? 'inventory:units.restored' : 'inventory:units.deactivated', {
              name: unitLabel(saved),
            }),
          )
        },
      },
    )
  }

  const columns: Column<UnitRow>[] = [
    {
      key: 'symbol',
      header: t('inventory:unitColumns.symbol'),
      render: (row) => <span className="font-medium text-ink">{row.symbol}</span>,
    },
    {
      key: 'name',
      header: t('inventory:unitColumns.name'),
      render: (row) => (
        <div className="min-w-0">
          <span className="block text-ink">{unitLabel(row)}</span>
          <span className="block text-xs text-ink-muted">{row.key}</span>
        </div>
      ),
    },
    {
      key: 'nameRw',
      header: t('inventory:unitColumns.nameRw'),
      secondary: true,
      render: (row) => row.nameRw,
    },
    {
      key: 'precision',
      header: t('inventory:unitColumns.precision'),
      align: 'right',
      render: (row) => t(`inventory:unitFields.precisionOption.${row.precision}`),
    },
    {
      key: 'base',
      header: t('inventory:unitColumns.base'),
      secondary: true,
      render: (row) =>
        row.baseUnitId === null || row.factorToBase === null ? (
          <span className="text-ink-muted">{t('inventory:units.standsAlone')}</span>
        ) : (
          t('inventory:units.builtOn', {
            factor: row.factorToBase,
            symbol: baseSymbolOf(rows, row.baseUnitId),
          })
        ),
    },
    {
      key: 'products',
      header: t('inventory:unitColumns.products'),
      align: 'right',
      render: (row) => formatNumber(row.productCount),
    },
    {
      key: 'origin',
      header: t('inventory:unitColumns.origin'),
      render: (row) =>
        row.isSystem ? (
          <Badge tone="info">{t('inventory:units.shared')}</Badge>
        ) : (
          <Badge tone="neutral">{t('inventory:units.own')}</Badge>
        ),
    },
    {
      key: 'state',
      header: t('inventory:unitColumns.state'),
      render: (row) => (
        <Badge tone={row.isActive ? 'success' : 'neutral'}>
          {t(row.isActive ? 'inventory:units.active' : 'inventory:units.inactive')}
        </Badge>
      ),
    },
  ]

  if (canManage) {
    columns.push({
      key: 'actions',
      header: t('inventory:unitColumns.actions'),
      align: 'right',
      width: '16rem',
      render: (row) => {
        /*
          A shared unit carries no controls, and says why. Offering an edit that the server
          answers with a 409 would be inviting the reader to type a name that cannot be saved.
        */
        if (row.isSystem) {
          return <span className="text-xs text-ink-muted">{t('inventory:units.sharedNoEdit')}</span>
        }
        return (
          <div className="flex flex-wrap items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setNotice(null)
                setEditing({ unit: row })
              }}
            >
              {t('common:actions.edit')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => toggleActive(row)}>
              {t(row.isActive ? 'inventory:units.deactivate' : 'inventory:units.restore')}
            </Button>
          </div>
        )
      },
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('inventory:units.title')}
        description={t('inventory:units.description')}
        actions={
          canManage ? (
            <Button
              leadingIcon={<Plus aria-hidden="true" className="size-4" />}
              onClick={() => {
                setNotice(null)
                setEditing({ unit: null })
              }}
            >
              {t('inventory:units.add')}
            </Button>
          ) : undefined
        }
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

      {units.isError ? (
        <Alert
          tone="danger"
          title={t('inventory:units.loadFailed')}
          action={
            <Button variant="secondary" size="sm" onClick={() => void units.refetch()}>
              {t('common:actions.retry')}
            </Button>
          }
        >
          {describeError(units.error).message}
        </Alert>
      ) : null}

      {updateUnit.isError ? (
        <Alert tone="danger">{describeError(updateUnit.error).message}</Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-line bg-surface px-4 py-3">
        <Switch
          checked={showInactive}
          onCheckedChange={setShowInactive}
          label={t('inventory:units.showInactive')}
          description={t('inventory:units.showInactiveHint')}
        />
      </div>

      <Panel flush>
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          caption={t('inventory:units.caption')}
          loading={units.isPending}
          rowMuted={(row) => !row.isActive}
          empty={
            <EmptyState
              icon={Ruler}
              title={t('inventory:units.emptyTitle')}
              description={t('inventory:units.emptyBody')}
              action={
                canManage ? (
                  <Button onClick={() => setEditing({ unit: null })}>
                    {t('inventory:units.add')}
                  </Button>
                ) : undefined
              }
            />
          }
          mobileRow={(row) => (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-ink">{unitLabel(row)}</span>
                <span className="text-sm text-ink-muted">{row.symbol}</span>
              </div>
              {row.isSystem ? <Badge tone="info">{t('inventory:units.shared')}</Badge> : null}
            </div>
          )}
        />
      </Panel>

      {editing !== null ? (
        <UnitDialog
          open
          unit={editing.unit}
          units={rows}
          onOpenChange={(open) => {
            if (!open) setEditing(null)
          }}
          onDone={setNotice}
        />
      ) : null}
    </div>
  )
}

/** The symbol of the unit another one is built on, read out of the list already loaded. */
function baseSymbolOf(rows: UnitRow[], baseUnitId: string): string {
  return rows.find((row) => row.id === baseUnitId)?.symbol ?? ''
}
