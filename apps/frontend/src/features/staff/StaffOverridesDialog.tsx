import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PermissionKey } from '@coopmanage/shared'
import { Alert, Button, Dialog, Select, SkeletonText } from '@/components/ui'
import { useApiError } from '@/hooks/useApiErrorMessage'
import { currentLanguage } from '@/i18n'
import { usePermissionCatalogue, usePutOverrides, useRoles, useStaffOverrides } from './staff.hooks'
import type { CataloguePermission, StaffMember, StaffOverride } from './staff.api'

type Effect = 'INHERIT' | 'GRANT' | 'DENY'

export interface StaffOverridesDialogProps {
  staff: StaffMember | null
  onOpenChange: (open: boolean) => void
}

/**
 * Per-person exceptions to a role.
 *
 * These exist so a real cooperative with unusual staffing does not have to invent a new role for
 * one person. The whole set is sent at once rather than one permission at a time, so two managers
 * editing together cannot merge into a combination neither of them chose.
 *
 * Every permission shows what the role already gives, so an exception is visibly an exception.
 * A denial always wins over a grant, which is what makes handing this to a manager safe.
 */
export function StaffOverridesDialog({ staff, onOpenChange }: StaffOverridesDialogProps) {
  const { t } = useTranslation(['staff', 'common'])
  const open = staff !== null
  const { data, isPending } = useStaffOverrides(staff?.id ?? null)
  const { data: catalogue } = usePermissionCatalogue(open)

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width="lg"
      title={t('staff:overrides.title', { name: staff?.user.fullName ?? '' })}
      description={t('staff:overrides.description')}
    >
      {isPending || !data || !catalogue || !staff ? (
        <SkeletonText lines={10} />
      ) : (
        /*
         * The editor is a separate component, mounted only once the stored exceptions have
         * arrived and keyed by the person it is editing. Its draft state is therefore initialised
         * from the real values on first render, rather than being written into state by an effect
         * afterwards: synchronising state in an effect renders twice, and shows the previous
         * person's draft for one frame when the dialog is reopened for somebody else.
         */
        <OverridesEditor
          key={staff.id}
          staff={staff}
          stored={data.overrides}
          catalogue={catalogue}
          onDone={() => onOpenChange(false)}
        />
      )}
    </Dialog>
  )
}

interface OverridesEditorProps {
  staff: StaffMember
  stored: StaffOverride[]
  catalogue: CataloguePermission[]
  onDone: () => void
}

function OverridesEditor({ staff, stored, catalogue, onDone }: OverridesEditorProps) {
  const { t } = useTranslation(['staff', 'common'])
  const describeError = useApiError()
  const language = currentLanguage()
  const { data: roles } = useRoles()
  const save = usePutOverrides()

  const [draft, setDraft] = useState<Record<string, Effect>>(() =>
    Object.fromEntries(stored.map((override) => [override.permission, override.effect])),
  )

  const rolePermissions = useMemo(() => {
    const role = roles?.find((entry) => entry.key === staff.roleKey)
    return new Set<string>(role?.permissions ?? [])
  }, [roles, staff.roleKey])

  const grouped = useMemo(() => {
    const byResource = new Map<string, CataloguePermission[]>()
    for (const permission of catalogue) {
      const list = byResource.get(permission.resource) ?? []
      list.push(permission)
      byResource.set(permission.resource, list)
    }
    return [...byResource.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [catalogue])

  const changedCount = useMemo(() => {
    const before = new Map<string, Effect>(
      stored.map((override) => [override.permission, override.effect]),
    )
    const keys = new Set([...before.keys(), ...Object.keys(draft)])
    let changed = 0
    for (const key of keys) {
      if ((before.get(key) ?? 'INHERIT') !== (draft[key] ?? 'INHERIT')) changed += 1
    }
    return changed
  }, [stored, draft])

  async function onSave(): Promise<void> {
    const overrides = Object.entries(draft)
      .filter(([, effect]) => effect !== 'INHERIT')
      .map(([permission, effect]) => ({
        permission: permission as PermissionKey,
        effect: effect as 'GRANT' | 'DENY',
      }))
    await save.mutateAsync({ id: staff.id, overrides })
    onDone()
  }

  const effectOptions = (inherited: boolean) => [
    {
      value: 'INHERIT',
      label: inherited
        ? t('staff:overrides.inheritedAllowed')
        : t('staff:overrides.inheritedDenied'),
    },
    { value: 'GRANT', label: t('staff:overrides.grant') },
    { value: 'DENY', label: t('staff:overrides.deny') },
  ]

  return (
    <div className="flex flex-col gap-5">
      <Alert tone="info">{t('staff:overrides.denyWins')}</Alert>

      {save.isError ? <Alert tone="danger">{describeError(save.error).message}</Alert> : null}

      {grouped.map(([resource, permissions]) => (
        <section key={resource}>
          <h3 className="mb-2 text-sm font-semibold tracking-wider text-ink-muted uppercase">
            {resource}
          </h3>
          <ul className="flex flex-col divide-y divide-line">
            {permissions.map((permission) => {
              const inherited = rolePermissions.has(permission.key)
              const effect = draft[permission.key] ?? 'INHERIT'
              const description =
                language === 'rw' ? permission.descriptionRw : permission.descriptionEn
              return (
                <li
                  key={permission.key}
                  className="flex flex-wrap items-center justify-between gap-3 py-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-base text-ink">{description}</span>
                    <span className="block font-mono text-xs text-ink-muted">{permission.key}</span>
                  </span>
                  <span className="w-56 shrink-0">
                    <label className="sr-only" htmlFor={`effect-${permission.key}`}>
                      {t('staff:overrides.effectFor', { permission: description })}
                    </label>
                    <Select
                      id={`effect-${permission.key}`}
                      options={effectOptions(inherited)}
                      value={effect}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          [permission.key]: event.target.value as Effect,
                        }))
                      }
                    />
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button variant="secondary" onClick={onDone} disabled={save.isPending}>
          {t('common:actions.cancel')}
        </Button>
        <Button
          loading={save.isPending}
          disabled={changedCount === 0}
          onClick={() => void onSave()}
        >
          {t('staff:overrides.save', { count: changedCount })}
        </Button>
      </div>
    </div>
  )
}
