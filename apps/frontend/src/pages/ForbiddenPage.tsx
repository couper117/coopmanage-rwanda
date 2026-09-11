import { ShieldAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Button, EmptyState, Panel } from '@/components/ui'

/**
 * Shown when a signed-in user reaches a screen their role does not cover. It says which permission
 * is missing and who can grant it, because "access denied" with no explanation sends people to
 * the manager with nothing useful to ask for.
 */
export function ForbiddenPage({ permission }: { permission?: string }) {
  const { t } = useTranslation(['errors', 'common'])

  return (
    <Panel flush>
      <EmptyState
        icon={ShieldAlert}
        headingLevel={1}
        title={t('errors:page.forbiddenTitle')}
        description={
          permission
            ? t('errors:page.forbiddenBodyWithPermission', { permission })
            : t('errors:page.forbiddenBody')
        }
        action={
          <Button asChild variant="secondary">
            <Link to="/">{t('errors:page.backToDashboard')}</Link>
          </Button>
        }
      />
    </Panel>
  )
}
