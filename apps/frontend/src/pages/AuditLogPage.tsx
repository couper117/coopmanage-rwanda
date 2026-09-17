import { useInfiniteQuery } from '@tanstack/react-query'
import { ScrollText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AuditEntry } from '@coopmanage/shared'
import { PageHeader } from '@/components/PageHeader'
import { LoadError } from '@/components/LoadError'
import { Button, EmptyState, Panel, SkeletonText } from '@/components/ui'
import { fetchAuditPage } from '@/features/audit/audit.api'
import { useAuthStore } from '@/stores/authStore'
import { toI18nKey, translateParams } from '@/lib/messageKey'

/**
 * Who did what, when. Read only by design: the trail is append-only in the database, and the
 * interface offers no way to edit or remove an entry because there is none.
 */
export function AuditLogPage() {
  const { t, i18n } = useTranslation(['audit', 'common'])
  const cooperativeId = useAuthStore((state) => state.activeCooperativeId)

  const query = useInfiniteQuery({
    queryKey: ['audit', cooperativeId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchAuditPage({}, pageParam),
    getNextPageParam: (lastPage) => lastPage.meta?.nextCursor ?? undefined,
  })

  const entries = query.data?.pages.flatMap((page) => page.items) ?? []

  return (
    <>
      <PageHeader title={t('audit:title')} description={t('audit:description')} />

      {query.isError ? <LoadError error={query.error} onRetry={query.refetch} /> : null}

      <Panel flush>
        {query.isPending ? (
          <div className="p-4">
            <SkeletonText lines={6} />
          </div>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title={t('audit:empty.title')}
            description={t('audit:empty.body')}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] border-collapse text-left">
              <caption className="sr-only">{t('audit:tableCaption')}</caption>
              <thead>
                <tr className="border-b border-line bg-surface-sunken">
                  <Th>{t('audit:columns.when')}</Th>
                  <Th>{t('audit:columns.who')}</Th>
                  <Th>{t('audit:columns.what')}</Th>
                  <Th>{t('audit:columns.record')}</Th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <Row key={entry.id} entry={entry} language={i18n.resolvedLanguage ?? 'en'} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {query.hasNextPage ? (
          <div className="border-t border-line p-3 text-center">
            <Button
              variant="secondary"
              size="sm"
              loading={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {t('audit:loadMore')}
            </Button>
          </div>
        ) : null}
      </Panel>
    </>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className="px-4 py-2 text-xs font-semibold tracking-wide text-ink-secondary uppercase"
    >
      {children}
    </th>
  )
}

function Row({ entry, language }: { entry: AuditEntry; language: string }) {
  const { t } = useTranslation('audit')

  const when = new Intl.DateTimeFormat(language === 'rw' ? 'en-RW' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(entry.createdAt))

  return (
    <tr className="border-b border-line last:border-b-0">
      <td className="px-4 py-2 align-top text-sm whitespace-nowrap text-ink-muted">{when}</td>
      <td className="px-4 py-2 align-top text-base text-ink">{entry.actorLabel}</td>
      <td className="px-4 py-2 align-top text-base text-ink">
        {/*
          The server sends a translation key and its parameters rather than a finished sentence, so
          the same entry reads correctly in whichever language it is opened in. An action the
          interface does not yet have wording for falls back to the raw action name rather than
          rendering an empty cell.
        */}
        {t(toI18nKey(entry.messageKey), {
          ...translateParams(entry.messageParams, (key) => t(key)),
          defaultValue: entry.action,
        })}
      </td>
      <td className="px-4 py-2 align-top text-sm text-ink-muted">{entry.entityType}</td>
    </tr>
  )
}
