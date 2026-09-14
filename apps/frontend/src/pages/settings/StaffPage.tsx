import { KeyRound, ShieldOff, UserPlus, Users } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RoleKey } from '@coopmanage/shared'
import { PageHeader } from '@/components/PageHeader'
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Panel,
  Select,
  Tooltip,
  type Column,
} from '@/components/ui'
import { usePermission } from '@/features/auth/useSession'
import { InviteStaffDialog } from '@/features/staff/InviteStaffDialog'
import { StaffOverridesDialog } from '@/features/staff/StaffOverridesDialog'
import type { StaffMember } from '@/features/staff/staff.api'
import {
  useDeactivateStaff,
  useRoles,
  useStaffList,
  useUpdateStaff,
} from '@/features/staff/staff.hooks'
import { useApiError } from '@/hooks/useApiErrorMessage'
import { currentLanguage } from '@/i18n'

type StatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE'

/**
 * Who works at this cooperative and what each of them may do.
 *
 * Three rules from the backend are surfaced rather than hidden, because a control that fails on
 * click is worse than one that explains itself: nobody changes their own role or status, the only
 * active manager cannot be removed, and a deactivated person keeps their history.
 */
export function StaffPage() {
  const { t } = useTranslation(['staff', 'common'])
  const describeError = useApiError()
  const language = currentLanguage()

  const canInvite = usePermission('staff:invite')
  const canManage = usePermission('staff:manage')

  const [status, setStatus] = useState<StatusFilter>('ALL')
  const [roleKey, setRoleKey] = useState<RoleKey | 'ALL'>('ALL')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [overridesFor, setOverridesFor] = useState<StaffMember | null>(null)
  const [deactivating, setDeactivating] = useState<StaffMember | null>(null)

  const filters = {
    ...(status === 'ALL' ? {} : { status }),
    ...(roleKey === 'ALL' ? {} : { roleKey }),
  }
  const { data: staff, isPending, isError, refetch } = useStaffList(filters)
  const { data: roles } = useRoles()
  const updateStaff = useUpdateStaff()
  const deactivate = useDeactivateStaff()

  const filtersActive = status !== 'ALL' || roleKey !== 'ALL'

  function roleLabel(member: StaffMember): string {
    return language === 'rw' ? member.roleName.rw : member.roleName.en
  }

  /** The reason a control is disabled, so the interface explains instead of just refusing. */
  function blockedReason(member: StaffMember): string | null {
    if (!canManage) return t('staff:blocked.noPermission')
    if (member.isSelf) return t('staff:blocked.self')
    return null
  }

  const columns: Column<StaffMember>[] = [
    {
      key: 'name',
      header: t('staff:fields.fullName'),
      render: (member) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium text-ink">
            {member.user.fullName}
            {member.isSelf ? (
              <span className="ml-1.5 text-sm font-normal text-ink-muted">{t('staff:you')}</span>
            ) : null}
          </span>
          <span className="truncate text-sm text-ink-muted">{member.user.email}</span>
        </span>
      ),
    },
    {
      key: 'role',
      header: t('staff:fields.role'),
      render: (member) =>
        canManage && !member.isSelf ? (
          <>
            <label className="sr-only" htmlFor={`role-${member.id}`}>
              {t('staff:changeRoleFor', { name: member.user.fullName })}
            </label>
            <Select
              id={`role-${member.id}`}
              className="h-8 max-w-44"
              value={member.roleKey}
              disabled={updateStaff.isPending}
              options={(roles ?? []).map((role) => ({
                value: role.key,
                label: language === 'rw' ? role.nameRw : role.nameEn,
              }))}
              onChange={(event) =>
                updateStaff.mutate({ id: member.id, roleKey: event.target.value as RoleKey })
              }
            />
          </>
        ) : (
          <span>{roleLabel(member)}</span>
        ),
    },
    {
      key: 'jobTitle',
      header: t('staff:fields.jobTitle'),
      secondary: true,
      render: (member) => member.jobTitle ?? <span className="text-ink-muted">—</span>,
    },
    {
      key: 'status',
      header: t('staff:fields.status'),
      render: (member) =>
        member.status === 'ACTIVE' ? (
          <Badge tone="success">{t('staff:status.active')}</Badge>
        ) : (
          <Badge tone="neutral">{t('staff:status.inactive')}</Badge>
        ),
    },
    {
      key: 'exceptions',
      header: t('staff:fields.exceptions'),
      align: 'right',
      secondary: true,
      render: (member) =>
        member.overrideCount > 0 ? (
          <Badge tone="info">{member.overrideCount}</Badge>
        ) : (
          <span className="text-ink-muted">—</span>
        ),
    },
    {
      key: 'actions',
      header: t('common:actions.edit'),
      align: 'right',
      width: '13rem',
      render: (member) => {
        const reason = blockedReason(member)
        return (
          <span className="flex justify-end gap-1.5">
            <ActionButton
              label={t('staff:actions.exceptions')}
              icon={<KeyRound aria-hidden="true" className="size-4" />}
              disabled={!canManage}
              disabledReason={canManage ? null : t('staff:blocked.noPermission')}
              onClick={() => setOverridesFor(member)}
            />
            {member.status === 'ACTIVE' ? (
              <ActionButton
                label={t('staff:actions.deactivate')}
                icon={<ShieldOff aria-hidden="true" className="size-4" />}
                disabled={reason !== null}
                disabledReason={reason}
                onClick={() => setDeactivating(member)}
              />
            ) : (
              <ActionButton
                label={t('staff:actions.restore')}
                icon={<Users aria-hidden="true" className="size-4" />}
                disabled={reason !== null}
                disabledReason={reason}
                onClick={() => updateStaff.mutate({ id: member.id, status: 'ACTIVE' })}
              />
            )}
          </span>
        )
      },
    },
  ]

  return (
    <>
      <PageHeader
        title={t('staff:title')}
        description={t('staff:description')}
        actions={
          canInvite ? (
            <Button
              leadingIcon={<UserPlus aria-hidden="true" className="size-4" />}
              onClick={() => setInviteOpen(true)}
            >
              {t('staff:invite.action')}
            </Button>
          ) : null
        }
      />

      {updateStaff.isError ? (
        <Alert tone="danger">{describeError(updateStaff.error).message}</Alert>
      ) : null}

      <Panel flush>
        <div className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3">
          <div className="w-44">
            <label htmlFor="staff-status" className="mb-1.5 block text-sm font-medium text-ink">
              {t('staff:fields.status')}
            </label>
            <Select
              id="staff-status"
              value={status}
              onChange={(event) => setStatus(event.target.value as StatusFilter)}
              options={[
                { value: 'ALL', label: t('staff:filters.allStatuses') },
                { value: 'ACTIVE', label: t('staff:status.active') },
                { value: 'INACTIVE', label: t('staff:status.inactive') },
              ]}
            />
          </div>
          <div className="w-52">
            <label htmlFor="staff-role" className="mb-1.5 block text-sm font-medium text-ink">
              {t('staff:fields.role')}
            </label>
            <Select
              id="staff-role"
              value={roleKey}
              onChange={(event) => setRoleKey(event.target.value as RoleKey | 'ALL')}
              options={[
                { value: 'ALL', label: t('staff:filters.allRoles') },
                ...(roles ?? []).map((role) => ({
                  value: role.key,
                  label: language === 'rw' ? role.nameRw : role.nameEn,
                })),
              ]}
            />
          </div>
          {filtersActive ? (
            <Button
              variant="ghost"
              onClick={() => {
                setStatus('ALL')
                setRoleKey('ALL')
              }}
            >
              {t('common:actions.clearFilters')}
            </Button>
          ) : null}
        </div>

        {isError ? (
          <div className="p-4">
            <Alert
              tone="danger"
              title={t('staff:loadFailed')}
              action={
                <Button variant="secondary" size="sm" onClick={() => void refetch()}>
                  {t('common:actions.retry')}
                </Button>
              }
            />
          </div>
        ) : (
          <DataTable
            rows={staff ?? []}
            columns={columns}
            rowKey={(member) => member.id}
            caption={t('staff:tableCaption')}
            loading={isPending}
            rowMuted={(member) => member.status === 'INACTIVE'}
            empty={
              filtersActive ? (
                <EmptyState
                  icon={Users}
                  title={t('staff:emptyFiltered.title')}
                  description={t('staff:emptyFiltered.body')}
                  action={
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setStatus('ALL')
                        setRoleKey('ALL')
                      }}
                    >
                      {t('common:actions.clearFilters')}
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={Users}
                  title={t('staff:empty.title')}
                  description={t('staff:empty.body')}
                  action={
                    canInvite ? (
                      <Button onClick={() => setInviteOpen(true)}>
                        {t('staff:invite.action')}
                      </Button>
                    ) : null
                  }
                />
              )
            }
            mobileRow={(member) => (
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink">
                    {member.user.fullName}
                  </span>
                  <span className="block truncate text-sm text-ink-muted">{roleLabel(member)}</span>
                </span>
                {member.status === 'ACTIVE' ? (
                  <Badge tone="success">{t('staff:status.active')}</Badge>
                ) : (
                  <Badge tone="neutral">{t('staff:status.inactive')}</Badge>
                )}
              </div>
            )}
          />
        )}
      </Panel>

      <InviteStaffDialog open={inviteOpen} onOpenChange={setInviteOpen} />
      <StaffOverridesDialog
        staff={overridesFor}
        onOpenChange={(open) => !open && setOverridesFor(null)}
      />

      <ConfirmDialog
        open={deactivating !== null}
        onOpenChange={(open) => !open && setDeactivating(null)}
        title={t('staff:deactivate.title', { name: deactivating?.user.fullName ?? '' })}
        consequence={t('staff:deactivate.consequence')}
        confirmLabel={t('staff:actions.deactivate')}
        busy={deactivate.isPending}
        error={deactivate.isError ? describeError(deactivate.error).message : null}
        onConfirm={() => {
          if (!deactivating) return
          deactivate.mutate({ id: deactivating.id }, { onSuccess: () => setDeactivating(null) })
        }}
      />
    </>
  )
}

/**
 * A small icon button that explains why it cannot be used, rather than silently refusing.
 *
 * It stays enabled and carries `aria-disabled` instead of `disabled`. A truly disabled button
 * takes no pointer events, so its tooltip never opens and it drops out of the tab order, which
 * leaves a keyboard user with no way to find out why the action is unavailable.
 */
function ActionButton({
  label,
  icon,
  disabled,
  disabledReason,
  onClick,
}: {
  label: string
  icon: React.ReactNode
  disabled: boolean
  disabledReason: string | null
  onClick: () => void
}) {
  const button = (
    <Button
      variant="ghost"
      size="sm"
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={disabled ? 'cursor-not-allowed opacity-55' : undefined}
      onClick={() => {
        if (!disabled) onClick()
      }}
      leadingIcon={icon}
    >
      <span className="sr-only lg:not-sr-only">{label}</span>
    </Button>
  )

  if (!disabled || !disabledReason) return button
  return <Tooltip content={disabledReason}>{button}</Tooltip>
}
