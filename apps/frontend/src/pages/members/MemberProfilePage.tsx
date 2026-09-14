import { ArrowLeft, CircleSlash, Clock, Coins, UserX } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { formatMoney, formatRwandanPhone } from '@coopmanage/shared'
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Dialog,
  EmptyState,
  FormField,
  Input,
  Money,
  Panel,
  Select,
  Skeleton,
  SkeletonText,
  Textarea,
  type BadgeTone,
  type Column,
  type SelectOption,
} from '@/components/ui'
import { usePermission } from '@/features/auth/useSession'
import { MemberFormDialog } from '@/features/members/MemberFormDialog'
import { RecordContributionDialog } from '@/features/members/RecordContributionDialog'
import {
  MEMBER_STATUSES,
  type ContributionRow,
  type MemberDetail,
  type MemberStatus,
  type ShareRow,
} from '@/features/members/members.api'
import {
  useFormatDate,
  useFormatDateTime,
  useFormatNumber,
  useMemberContributions,
  useMemberError,
  useMemberShares,
  useMemberSummary,
  useMemberTimeline,
  useSetMemberStatus,
} from '@/features/members/members.hooks'

/**
 * One member, everything recorded about them.
 *
 * The figures come from `/members/:id/summary`, which answers three different things for each
 * money block: here is the figure, you may not see this figure, or this figure does not exist yet.
 * The screen keeps those three apart. Showing a zero where the answer is "we cannot tell you yet"
 * would be a lie a cooperative might act on, so a block named in `unavailable` says which phase
 * brings it and a block named in `withheld` says the caller's role does not cover it.
 *
 * There is no delete action. A member is deactivated, suspended or marked as having left, and
 * marking them as having left requires the date they left, so the register still shows the period
 * they were a member.
 */

/** The phase that delivers each block the summary can report as not yet available. */
const PHASE_BY_BLOCK: Readonly<Record<string, number>> = {
  quantitySupplied: 6,
  documents: 9,
}

const SUMMARY_BLOCKS = [
  'shares',
  'contributions',
  'payments',
  'quantitySupplied',
  'documents',
] as const

const STATUS_TONE: Readonly<Record<MemberStatus, BadgeTone>> = {
  ACTIVE: 'success',
  INACTIVE: 'neutral',
  SUSPENDED: 'warning',
  EXITED: 'neutral',
}

function statusTone(status: string): BadgeTone {
  return MEMBER_STATUSES.some((value) => value === status)
    ? STATUS_TONE[status as MemberStatus]
    : 'neutral'
}

export function MemberProfilePage() {
  const { t } = useTranslation(['members', 'common'])
  const { id } = useParams<{ id: string }>()
  const describeError = useMemberError()
  const formatDate = useFormatDate()

  const canUpdate = usePermission('members:update')
  const canDeactivate = usePermission('members:deactivate')
  const canViewContributions = usePermission('contributions:view')
  const canCreateContribution = usePermission('contributions:create')
  const canViewShares = usePermission('shares:view')

  const summary = useMemberSummary(id)

  const [editOpen, setEditOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  // Bumped on each opening, so the status dialog is a fresh instance with fresh fields rather
  // than one that has to reset itself from an effect.
  const [statusSession, setStatusSession] = useState(0)
  const [contributionOpen, setContributionOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  if (summary.isPending) return <ProfileSkeleton />

  if (summary.isError) {
    const described = describeError(summary.error)
    return (
      <>
        <Link
          to="/members"
          className="inline-flex items-center gap-1.5 text-sm text-primary-600 hover:text-primary-700"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {t('members:actions.backToList')}
        </Link>
        <EmptyState
          icon={UserX}
          headingLevel={1}
          title={t('members:notFound.title')}
          description={t('members:notFound.body')}
          action={
            <Button variant="secondary" onClick={() => void summary.refetch()}>
              {t('common:actions.retry')}
            </Button>
          }
        />
        <Alert tone="danger">{described.message}</Alert>
      </>
    )
  }

  const member = summary.data.member

  return (
    <>
      <div>
        <Link
          to="/members"
          className="inline-flex items-center gap-1.5 text-sm text-primary-600 hover:text-primary-700"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {t('members:actions.backToList')}
        </Link>

        <header className="mt-2 flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-ink">{member.fullName}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-ink-muted">
              <span className="font-medium text-ink-secondary">{member.memberCode}</span>
              <Badge tone={statusTone(member.status)}>
                {t(`members:status.${member.status}`, { defaultValue: member.status })}
              </Badge>
              <span>{t('members:profile.memberSince', { date: formatDate(member.joinedOn) })}</span>
              {member.exitedOn ? (
                <span>{t('members:profile.exited', { date: formatDate(member.exitedOn) })}</span>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap gap-2">
            {canCreateContribution ? (
              <Button
                leadingIcon={<Coins aria-hidden="true" className="size-4" />}
                onClick={() => {
                  setNotice(null)
                  setContributionOpen(true)
                }}
              >
                {t('members:actions.recordContribution')}
              </Button>
            ) : null}
            {canUpdate ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setNotice(null)
                  setEditOpen(true)
                }}
              >
                {t('members:actions.edit')}
              </Button>
            ) : null}
            {canDeactivate ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setNotice(null)
                  setStatusSession((session) => session + 1)
                  setStatusOpen(true)
                }}
              >
                {t('members:actions.changeStatus')}
              </Button>
            ) : null}
          </div>
        </header>
      </div>

      {notice ? <Alert tone="success">{notice}</Alert> : null}

      {member.exitReason ? (
        <Alert tone="info">{t('members:profile.exitReason', { reason: member.exitReason })}</Alert>
      ) : null}

      <SummaryTiles summary={summary.data} />

      <RecordedDetails member={member} />

      <TimelinePanel id={id} />

      <ContributionsPanel id={id} allowed={canViewContributions} />

      <SharesPanel id={id} allowed={canViewShares} />

      <MemberFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        member={member}
        onSaved={(saved) => setNotice(t('members:form.updated', { name: saved.fullName }))}
      />

      <StatusDialog
        key={statusSession}
        open={statusOpen}
        onOpenChange={setStatusOpen}
        member={member}
        onChanged={(saved) =>
          setNotice(
            t('members:statusDialog.changed', {
              name: saved.fullName,
              status: t(`members:status.${saved.status}`, { defaultValue: saved.status }),
            }),
          )
        }
      />

      {canCreateContribution ? (
        <RecordContributionDialog
          open={contributionOpen}
          onOpenChange={setContributionOpen}
          member={member}
          onRecorded={(result) =>
            setNotice(
              t('members:contributionDialog.recorded', {
                amount: formatMoney(result.amount),
                name: member.fullName,
                reference: result.reference,
              }),
            )
          }
        />
      ) : null}
    </>
  )
}

function ProfileSkeleton() {
  const { t } = useTranslation('members')
  return (
    <>
      <h1 className="sr-only">{t('title')}</h1>
      <div className="flex flex-col gap-2 border-b border-line pb-4">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-24 w-full" />
        ))}
      </div>
      <Panel>
        <SkeletonText lines={4} />
      </Panel>
    </>
  )
}

/**
 * The money blocks.
 *
 * Each tile says one of three things, and never the wrong one of them: a figure, that the caller's
 * role does not cover it, or which phase will bring it.
 */
function SummaryTiles({
  summary,
}: {
  summary: {
    shares: { quantity: number; value: string } | null
    contributions: { count: number; total: string } | null
    payments: { total: string } | null
    unavailable: string[]
    withheld: string[]
  }
}) {
  const { t } = useTranslation('members')
  const formatNumber = useFormatNumber()

  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {SUMMARY_BLOCKS.map((block) => {
        const label = t(`summary.${block}`)

        if (summary.withheld.includes(block)) {
          return <SummaryTile key={block} label={label} note={t('summary.withheld')} />
        }
        if (summary.unavailable.includes(block)) {
          const phase = PHASE_BY_BLOCK[block]
          return (
            <SummaryTile
              key={block}
              label={label}
              note={
                phase === undefined
                  ? t('summary.notAvailable')
                  : t('summary.notAvailableYet', { phase })
              }
            />
          )
        }

        if (block === 'shares' && summary.shares) {
          return (
            <SummaryTile
              key={block}
              label={label}
              value={<Money value={summary.shares.value} />}
              hint={t('summary.sharesQuantity', {
                quantity: formatNumber(summary.shares.quantity),
              })}
            />
          )
        }
        if (block === 'contributions' && summary.contributions) {
          return (
            <SummaryTile
              key={block}
              label={label}
              value={<Money value={summary.contributions.total} />}
              hint={t('summary.contributionsCount', {
                quantity: formatNumber(summary.contributions.count),
              })}
            />
          )
        }
        if (block === 'payments' && summary.payments) {
          return (
            <SummaryTile
              key={block}
              label={label}
              value={<Money value={summary.payments.total} />}
            />
          )
        }

        // Neither a figure nor a stated reason. Saying so is still better than showing a zero.
        return <SummaryTile key={block} label={label} note={t('summary.notAvailable')} />
      })}
    </section>
  )
}

function SummaryTile({
  label,
  value,
  hint,
  note,
}: {
  label: string
  value?: ReactNode
  hint?: string
  /** Shown instead of a figure, when there is no figure to show. */
  note?: string
}) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <p className="text-sm text-ink-secondary">{label}</p>
      {note === undefined ? (
        <p className="mt-1 text-xl font-semibold text-ink">{value}</p>
      ) : (
        <p className="mt-1 flex items-start gap-1.5 text-sm text-ink-muted">
          <CircleSlash aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>{note}</span>
        </p>
      )}
      {hint ? <p className="mt-1 text-xs text-ink-muted">{hint}</p> : null}
    </div>
  )
}

function RecordedDetails({ member }: { member: MemberDetail }) {
  const { t } = useTranslation('members')
  const formatDate = useFormatDate()
  const formatDateTime = useFormatDateTime()
  const none = t('profile.noValue')

  const address =
    [member.village, member.cell, member.sector, member.district]
      .filter((part) => part !== null && part !== '')
      .join(', ') || none

  const rows: { label: string; value: string }[] = [
    { label: t('profile.phone'), value: member.phone ? formatRwandanPhone(member.phone) : none },
    { label: t('profile.email'), value: member.email ?? none },
    { label: t('profile.nationalId'), value: member.nationalId ?? none },
    {
      label: t('profile.dateOfBirth'),
      value: member.dateOfBirth ? formatDate(member.dateOfBirth) : none,
    },
    { label: t('filters.gender'), value: t(`gender.${member.gender}`, { defaultValue: none }) },
    {
      label: t('profile.position'),
      value: t(`position.${member.position}`, { defaultValue: none }),
    },
    {
      label: t('profile.address'),
      value: member.province
        ? `${address}${address === none ? '' : ' · '}${t(`province.${member.province}`, { defaultValue: '' })}`
        : address,
    },
    { label: t('profile.notes'), value: member.notes ?? none },
    { label: t('profile.createdAt'), value: formatDateTime(member.createdAt) },
    { label: t('profile.updatedAt'), value: formatDateTime(member.updatedAt) },
  ]

  return (
    <Panel title={t('profile.detailsTitle')} description={t('profile.detailsDescription')}>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => (
          <div key={row.label} className="min-w-0">
            <dt className="text-xs tracking-wide text-ink-muted uppercase">{row.label}</dt>
            <dd className="mt-0.5 text-base break-words text-ink">{row.value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  )
}

function TimelinePanel({ id }: { id: string | undefined }) {
  const { t } = useTranslation(['members', 'common'])
  const describeError = useMemberError()
  const formatDate = useFormatDate()
  const timeline = useMemberTimeline(id)

  return (
    <Panel title={t('members:timeline.title')} description={t('members:timeline.description')}>
      {timeline.isPending ? <SkeletonText lines={4} /> : null}

      {timeline.isError ? (
        <Alert
          tone="danger"
          title={t('members:loadFailed')}
          action={
            <Button variant="secondary" size="sm" onClick={() => void timeline.refetch()}>
              {t('common:actions.retry')}
            </Button>
          }
        >
          {describeError(timeline.error).message}
        </Alert>
      ) : null}

      {timeline.isSuccess && timeline.data.length === 0 ? (
        <EmptyState
          icon={Clock}
          headingLevel={3}
          title={t('members:timeline.emptyTitle')}
          description={t('members:timeline.emptyBody')}
        />
      ) : null}

      {timeline.isSuccess && timeline.data.length > 0 ? (
        <ol className="flex flex-col gap-3">
          {timeline.data.map((entry, index) => (
            <li
              key={`${entry.at}-${entry.kind}-${index}`}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line pb-3 last:border-b-0 last:pb-0"
            >
              {/*
                The server sends a translation key and its values rather than a sentence, so the
                history reads in the user's own language and Kinyarwanda noun classes are not
                broken by a sentence assembled from fragments.
              */}
              <span className="text-base text-ink">
                {t(`members:${entry.messageKey}`, { ...entry.messageParams })}
              </span>
              <span className="flex items-baseline gap-4">
                {entry.amount ? <Money value={entry.amount} /> : null}
                <span className="text-sm text-ink-muted">{formatDate(entry.at)}</span>
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </Panel>
  )
}

function ContributionsPanel({ id, allowed }: { id: string | undefined; allowed: boolean }) {
  const { t } = useTranslation(['members', 'common'])
  const describeError = useMemberError()
  const formatDate = useFormatDate()
  const contributions = useMemberContributions(id, allowed)

  const columns: Column<ContributionRow>[] = [
    {
      key: 'paidOn',
      header: t('members:contributions.columns.paidOn'),
      render: (row) => formatDate(row.paidOn),
    },
    {
      key: 'type',
      header: t('members:contributions.columns.type'),
      render: (row) => t(`members:contributions.type.${row.type}`, { defaultValue: row.type }),
    },
    {
      key: 'amount',
      header: t('members:contributions.columns.amount'),
      align: 'right',
      render: (row) => <Money value={row.amount} />,
    },
    {
      key: 'method',
      header: t('members:contributions.columns.method'),
      secondary: true,
      render: (row) => t(`members:method.${row.method}`, { defaultValue: row.method }),
    },
    {
      key: 'reference',
      header: t('members:contributions.columns.reference'),
      secondary: true,
      render: (row) => row.reference ?? row.financeReference ?? t('members:profile.noValue'),
    },
    {
      key: 'status',
      header: t('members:contributions.columns.status'),
      render: (row) => (
        <Badge tone={row.status === 'POSTED' ? 'success' : 'danger'}>
          {t(`members:contributions.status.${row.status}`, { defaultValue: row.status })}
        </Badge>
      ),
    },
  ]

  if (!allowed) {
    return (
      <Panel title={t('members:contributions.title')}>
        <Alert tone="info">{t('members:contributions.withheld')}</Alert>
      </Panel>
    )
  }

  return (
    <Panel
      flush
      title={t('members:contributions.title')}
      description={t('members:contributions.description')}
    >
      {contributions.isError ? (
        <div className="p-4">
          <Alert
            tone="danger"
            title={t('members:contributions.loadFailed')}
            action={
              <Button variant="secondary" size="sm" onClick={() => void contributions.refetch()}>
                {t('common:actions.retry')}
              </Button>
            }
          >
            {describeError(contributions.error).message}
          </Alert>
        </div>
      ) : (
        <DataTable
          rows={contributions.data?.items ?? []}
          columns={columns}
          rowKey={(row) => row.id}
          caption={t('members:contributions.caption')}
          loading={contributions.isPending}
          rowMuted={(row) => row.status !== 'POSTED'}
          footer={
            contributions.data && contributions.data.items.length > 0 ? (
              <>
                <td className="px-3 py-2" colSpan={2}>
                  {t('members:contributions.total')}
                </td>
                <td className="px-3 py-2 text-right">
                  <Money value={contributions.data.totalAmount} />
                </td>
                <td className="hidden px-3 py-2 lg:table-cell" colSpan={2} />
                <td className="px-3 py-2" />
              </>
            ) : undefined
          }
          empty={
            <EmptyState
              icon={Coins}
              headingLevel={3}
              title={t('members:contributions.emptyTitle')}
              description={t('members:contributions.emptyBody')}
            />
          }
          mobileRow={(row) => (
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-ink">
                  {t(`members:contributions.type.${row.type}`, { defaultValue: row.type })}
                </span>
                <Money value={row.amount} />
              </div>
              <p className="text-sm text-ink-muted">
                {formatDate(row.paidOn)} ·{' '}
                {t(`members:method.${row.method}`, { defaultValue: row.method })}
              </p>
            </div>
          )}
        />
      )}
    </Panel>
  )
}

function SharesPanel({ id, allowed }: { id: string | undefined; allowed: boolean }) {
  const { t } = useTranslation(['members', 'common'])
  const describeError = useMemberError()
  const formatDate = useFormatDate()
  const formatNumber = useFormatNumber()
  const shares = useMemberShares(id, allowed)

  const columns: Column<ShareRow>[] = [
    {
      key: 'issuedOn',
      header: t('members:shares.columns.issuedOn'),
      render: (row) => formatDate(row.issuedOn),
    },
    {
      key: 'type',
      header: t('members:shares.columns.type'),
      render: (row) => t(`members:shares.type.${row.type}`, { defaultValue: row.type }),
    },
    {
      key: 'quantity',
      header: t('members:shares.columns.quantity'),
      align: 'right',
      render: (row) => formatNumber(row.quantity),
    },
    {
      key: 'unitValue',
      header: t('members:shares.columns.unitValue'),
      align: 'right',
      secondary: true,
      render: (row) => <Money value={row.unitValue} withCurrency={false} />,
    },
    {
      key: 'totalValue',
      header: t('members:shares.columns.totalValue'),
      align: 'right',
      render: (row) => <Money value={row.totalValue} />,
    },
    {
      key: 'certificate',
      header: t('members:shares.columns.certificate'),
      secondary: true,
      render: (row) => row.certificateNo ?? t('members:profile.noValue'),
    },
    {
      key: 'status',
      header: t('members:shares.columns.status'),
      render: (row) => (
        <Badge tone={row.status === 'POSTED' ? 'success' : 'danger'}>
          {t(`members:shares.status.${row.status}`, { defaultValue: row.status })}
        </Badge>
      ),
    },
  ]

  if (!allowed) {
    return (
      <Panel title={t('members:shares.title')}>
        <Alert tone="info">{t('members:shares.withheld')}</Alert>
      </Panel>
    )
  }

  const holding = shares.data?.holding

  return (
    <Panel
      flush
      title={t('members:shares.title')}
      description={t('members:shares.description')}
      actions={
        holding ? (
          <p className="text-sm text-ink-secondary">
            {t('members:shares.holding')} <Money value={holding.value} />{' '}
            <span className="text-ink-muted">
              {t('members:shares.holdingQuantity', {
                quantity: formatNumber(holding.quantity),
              })}
            </span>
          </p>
        ) : undefined
      }
    >
      {shares.isError ? (
        <div className="p-4">
          <Alert
            tone="danger"
            title={t('members:shares.loadFailed')}
            action={
              <Button variant="secondary" size="sm" onClick={() => void shares.refetch()}>
                {t('common:actions.retry')}
              </Button>
            }
          >
            {describeError(shares.error).message}
          </Alert>
        </div>
      ) : (
        <DataTable
          rows={shares.data?.items ?? []}
          columns={columns}
          rowKey={(row) => row.id}
          caption={t('members:shares.caption')}
          loading={shares.isPending}
          rowMuted={(row) => row.status !== 'POSTED'}
          empty={
            <EmptyState
              icon={Coins}
              headingLevel={3}
              title={t('members:shares.emptyTitle')}
              description={t('members:shares.emptyBody')}
            />
          }
          mobileRow={(row) => (
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-ink">
                  {t(`members:shares.type.${row.type}`, { defaultValue: row.type })}
                </span>
                <Money value={row.totalValue} />
              </div>
              <p className="text-sm text-ink-muted">
                {formatDate(row.issuedOn)} · {formatNumber(row.quantity)}
              </p>
            </div>
          )}
        />
      )}
    </Panel>
  )
}

/**
 * Changing a member's status.
 *
 * Two steps in one dialog rather than a second dialog on top of the first: the fields are filled
 * in, and then the consequence is stated and confirmed. Anything other than putting a member back
 * to active is confirmed, because it changes who counts as a member of the cooperative. Marking
 * somebody as having left requires the date they left, which the server also insists on: without
 * it the register could not show the period they were a member.
 */
function StatusDialog({
  open,
  onOpenChange,
  member,
  onChanged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  member: MemberDetail
  onChanged: (member: MemberDetail) => void
}) {
  const { t } = useTranslation(['members', 'common'])
  const describeError = useMemberError()
  const change = useSetMemberStatus()

  // Deactivating is the change somebody almost always means from an active member, and
  // reinstating is the only thing to do with one who is not. The dialog is remounted per opening,
  // so these initial values are the whole of its reset.
  const [status, setStatus] = useState<MemberStatus>(
    member.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
  )
  const [reason, setReason] = useState('')
  const [exitedOn, setExitedOn] = useState(member.exitedOn ?? '')
  const [confirming, setConfirming] = useState(false)
  const [dateError, setDateError] = useState<string | null>(null)
  const failure = change.error ? describeError(change.error).message : null

  const options: SelectOption[] = useMemo(
    () =>
      MEMBER_STATUSES.filter((value) => value !== member.status).map((value) => ({
        value,
        label: t(`members:status.${value}`),
      })),
    [member.status, t],
  )

  const statusLabel = t(`members:status.${status}`)

  function goToConfirmation(): void {
    if (status === 'EXITED' && exitedOn === '') {
      setDateError(t('members:statusDialog.exitedOnRequired'))
      return
    }
    setDateError(null)
    // Putting somebody back to active takes nothing away, so it is not confirmed.
    if (status === 'ACTIVE') {
      apply()
      return
    }
    setConfirming(true)
  }

  function apply(): void {
    change.mutate(
      {
        id: member.id,
        change: {
          status,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
          ...(status === 'EXITED' ? { exitedOn } : {}),
        },
      },
      {
        onSuccess: (saved) => {
          onChanged(saved)
          onOpenChange(false)
        },
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width="sm"
      busy={change.isPending}
      title={
        confirming
          ? t('members:confirmStatus.title', { name: member.fullName, status: statusLabel })
          : t('members:statusDialog.title', { name: member.fullName })
      }
      description={confirming ? undefined : t('members:statusDialog.description')}
      footer={
        confirming ? (
          <>
            <Button
              variant="secondary"
              disabled={change.isPending}
              onClick={() => setConfirming(false)}
            >
              {t('common:actions.back')}
            </Button>
            <Button variant="danger" loading={change.isPending} onClick={apply}>
              {t('members:confirmStatus.confirm')}
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="secondary"
              disabled={change.isPending}
              onClick={() => onOpenChange(false)}
            >
              {t('common:actions.cancel')}
            </Button>
            <Button loading={change.isPending} onClick={goToConfirmation}>
              {t('members:statusDialog.submit')}
            </Button>
          </>
        )
      }
    >
      {failure ? <Alert tone="danger">{failure}</Alert> : null}

      {confirming ? (
        <p className="text-base text-ink-secondary">{t('members:confirmStatus.body')}</p>
      ) : (
        <div className="flex flex-col gap-4">
          <FormField label={t('members:statusDialog.status')}>
            <Select
              options={options}
              value={status}
              onChange={(event) => setStatus(event.target.value as MemberStatus)}
            />
          </FormField>

          {status === 'EXITED' ? (
            <FormField
              label={t('members:statusDialog.exitedOn')}
              hint={t('members:statusDialog.exitedOnHint')}
              error={dateError ?? undefined}
            >
              <Input
                type="date"
                value={exitedOn}
                onChange={(event) => setExitedOn(event.target.value)}
              />
            </FormField>
          ) : null}

          <FormField
            label={t('members:statusDialog.reason')}
            optional
            hint={t('members:statusDialog.reasonHint')}
          >
            <Textarea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
          </FormField>
        </div>
      )}
    </Dialog>
  )
}
