import { FileQuestion } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Button, EmptyState, Panel } from '@/components/ui'

/**
 * The empty state is the page here, so it carries the h1 itself. Adding a page header above it
 * would print the same sentence twice and give the screen two competing headings.
 */
export function NotFoundPage() {
  const { t } = useTranslation('errors')

  return (
    <Panel flush>
      <EmptyState
        headingLevel={1}
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
