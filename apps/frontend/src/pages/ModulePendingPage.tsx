import { Construction } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { PageHeader } from '@/components/PageHeader'
import { Button, EmptyState, Panel } from '@/components/ui'

export interface ModulePendingPageProps {
  /** Key into the `nav` namespace, so the module name is translated. */
  moduleKey: string
  phase: number
}

/**
 * A truthful status screen for a route whose module has not been built yet. It states which phase
 * delivers it rather than showing a mocked-up interface, and each one is deleted by the phase that
 * replaces it.
 */
export function ModulePendingPage({ moduleKey, phase }: ModulePendingPageProps) {
  const { t } = useTranslation(['modules', 'nav'])
  const moduleName = t(`nav:items.${moduleKey}`)

  return (
    <>
      <PageHeader title={moduleName} />
      <Panel flush>
        <EmptyState
          icon={Construction}
          title={t('modules:pending.title', { module: moduleName })}
          description={t('modules:pending.body', { phase })}
          action={
            <Button asChild variant="secondary">
              <Link to="/">{t('modules:pending.backToDashboard')}</Link>
            </Button>
          }
        />
      </Panel>
    </>
  )
}
