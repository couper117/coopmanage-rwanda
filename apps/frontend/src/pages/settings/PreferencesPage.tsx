import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CORE_MODULES, OPTIONAL_MODULES, type OptionalModule } from '@coopmanage/shared'
import { PageHeader } from '@/components/PageHeader'
import { Alert, Badge, Button, Panel, SkeletonText, Switch } from '@/components/ui'
import { usePermission } from '@/features/auth/useSession'
import {
  useCooperativeSettings,
  useSaveCooperativeSetting,
} from '@/features/cooperative/cooperative.hooks'
import { useApiError } from '@/hooks/useApiErrorMessage'

/**
 * Which modules this cooperative uses.
 *
 * This is the "configurable modules" requirement, and it is configuration rather than a fork: a
 * transport cooperative switches Inventory off and stops navigating past it, while running exactly
 * the same code as a dairy cooperative that keeps it on.
 *
 * Switching a module off hides it. It never deletes anything, and it never weakens a permission
 * check: the backend still enforces every one, and turning a module back on shows the records that
 * were always there.
 */
export function PreferencesPage() {
  const { t } = useTranslation(['settings', 'nav', 'common'])
  const describeError = useApiError()
  const canEdit = usePermission('settings:manage')
  const { data: settings, isPending, isError, refetch } = useCooperativeSettings()
  const save = useSaveCooperativeSetting()
  const [justSaved, setJustSaved] = useState<OptionalModule | null>(null)

  function toggle(module: OptionalModule, enabled: boolean): void {
    if (!settings) return
    const next = enabled
      ? [...settings.enabledModules, module]
      : settings.enabledModules.filter((entry) => entry !== module)

    setJustSaved(null)
    save.mutate({ key: 'enabledModules', value: next }, { onSuccess: () => setJustSaved(module) })
  }

  if (isPending) {
    return (
      <>
        <PageHeader title={t('settings:preferences.title')} />
        <Panel>
          <SkeletonText lines={6} />
        </Panel>
      </>
    )
  }

  if (isError || !settings) {
    return (
      <>
        <PageHeader title={t('settings:preferences.title')} />
        <Alert
          tone="danger"
          title={t('settings:preferences.loadFailed')}
          action={
            <Button variant="secondary" size="sm" onClick={() => void refetch()}>
              {t('common:actions.retry')}
            </Button>
          }
        />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title={t('settings:preferences.title')}
        description={t('settings:preferences.description')}
      />

      <Panel
        title={t('settings:preferences.modulesTitle')}
        description={t('settings:preferences.modulesDescription')}
      >
        {!canEdit ? (
          <Alert tone="info" className="mb-4">
            {t('settings:preferences.readOnly')}
          </Alert>
        ) : null}

        {save.isError ? (
          <Alert tone="danger" className="mb-4">
            {describeError(save.error).message}
          </Alert>
        ) : null}

        <div className="flex flex-col divide-y divide-line">
          {OPTIONAL_MODULES.map((module) => (
            <div key={module} className="flex items-center justify-between gap-3 py-1">
              <Switch
                label={t(`nav:items.${module}`)}
                description={t(`settings:preferences.modules.${module}`)}
                checked={settings.enabledModules.includes(module)}
                disabled={!canEdit || save.isPending}
                onCheckedChange={(enabled) => toggle(module, enabled)}
              />
              {justSaved === module && !save.isPending ? (
                <span role="status" className="shrink-0 text-sm text-success-fg">
                  {t('settings:preferences.saved')}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        title={t('settings:preferences.alwaysOnTitle')}
        description={t('settings:preferences.alwaysOnDescription')}
      >
        <ul className="flex flex-wrap gap-2">
          {CORE_MODULES.map((module) => (
            <li key={module}>
              <Badge tone="neutral">{t(`nav:items.${module}`)}</Badge>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  )
}
