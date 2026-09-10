import { LayoutDashboard } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState, Panel } from '@/components/ui'

/**
 * A new cooperative has no figures yet, and this is what it correctly shows on day one. Phase 10
 * fills the page with KPIs, activity and the attention list once the data exists to build them
 * from; the empty state stays as the genuine first-run experience.
 */
export function DashboardPage() {
  const { t } = useTranslation('dashboard')

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <Panel flush>
        <EmptyState icon={LayoutDashboard} title={t('empty.title')} description={t('empty.body')} />
      </Panel>
    </>
  )
}
