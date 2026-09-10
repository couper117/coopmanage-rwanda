import { FileQuestion } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Button, EmptyState, Panel } from '@/components/ui'

export function NotFoundPage() {
  const { t } = useTranslation('errors')

  return (
    <Panel flush>
      <EmptyState
        icon={FileQuestion}
        title={t('page.notFoundTitle')}
        description={t('page.notFoundBody')}
        action={
          <Button asChild variant="secondary">
            <Link to="/">{t('page.backToDashboard')}</Link>
          </Button>
        }
      />
    </Panel>
  )
}
