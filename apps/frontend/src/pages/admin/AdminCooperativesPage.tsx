import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, SearchX } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { LOCALES, RWANDA_PROVINCES, type Locale, type Province } from '@coopmanage/shared'
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
  type BadgeTone,
  type Column,
  type SelectOption,
} from '@/components/ui'
import {
  COOPERATIVE_STATUSES,
  createAdminCooperative,
  listAdminCooperatives,
  updateAdminCooperative,
  type AdminCooperativeFilters,
  type AdminCooperativeRow,
  type CooperativeStatus,
  type CreateCooperativeResult,
} from '@/features/admin/admin.api'
import {
  adminKeys,
  useAdminError,
  useCooperativeTypeOptions,
  useDebouncedValue,
  useFormatDate,
} from '@/features/admin/admin.hooks'

const PAGE_SIZE = 25

/** The three row actions, each a status change phrased as the operator would say it. */
type RowAction = 'suspend' | 'restore' | 'archive'

const ACTION_STATUS: Readonly<Record<RowAction, CooperativeStatus>> = {
  suspend: 'SUSPENDED',
  restore: 'ACTIVE',
  archive: 'ARCHIVED',
}

const STATUS_TONE: Readonly<Record<CooperativeStatus, BadgeTone>> = {
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  ARCHIVED: 'neutral',
}

function readStatus(value: string): CooperativeStatus | '' {
  return COOPERATIVE_STATUSES.find((status) => status === value) ?? ''
}

/** Which actions a row offers, which follows entirely from the status it is in. */
function actionsFor(status: CooperativeStatus): RowAction[] {
  if (status === 'ACTIVE') return ['suspend', 'archive']
  if (status === 'SUSPENDED') return ['restore', 'archive']
  return ['restore']
}

/**
 * Every cooperative on the platform.
 *
 * Creating one creates its first manager in the same request, because a cooperative nobody can
 * administer is not usable and would need a second privileged action to become so. Suspending
 * signs that cooperative's staff out immediately, and archiving is refused while any of them is
 * still active, so no one's access disappears without a decision having been made about them.
 */
export function AdminCooperativesPage() {
  const { t } = useTranslation(['admin', 'common'])
  const queryClient = useQueryClient()
  const describeError = useAdminError()
  const formatDate = useFormatDate()
  const types = useCooperativeTypeOptions()

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<CooperativeStatus | ''>('')
  const [includeDemo, setIncludeDemo] = useState(true)
  const [page, setPage] = useState(1)
  const [formOpen, setFormOpen] = useState(false)
  const [created, setCreated] = useState<string | null>(null)
  const [pending, setPending] = useState<{ row: AdminCooperativeRow; action: RowAction } | null>(
    null,
  )
  const [actionError, setActionError] = useState<string | null>(null)

  const debouncedSearch = useDebouncedValue(search)

  const filters = useMemo<AdminCooperativeFilters>(
    () => ({ q: debouncedSearch.trim(), status, includeDemo, page, pageSize: PAGE_SIZE }),
    [debouncedSearch, status, includeDemo, page],
  )

  const filtersApplied = filters.q !== '' || status !== '' || !includeDemo

  const list = useQuery({
    queryKey: adminKeys.cooperatives(filters),
    queryFn: () => listAdminCooperatives(filters),
  })

  const statusMutation = useMutation({
    mutationFn: (change: { id: string; status: CooperativeStatus }) =>
      updateAdminCooperative(change.id, { status: change.status }),
    onSuccess: async () => {
      setActionError(null)
      setPending(null)
      await queryClient.invalidateQueries({ queryKey: adminKeys.cooperativeList })
    },
    onError: (error: unknown) => setActionError(describeError(error).message),
  })

  const rows = list.data?.items ?? []
  const meta = list.data?.meta

  const typeLabels = useMemo(() => {
    const labels = new Map<string, string>()
    for (const option of types.options) labels.set(option.value, option.label)
    return labels
  }, [types.options])

  function clearFilters(): void {
    setSearch('')
    setStatus('')
    setIncludeDemo(true)
    setPage(1)
  }

  const statusOptions: SelectOption[] = [
    { value: '', label: t('admin:cooperatives.statusFilter.all') },
    ...COOPERATIVE_STATUSES.map((value) => ({
      value,
      label: t(`admin:cooperatives.status.${value}`),
    })),
  ]

  const columns: Column<AdminCooperativeRow>[] = [
    {
      key: 'name',
      header: t('admin:cooperatives.columns.name'),
      render: (row) => (
        <div className="flex flex-col gap-0.5 py-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-ink">{row.name}</span>
            {row.isDemo ? <Badge tone="accent">{t('admin:cooperatives.demoBadge')}</Badge> : null}
          </span>
          <span className="text-xs text-ink-muted">{row.code}</span>
        </div>
      ),
    },
    {
      key: 'type',
      header: t('admin:cooperatives.columns.type'),
      secondary: true,
      render: (row) => typeLabels.get(row.typeKey) ?? row.typeKey,
    },
    {
      key: 'status',
      header: t('admin:cooperatives.columns.status'),
      render: (row) => (
        <Badge tone={STATUS_TONE[row.status]}>{t(`admin:cooperatives.status.${row.status}`)}</Badge>
      ),
    },
    {
      key: 'location',
      header: t('admin:cooperatives.columns.location'),
      secondary: true,
      render: (row) =>
        t('admin:cooperatives.location', {
          district: row.district,
          province: t(`admin:provinces.${row.province}`),
        }),
    },
    {
      key: 'staff',
      header: t('admin:cooperatives.columns.staff'),
      align: 'right',
      render: (row) =>
        t('admin:cooperatives.staffValue', {
          active: row.activeStaffCount,
          total: row.staffCount,
        }),
    },
    {
      key: 'created',
      header: t('admin:cooperatives.columns.created'),
      secondary: true,
      render: (row) => formatDate(row.createdAt),
    },
    {
      key: 'actions',
      header: t('admin:cooperatives.columns.actions'),
      align: 'right',
      width: '15rem',
      render: (row) => (
        <div className="flex justify-end gap-2 py-1">
          {actionsFor(row.status).map((action) => (
            <Button
              key={action}
              size="sm"
              variant={action === 'restore' ? 'secondary' : 'ghost'}
              onClick={() => {
                setActionError(null)
                setPending({ row, action })
              }}
            >
              {t(`admin:cooperatives.actions.${action}`)}
            </Button>
          ))}
        </div>
      ),
    },
  ]

  const from = meta ? (meta.page - 1) * meta.pageSize + 1 : 0
  const to = meta ? Math.min(meta.page * meta.pageSize, meta.total) : 0

  return (
    <>
      <PageHeader
        title={t('admin:cooperatives.title')}
        description={t('admin:cooperatives.description')}
        actions={
          <Button
            onClick={() => {
              setCreated(null)
              setFormOpen(true)
            }}
          >
            {t('admin:cooperatives.newButton')}
          </Button>
        }
      />

      {created ? <Alert tone="success">{created}</Alert> : null}

      {list.isError ? (
        <Alert
          tone="danger"
          title={t('admin:cooperatives.error.body')}
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
          <FormField label={t('admin:cooperatives.search.label')} className="min-w-56 flex-1">
            <Input
              type="search"
              placeholder={t('admin:cooperatives.search.placeholder')}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setPage(1)
              }}
            />
          </FormField>

          <FormField label={t('admin:cooperatives.statusFilter.label')} className="w-48">
            <Select
              options={statusOptions}
              value={status}
              onChange={(event) => {
                setStatus(readStatus(event.target.value))
                setPage(1)
              }}
            />
          </FormField>

          <Switch
            checked={includeDemo}
            onCheckedChange={(next) => {
              setIncludeDemo(next)
              setPage(1)
            }}
            label={t('admin:cooperatives.demoFilter.label')}
            description={t('admin:cooperatives.demoFilter.description')}
          />
        </div>

        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          caption={t('admin:cooperatives.tableCaption')}
          loading={list.isPending}
          rowMuted={(row) => row.status !== 'ACTIVE'}
          empty={
            filtersApplied ? (
              <EmptyState
                icon={SearchX}
                title={t('admin:cooperatives.noResults.title')}
                description={t('admin:cooperatives.noResults.body')}
                action={
                  <Button variant="secondary" onClick={clearFilters}>
                    {t('common:actions.clearFilters')}
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={Building2}
                title={t('admin:cooperatives.empty.title')}
                description={t('admin:cooperatives.empty.body')}
                action={
                  <Button
                    onClick={() => {
                      setCreated(null)
                      setFormOpen(true)
                    }}
                  >
                    {t('admin:cooperatives.newButton')}
                  </Button>
                }
              />
            )
          }
          mobileRow={(row) => (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-ink">{row.name}</span>
                {row.isDemo ? (
                  <Badge tone="accent">{t('admin:cooperatives.demoBadge')}</Badge>
                ) : null}
                <Badge tone={STATUS_TONE[row.status]}>
                  {t(`admin:cooperatives.status.${row.status}`)}
                </Badge>
              </div>
              <p className="text-sm text-ink-muted">
                {row.code} ·{' '}
                {t('admin:cooperatives.location', {
                  district: row.district,
                  province: t(`admin:provinces.${row.province}`),
                })}
              </p>
              <p className="text-sm text-ink-muted">
                {t('admin:cooperatives.columns.staff')}:{' '}
                {t('admin:cooperatives.staffValue', {
                  active: row.activeStaffCount,
                  total: row.staffCount,
                })}
              </p>
              <div className="flex flex-wrap gap-2">
                {actionsFor(row.status).map((action) => (
                  <Button
                    key={action}
                    size="sm"
                    variant={action === 'restore' ? 'secondary' : 'ghost'}
                    onClick={() => {
                      setActionError(null)
                      setPending({ row, action })
                    }}
                  >
                    {t(`admin:cooperatives.actions.${action}`)}
                  </Button>
                ))}
              </div>
            </div>
          )}
        />

        {meta && meta.total > 0 && !list.isPending ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
            <p className="text-sm text-ink-muted">
              {t('admin:cooperatives.pagination.summary', { from, to, total: meta.total })}
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={meta.page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                {t('common:actions.previous')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={meta.page >= meta.totalPages}
                onClick={() => setPage((current) => current + 1)}
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
            ? t(`admin:cooperatives.confirm.${pending.action}.title`, { name: pending.row.name })
            : ''
        }
        consequence={pending ? t(`admin:cooperatives.confirm.${pending.action}.body`) : ''}
        confirmLabel={pending ? t(`admin:cooperatives.confirm.${pending.action}.confirm`) : ''}
        tone={pending?.action === 'restore' ? 'primary' : 'danger'}
        busy={statusMutation.isPending}
        error={actionError}
        onConfirm={() => {
          if (!pending) return
          statusMutation.mutate({ id: pending.row.id, status: ACTION_STATUS[pending.action] })
        }}
      />

      <NewCooperativeDialog
        open={formOpen}
        types={types}
        onOpenChange={setFormOpen}
        onCreated={(result) => {
          setFormOpen(false)
          setCreated(
            t(
              result.manager.accountCreated
                ? 'admin:cooperatives.created.withAccount'
                : 'admin:cooperatives.created.existingAccount',
              { name: result.cooperative.name, email: result.manager.email },
            ),
          )
          void queryClient.invalidateQueries({ queryKey: adminKeys.cooperativeList })
        }}
      />
    </>
  )
}

function isProvince(value: string): value is Province {
  return (RWANDA_PROVINCES as readonly string[]).includes(value)
}

function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value)
}

/**
 * Mirrors the server's own rules rather than guessing at them, so somebody typing a code that
 * cannot be accepted is told before the request is sent. The server checks again regardless.
 */
const cooperativeFormSchema = z.object({
  name: z.string().trim().min(3).max(160),
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z][A-Za-z0-9-]{2,23}$/),
  typeKey: z.string().min(1),
  registrationNumber: z.string().trim().max(60),
  province: z.string().refine(isProvince),
  district: z.string().trim().min(2).max(60),
  sector: z.string().trim().min(2).max(60),
  cell: z.string().trim().min(1).max(60),
  village: z.string().trim().min(1).max(60),
  defaultLocale: z.string().refine((value) => value === '' || isLocale(value)),
  managerFullName: z.string().trim().min(2).max(120),
  managerEmail: z.email().max(160),
})

/**
 * The fields hold plain strings, which is what a form control produces; the schema hands back the
 * narrowed province and locale on submit, so nothing downstream has to assert them.
 */
type CooperativeFormValues = z.input<typeof cooperativeFormSchema>
type CooperativeFormResult = z.output<typeof cooperativeFormSchema>

const EMPTY_FORM: CooperativeFormValues = {
  name: '',
  code: '',
  typeKey: '',
  registrationNumber: '',
  province: '',
  district: '',
  sector: '',
  cell: '',
  village: '',
  defaultLocale: '',
  managerFullName: '',
  managerEmail: '',
}

function NewCooperativeDialog({
  open,
  types,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  types: { options: SelectOption[]; isError: boolean }
  onOpenChange: (open: boolean) => void
  onCreated: (result: CreateCooperativeResult) => void
}) {
  const { t } = useTranslation(['admin', 'common'])
  const describeError = useAdminError()
  const [failure, setFailure] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const form = useForm<CooperativeFormValues, undefined, CooperativeFormResult>({
    resolver: zodResolver(cooperativeFormSchema),
    defaultValues: EMPTY_FORM,
  })

  const mutation = useMutation({
    mutationFn: createAdminCooperative,
    onSuccess: (result) => {
      form.reset(EMPTY_FORM)
      setFailure(null)
      setFieldErrors({})
      onCreated(result)
    },
    onError: (error: unknown) => {
      const described = describeError(error)
      setFailure(described.message)
      setFieldErrors(described.fieldErrors)
    },
  })

  const submit = form.handleSubmit((values) => {
    // `province` and `defaultLocale` arrive narrowed by the schema, so there is nothing to assert.
    const locale = values.defaultLocale === '' ? undefined : values.defaultLocale

    mutation.mutate({
      name: values.name.trim(),
      code: values.code.trim().toUpperCase(),
      typeKey: values.typeKey,
      ...(values.registrationNumber.trim()
        ? { registrationNumber: values.registrationNumber.trim() }
        : {}),
      province: values.province,
      district: values.district.trim(),
      sector: values.sector.trim(),
      cell: values.cell.trim(),
      village: values.village.trim(),
      ...(locale ? { defaultLocale: locale } : {}),
      manager: {
        email: values.managerEmail.trim(),
        fullName: values.managerFullName.trim(),
      },
    })
  })

  const errors = form.formState.errors
  // `Select` is a controlled native select, so the chosen value has to be handed back to it;
  // registering alone would leave every picker showing its placeholder whatever was chosen.
  const typeKey = useWatch({ control: form.control, name: 'typeKey' })
  const province = useWatch({ control: form.control, name: 'province' })
  const defaultLocale = useWatch({ control: form.control, name: 'defaultLocale' })

  function errorFor(field: keyof CooperativeFormValues, serverField: string): string | undefined {
    if (errors[field]) return t(`admin:cooperatives.fieldErrors.${fieldErrorKey(field)}`)
    return fieldErrors[serverField]
  }

  const provinceOptions: SelectOption[] = RWANDA_PROVINCES.map((value) => ({
    value,
    label: t(`admin:provinces.${value}`),
  }))

  const localeOptions: SelectOption[] = [
    { value: '', label: t('admin:cooperatives.fields.localePlaceholder') },
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
      title={t('admin:cooperatives.form.title')}
      description={t('admin:cooperatives.form.description')}
      width="lg"
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
            {t('admin:cooperatives.form.submit')}
          </Button>
        </>
      }
    >
      <form noValidate className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
        {failure ? <Alert tone="danger">{failure}</Alert> : null}
        {types.isError ? (
          <Alert tone="warning">{t('admin:cooperatives.form.typesError')}</Alert>
        ) : null}

        <FormField label={t('admin:cooperatives.fields.name')} error={errorFor('name', 'name')}>
          <Input autoComplete="off" {...form.register('name')} />
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label={t('admin:cooperatives.fields.code')}
            hint={t('admin:cooperatives.fields.codeHint')}
            error={errorFor('code', 'code')}
          >
            <Input autoComplete="off" {...form.register('code')} />
          </FormField>

          <FormField
            label={t('admin:cooperatives.fields.type')}
            error={errorFor('typeKey', 'typeKey')}
          >
            <Select
              placeholder={t('admin:cooperatives.fields.typePlaceholder')}
              options={types.options}
              value={typeKey}
              {...form.register('typeKey')}
            />
          </FormField>
        </div>

        <FormField
          label={t('admin:cooperatives.fields.registrationNumber')}
          optional
          error={fieldErrors.registrationNumber}
        >
          <Input autoComplete="off" {...form.register('registrationNumber')} />
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label={t('admin:cooperatives.fields.province')}
            error={errorFor('province', 'province')}
          >
            <Select
              placeholder={t('admin:cooperatives.fields.provincePlaceholder')}
              options={provinceOptions}
              value={province}
              {...form.register('province')}
            />
          </FormField>

          <FormField
            label={t('admin:cooperatives.fields.district')}
            error={errorFor('district', 'district')}
          >
            <Input autoComplete="off" {...form.register('district')} />
          </FormField>

          <FormField
            label={t('admin:cooperatives.fields.sector')}
            error={errorFor('sector', 'sector')}
          >
            <Input autoComplete="off" {...form.register('sector')} />
          </FormField>

          <FormField label={t('admin:cooperatives.fields.cell')} error={errorFor('cell', 'cell')}>
            <Input autoComplete="off" {...form.register('cell')} />
          </FormField>

          <FormField
            label={t('admin:cooperatives.fields.village')}
            error={errorFor('village', 'village')}
          >
            <Input autoComplete="off" {...form.register('village')} />
          </FormField>

          <FormField label={t('admin:cooperatives.fields.locale')} optional>
            <Select
              options={localeOptions}
              value={defaultLocale}
              {...form.register('defaultLocale')}
            />
          </FormField>
        </div>

        <fieldset className="flex flex-col gap-4 rounded-md border border-line p-3">
          <legend className="px-1 text-sm font-medium text-ink">
            {t('admin:cooperatives.form.managerSection')}
          </legend>
          <p className="text-sm text-ink-muted">{t('admin:cooperatives.form.managerHint')}</p>

          <FormField
            label={t('admin:cooperatives.fields.managerFullName')}
            error={errorFor('managerFullName', 'manager.fullName')}
          >
            <Input autoComplete="off" {...form.register('managerFullName')} />
          </FormField>

          <FormField
            label={t('admin:cooperatives.fields.managerEmail')}
            error={errorFor('managerEmail', 'manager.email')}
          >
            <Input type="email" autoComplete="off" {...form.register('managerEmail')} />
          </FormField>
        </fieldset>
      </form>
    </Dialog>
  )
}

/** Form field names and their translation keys differ only for the manager's two fields. */
function fieldErrorKey(field: keyof CooperativeFormValues): string {
  if (field === 'typeKey') return 'type'
  return field
}
