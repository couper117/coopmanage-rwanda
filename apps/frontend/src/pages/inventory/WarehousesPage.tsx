import { Plus, Warehouse } from 'lucide-react'
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
  Panel,
  Quantity,
  Switch,
  type Column,
} from '@/components/ui'
import { usePermission } from '@/features/auth/useSession'
import { WarehouseDialog } from '@/features/inventory/WarehouseDialog'
import type { WarehouseRow } from '@/features/inventory/inventory.api'
import {
  useFormatNumber,
  useInventoryError,
  useUpdateWarehouse,
  useWarehouses,
} from '@/features/inventory/inventory.hooks'

/**
 * Where the cooperative keeps what it holds.
 *
 * A cooperative usually has two or three stores, so this is a short list rather than a paged
 * table, and it shows the two facts a decision depends on: what each store is holding, and which
 * one is the default that stock arrives at when nobody says otherwise.
 *
 * **A cooperative always keeps exactly one default.** So the flag is only ever moved, never
 * cleared: promoting one store demotes whichever store held it, and there is no control that
 * would leave the cooperative with none.
 *
 * **A store holding stock cannot be closed.** The server refuses it with a 409, and that refusal
 * is shown on the confirmation itself rather than being pre-empted by a disabled button: the
 * quantity on the row can be minutes old, and a reader told "you cannot" by a greyed-out control
 * has no idea what to do next. The message says to move the stock to another store first, which
 * is the actual next step.
 *
 * Every control is hidden without `warehouses:manage`, which is a courtesy to the reader and not
 * the security boundary: the server checks the permission again on every request.
 */

export function WarehousesPage() {
  const { t } = useTranslation(['inventory', 'common'])
  const describeError = useInventoryError()
  const formatNumber = useFormatNumber()

  const canManage = usePermission('warehouses:manage')

  const [showClosed, setShowClosed] = useState(true)
  const warehouses = useWarehouses({ includeInactive: showClosed })
  const updateWarehouse = useUpdateWarehouse()

  const [editing, setEditing] = useState<{ warehouse: WarehouseRow | null } | null>(null)
  const [closing, setClosing] = useState<WarehouseRow | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const rows = warehouses.data ?? []
  const hasNone = warehouses.isSuccess && rows.length === 0

  function promote(row: WarehouseRow): void {
    setNotice(null)
    updateWarehouse.reset()
    updateWarehouse.mutate(
      { id: row.id, changes: { isDefault: true } },
      {
        onSuccess: (saved) => {
          setNotice(t('inventory:warehouses.defaultMoved', { name: saved.name }))
        },
      },
    )
  }

  function confirmClose(): void {
    if (!closing) return
    const next = !closing.isActive
    updateWarehouse.mutate(
      { id: closing.id, changes: { isActive: next } },
      {
        onSuccess: (saved) => {
          setNotice(
            t(next ? 'inventory:warehouses.reopened' : 'inventory:warehouses.closed', {
              name: saved.name,
            }),
          )
          setClosing(null)
        },
      },
    )
  }

  const columns: Column<WarehouseRow>[] = [
    {
      key: 'name',
      header: t('inventory:warehouseColumns.name'),
      render: (row) => (
        <div className="min-w-0">
          <span className="block font-medium text-ink">{row.name}</span>
          <span className="block text-xs text-ink-muted">{row.code}</span>
        </div>
      ),
    },
    {
      key: 'place',
      header: t('inventory:warehouseColumns.place'),
      secondary: true,
      render: (row) =>
        row.district === null && row.sector === null ? (
          <span className="text-ink-muted">{t('inventory:warehouses.noPlace')}</span>
        ) : (
          [row.sector, row.district].filter((part) => part !== null).join(', ')
        ),
    },
    {
      key: 'products',
      header: t('inventory:warehouseColumns.products'),
      align: 'right',
      render: (row) => formatNumber(row.productsHeld),
    },
    {
      key: 'quantity',
      header: t('inventory:warehouseColumns.quantity'),
      align: 'right',
      /* The total across every unit the store holds, so it carries no unit symbol of its own: a
         store with sacks and litres in it has no single unit to state. */
      render: (row) => <Quantity value={row.quantityHeld} />,
    },
    {
      key: 'default',
      header: t('inventory:warehouseColumns.default'),
      render: (row) =>
        row.isDefault ? (
          <Badge tone="accent">{t('inventory:warehouses.isDefault')}</Badge>
        ) : (
          <span className="text-ink-muted">{t('inventory:warehouses.notDefault')}</span>
        ),
    },
    {
      key: 'state',
      header: t('inventory:warehouseColumns.state'),
      render: (row) => (
        <Badge tone={row.isActive ? 'success' : 'neutral'}>
          {t(row.isActive ? 'inventory:warehouses.open' : 'inventory:warehouses.closedState')}
        </Badge>
      ),
    },
  ]

  if (canManage) {
    columns.push({
      key: 'actions',
      header: t('inventory:warehouseColumns.actions'),
      align: 'right',
      width: '18rem',
      render: (row) => (
        <div className="flex flex-wrap items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setNotice(null)
              setEditing({ warehouse: row })
            }}
          >
            {t('common:actions.edit')}
          </Button>
          {/* No control to clear the flag: a cooperative keeps exactly one default store. */}
          {row.isDefault || !row.isActive ? null : (
            <Button variant="ghost" size="sm" onClick={() => promote(row)}>
              {t('inventory:warehouses.makeDefault')}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setNotice(null)
              updateWarehouse.reset()
              setClosing(row)
            }}
          >
            {t(row.isActive ? 'inventory:warehouses.close' : 'inventory:warehouses.reopen')}
          </Button>
        </div>
      ),
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('inventory:warehouses.title')}
        description={t('inventory:warehouses.description')}
        actions={
          canManage ? (
            <Button
              leadingIcon={<Plus aria-hidden="true" className="size-4" />}
              onClick={() => {
                setNotice(null)
                setEditing({ warehouse: null })
              }}
            >
              {t('inventory:warehouses.add')}
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

      {warehouses.isError ? (
        <Alert
          tone="danger"
          title={t('inventory:warehouses.loadFailed')}
          action={
            <Button variant="secondary" size="sm" onClick={() => void warehouses.refetch()}>
              {t('common:actions.retry')}
            </Button>
          }
        >
          {describeError(warehouses.error).message}
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-line bg-surface px-4 py-3">
        <Switch
          checked={showClosed}
          onCheckedChange={setShowClosed}
          label={t('inventory:warehouses.showClosed')}
          description={t('inventory:warehouses.showClosedHint')}
        />
      </div>

      <Panel flush>
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          caption={t('inventory:warehouses.caption')}
          loading={warehouses.isPending}
          rowMuted={(row) => !row.isActive}
          empty={
            <EmptyState
              icon={Warehouse}
              title={t('inventory:warehouses.emptyTitle')}
              description={t('inventory:warehouses.emptyBody')}
              action={
                canManage ? (
                  <Button onClick={() => setEditing({ warehouse: null })}>
                    {t('inventory:warehouses.add')}
                  </Button>
                ) : undefined
              }
            />
          }
          mobileRow={(row) => (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-ink">{row.name}</span>
                <Quantity value={row.quantityHeld} />
              </div>
              <p className="text-sm text-ink-muted">{row.code}</p>
              {row.isDefault ? (
                <Badge tone="accent">{t('inventory:warehouses.isDefault')}</Badge>
              ) : null}
            </div>
          )}
        />
      </Panel>

      {editing !== null ? (
        <WarehouseDialog
          open
          warehouse={editing.warehouse}
          isFirst={editing.warehouse === null && hasNone}
          onOpenChange={(open) => {
            if (!open) setEditing(null)
          }}
          onDone={setNotice}
        />
      ) : null}

      <ConfirmDialog
        open={closing !== null}
        onOpenChange={(open) => {
          if (!open) setClosing(null)
        }}
        tone={closing?.isActive === false ? 'primary' : 'danger'}
        busy={updateWarehouse.isPending}
        title={t(
          closing?.isActive === false
            ? 'inventory:warehouses.reopenTitle'
            : 'inventory:warehouses.closeTitle',
          { name: closing?.name ?? '' },
        )}
        consequence={
          closing?.isActive === false
            ? t('inventory:warehouses.reopenConsequence')
            : closing && closing.productsHeld > 0
              ? // Said before the attempt, because the row already shows what is in there.
                t('inventory:warehouses.closeHoldsStock', {
                  total: formatNumber(closing.productsHeld),
                })
              : t('inventory:warehouses.closeConsequence')
        }
        confirmLabel={t(
          closing?.isActive === false
            ? 'inventory:warehouses.reopenConfirm'
            : 'inventory:warehouses.closeConfirm',
        )}
        onConfirm={confirmClose}
        /* The refusal is reported here rather than pre-empted by a disabled control, so the
           reader is told what to do about it instead of merely being stopped. */
        error={updateWarehouse.isError ? describeError(updateWarehouse.error).message : null}
      />
    </div>
  )
}
