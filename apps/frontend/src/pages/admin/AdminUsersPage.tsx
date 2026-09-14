import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { SearchX, UserRound } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { LOCALES, type Locale } from '@coopmanage/shared'
import { PageHeader } from '@/components/PageHeader'
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  Dialog,
  EmptyState,
  FormField,
  Input,
  Panel,
  Select,
  Switch,
  Tooltip,
  type Column,
  type SelectOption,
} from '@/components/ui'
import {
  USER_STATUSES,
  createAdminUser,
  listAdminUsers,
  updateAdminUser,
  type AdminUserFilters,
  type AdminUserRow,
  type UpdateUserInput,
  type UserStatus,
} from '@/features/admin/admin.api'
import {
  adminKeys,
  useAdminError,
  useDebouncedValue,
  useFormatDateTime,
} from '@/features/admin/admin.hooks'
import { useSession } from '@/features/auth/useSession'

const PAGE_SIZE = 25

type RowAction = 'suspend' | 'restore' | 'grantAdmin' | 'revokeAdmin'

const ACTION_CHANGE: Readonly<Record<RowAction, UpdateUserInput>> = {
  suspend: { status: 'SUSPENDED' },
  restore: { status: 'ACTIVE' },
  grantAdmin: { isPlatformAdmin: true },
  revokeAdmin: { isPlatformAdmin: false },
}

function readStatus(value: string): UserStatus | '' {
  return USER_STATUSES.find((status) => status === value) ?? ''
}

/**
 * Every account on the platform, and who may administer it.
 *
 * The controls on the caller's own row are deliberately dead: the server refuses a change to your
 * own status or platform flag, because either would be a one-click way to leave the platform with
 * nobody able to administer it. Showing the buttons and explaining why they are disabled is
 * honest; hiding them would read as a rendering fault.
 */
export function AdminUsersPage() {
  const { t } = useTranslation(['admin', 'common'])
  const queryClient = useQueryClient()
  const describeError = useAdminError()
  const formatDateTime = useFormatDateTime()
  const { user } = useSession()
  const signedInUserId = user?.id ?? null

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<UserStatus | ''>('')
  const [page, setPage] = useState(1)
  const [formOpen, setFormOpen] = useState(false)
  const [created, setCreated] = useState<string | null>(null)
  const [pending, setPending] = useState<{ row: AdminUserRow; action: RowAction } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const debouncedSearch = useDebouncedValue(search)

  const filters = useMemo<AdminUserFilters>(
    () => ({ q: debouncedSearch.trim(), status, page, pageSize: PAGE_SIZE }),
    [debouncedSearch, status, page],
  )

  const filtersApplied = filters.q !== '' || status !== ''

  const list = useQuery({
    queryKey: adminKeys.users(filters),
    queryFn: () => listAdminUsers(filters),
  })

  const changeMutation = useMutation({
    mutationFn: (change: { id: string; body: UpdateUserInput }) =>
      updateAdminUser(change.id, change.body),
    onSuccess: async () => {
      setActionError(null)
      setPending(null)
      await queryClient.invalidateQueries({ queryKey: adminKeys.userList })
    },
    onError: (error) => setActionError(describeError(error).message),
  })

  const rows = list.data?.items ?? []
  const meta = list.data?.meta

  function clearFilters(): void {
    setSearch('')
    setStatus('')
    setPage(1)
  }

  function openConfirm(row: AdminUserRow, action: RowAction): void {
    setActionError(null)
    setPending({ row, action })
  }

  const statusOptions: SelectOption[] = [
    { value: '', label: t('admin:users.statusFilter.all') },
    ...USER_STATUSES.map((value) => ({ value, label: t(`admin:users.status.${value}`) })),
  ]

  function renderActions(row: AdminUserRow, stacked: boolean) {
    const isSelf = signedInUserId !== null && row.id === signedInUserId
    const statusAction: RowAction = row.status === 'ACTIVE' ? 'suspend' : 'restore'
    const adminAction: RowAction = row.isPlatformAdmin ? 'revokeAdmin' : 'grantAdmin'
    const layout = stacked ? 'flex flex-wrap gap-2' : 'flex justify-end gap-2 py-1'

    const buttons = (
      <>
        <Button
          size="sm"
          variant={statusAction === 'restore' ? 'secondary' : 'ghost'}
          disabled={isSelf}
          onClick={() => openConfirm(row, statusAction)}
        >
          {t(`admin:users.actions.${statusAction}`)}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={isSelf}
          onClick={() => openConfirm(row, adminAction)}
        >
          {t(`admin:users.actions.${adminAction}`)}
        </Button>
      </>
    )

    if (!isSelf) return <div className={layout}>{buttons}</div>

    // A disabled button fires no pointer events, so the tooltip hangs off a wrapper. The same
    // sentence is also in the accessibility tree, because a tooltip that only opens on hover
    // tells a screen-reader user nothing about why the controls do not work.
    return (
      <Tooltip content={t('admin:users.self.reason')}>
        <span className={layout}>
          {buttons}
          <span className="sr-only">{t('admin:users.self.reason')}</span>
        </span>
      </Tooltip>
    )
  }

  const columns: Column<AdminUserRow>[] = [
    {
      key: 'name',
      header: t('admin:users.columns.name'),
      render: (row) => (
        <div className="flex flex-col gap-0.5 py-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-ink">{row.fullName}</span>
            {row.id === signedInUserId ? (
              <Badge tone="info">{t('admin:users.self.badge')}</Badge>
            ) : null}
          </span>
          <span className="text-xs text-ink-muted">{row.email}</span>
          {row.mustChangePassword ? (
            <span className="text-xs text-warning-fg">{t('admin:users.mustChangePassword')}</span>
          ) : null}
          {row.lockedUntil ? (
            <span className="text-xs text-warning-fg">
              {t('admin:users.locked', { when: formatDateTime(row.lockedUntil) })}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'status',
      header: t('admin:users.columns.status'),
      render: (row) => (
        <Badge tone={row.status === 'ACTIVE' ? 'success' : 'warning'}>
          {t(`admin:users.status.${row.status}`)}
        </Badge>
      ),
    },
    {
      key: 'platformAdmin',
      header: t('admin:users.columns.platformAdmin'),
      render: (row) => (
        <Badge tone={row.isPlatformAdmin ? 'accent' : 'neutral'}>
          {t(
            row.isPlatformAdmin ? 'admin:users.platformAdmin.yes' : 'admin:users.platformAdmin.no',
          )}
        </Badge>
      ),
    },
    {
      key: 'cooperatives',
      header: t('admin:users.columns.cooperatives'),
      secondary: true,
      render: (row) =>
        row.memberships.length === 0 ? (
          <span className="text-ink-muted">{t('admin:users.memberships.none')}</span>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {row.memberships.map((membership) => (
              <li key={membership.cooperativeId} className="text-sm">
                {membership.cooperativeName}
              </li>
            ))}
          </ul>
        ),
    },
    {
      key: 'lastLogin',
      header: t('admin:users.columns.lastLogin'),
      secondary: true,
      render: (row) =>
        row.lastLoginAt ? formatDateTime(row.lastLoginAt) : t('admin:users.lastLogin.never'),
    },
    {
      key: 'actions',
      header: t('admin:users.columns.actions'),
      align: 'right',
      width: '19rem',
      render: (row) => renderActions(row, false),
    },
  ]

  const from = meta ? (meta.page - 1) * meta.pageSize + 1 : 0
  const to = meta ? Math.min(meta.page * meta.pageSize, meta.total) : 0

  return (
    <>
      <PageHeader
        title={t('admin:users.title')}
        description={t('admin:users.description')}
        actions={
          <Button
            onClick={() => {
              setCreated(null)
              setFormOpen(true)
            }}
          >
            {t('admin:users.newButton')}
          </Button>
        }
      />

      {created ? <Alert tone="success">{created}</Alert> : null}

      {list.isError ? (
        <Alert
          tone="danger"
          title={t('admin:users.error.body')}
          action={
            <Button variant="secondary" size="sm" onClick={() => void list.refetch()}>
              {t('common:actions.retry')}
            </Button>
          }
        >
          {describeError(list.error).message}
        </Alert>
      ) : null}

      <Panel flush>
        <div className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3">
          <FormField label={t('admin:users.search.label')} className="min-w-56 flex-1">
            <Input
              type="search"
              placeholder={t('admin:users.search.placeholder')}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setPage(1)
              }}
            />
          </FormField>

          <FormField label={t('admin:users.statusFilter.label')} className="w-48">
            <Select
              options={statusOptions}
              value={status}
              onChange={(event) => {
                setStatus(readStatus(event.target.value))
                setPage(1)
              }}
            />
          </FormField>
        </div>

        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          caption={t('admin:users.tableCaption')}
          loading={list.isPending}
          rowMuted={(row) => row.status !== 'ACTIVE'}
          empty={
            filtersApplied ? (
              <EmptyState
                icon={SearchX}
                title={t('admin:users.noResults.title')}
                description={t('admin:users.noResults.body')}
                action={
                  <Button variant="secondary" onClick={clearFilters}>
                    {t('common:actions.clearFilters')}
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={UserRound}
                title={t('admin:users.empty.title')}
                description={t('admin:users.empty.body')}
                action={
                  <Button
                    onClick={() => {
                      setCreated(null)
                      setFormOpen(true)
                    }}
                  >
                    {t('admin:users.newButton')}
                  </Button>
                }
              />
            )
          }
          mobileRow={(row) => (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-ink">{row.fullName}</span>
                <Badge tone={row.status === 'ACTIVE' ? 'success' : 'warning'}>
                  {t(`admin:users.status.${row.status}`)}
                </Badge>
                {row.isPlatformAdmin ? (
                  <Badge tone="accent">{t('admin:users.platformAdmin.yes')}</Badge>
                ) : null}
              </div>
              <p className="text-sm text-ink-muted">{row.email}</p>
              <p className="text-sm text-ink-muted">
                {row.memberships.length === 0
                  ? t('admin:users.memberships.none')
                  : row.memberships.map((membership) => membership.cooperativeName).join(' · ')}
              </p>
              {renderActions(row, true)}
            </div>
          )}
        />

        {meta && meta.total > 0 && !list.isPending ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
            <p className="text-sm text-ink-muted">
              {t('admin:users.pagination.summary', { from, to, total: meta.total })}
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={meta.page <= 1}
                onClick={() => setPage((cursor) => Math.max(1, cursor - 1))}
              >
                {t('common:actions.previous')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={meta.page >= meta.totalPages}
                onClick={() => setPage((cursor) => cursor + 1)}
              >
                {t('common:actions.next')}
              </Button>
            </div>
          </div>
        ) : null}
      </Panel>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPending(null)
            setActionError(null)
          }
        }}
        title={
          pending
            ? t(`admin:users.confirm.${pending.action}.title`, { name: pending.row.fullName })
            : ''
        }
        consequence={pending ? t(`admin:users.confirm.${pending.action}.body`) : ''}
        confirmLabel={pending ? t(`admin:users.confirm.${pending.action}.confirm`) : ''}
        tone={pending?.action === 'restore' ? 'primary' : 'danger'}
        busy={changeMutation.isPending}
        error={actionError}
        onConfirm={() => {
          if (!pending) return
          changeMutation.mutate({ id: pending.row.id, body: ACTION_CHANGE[pending.action] })
        }}
      />

      <NewUserDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        onCreated={(row) => {
          setFormOpen(false)
          setCreated(t('admin:users.created', { name: row.fullName, email: row.email }))
          void queryClient.invalidateQueries({ queryKey: adminKeys.userList })
        }}
      />
    </>
  )
}

function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value)
}

const userFormSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.email().max(160),
  isPlatformAdmin: z.boolean(),
  locale: z.string().refine((value) => value === '' || isLocale(value)),
})

type UserFormValues = z.input<typeof userFormSchema>
type UserFormResult = z.output<typeof userFormSchema>

const EMPTY_FORM: UserFormValues = { fullName: '', email: '', isPlatformAdmin: false, locale: '' }

function NewUserDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (row: AdminUserRow) => void
}) {
  const { t } = useTranslation(['admin', 'common'])
  const describeError = useAdminError()
  const [failure, setFailure] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const form = useForm<UserFormValues, undefined, UserFormResult>({
    resolver: zodResolver(userFormSchema),
    defaultValues: EMPTY_FORM,
  })

  const mutation = useMutation({
    mutationFn: createAdminUser,
    onSuccess: (row) => {
      form.reset(EMPTY_FORM)
      setFailure(null)
      setFieldErrors({})
      onCreated(row)
    },
    onError: (error) => {
      const described = describeError(error)
      setFailure(described.message)
      setFieldErrors(described.fieldErrors)
    },
  })

  const submit = form.handleSubmit((values) => {
    const locale = values.locale === '' ? undefined : values.locale
    mutation.mutate({
      email: values.email.trim(),
      fullName: values.fullName.trim(),
      isPlatformAdmin: values.isPlatformAdmin,
      ...(locale ? { locale } : {}),
    })
  })

  const errors = form.formState.errors
  // The native select and the switch are controlled, so both read their value back from the form.
  const locale = useWatch({ control: form.control, name: 'locale' })
  const isPlatformAdmin = useWatch({ control: form.control, name: 'isPlatformAdmin' })

  const localeOptions: SelectOption[] = [
    { value: '', label: t('admin:users.fields.localePlaceholder') },
    { value: 'EN', label: t('common:language.en') },
    { value: 'RW', label: t('common:language.rw') },
  ]

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setFailure(null)
          setFieldErrors({})
        }
        onOpenChange(next)
      }}
      title={t('admin:users.form.title')}
      description={t('admin:users.form.description')}
      busy={mutation.isPending}
      footer={
        <>
          <Button
            variant="secondary"
            disabled={mutation.isPending}
            onClick={() => onOpenChange(false)}
          >
            {t('common:actions.cancel')}
          </Button>
          <Button loading={mutation.isPending} onClick={() => void submit()}>
            {t('admin:users.form.submit')}
          </Button>
        </>
      }
    >
      <form noValidate className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
        {failure ? <Alert tone="danger">{failure}</Alert> : null}

        <FormField
          label={t('admin:users.fields.fullName')}
          error={errors.fullName ? t('admin:users.fieldErrors.fullName') : fieldErrors.fullName}
        >
          <Input autoComplete="off" {...form.register('fullName')} />
        </FormField>

        <FormField
          label={t('admin:users.fields.email')}
          hint={t('admin:users.fields.emailHint')}
          error={errors.email ? t('admin:users.fieldErrors.email') : fieldErrors.email}
        >
          <Input type="email" autoComplete="off" {...form.register('email')} />
        </FormField>

        <FormField label={t('admin:users.fields.locale')} optional>
          <Select options={localeOptions} value={locale} {...form.register('locale')} />
        </FormField>

        <Switch
          checked={isPlatformAdmin}
          onCheckedChange={(next) => form.setValue('isPlatformAdmin', next)}
          label={t('admin:users.fields.platformAdmin')}
          description={t('admin:users.fields.platformAdminHint')}
        />
      </form>
    </Dialog>
  )
}
