import { Info } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Button, Dialog, Skeleton, Switch } from '@/components/ui'
import type { AnnouncementRow, SendResult } from './announcements.api'
import {
  useAnnouncementError,
  useAudiencePreview,
  usePublishAnnouncement,
} from './announcements.hooks'

/**
 * The one screen in this product that spends a cooperative's money, so it tells the truth first.
 *
 * Three things are on it before the button, and none of them is optional.
 *
 * **How many members can be reached, and how many cannot.** A phone number is never required of a
 * member, so a cooperative of 120 may only be able to text 78. The remaining 42 have to be told by
 * the people who see them, and that is a decision for the committee — the software must not hide
 * the number and let them believe everyone was told.
 *
 * **What it costs.** Segments per message, and the total. The 161st character doubles the bill.
 *
 * **Whether anything will actually be delivered.** While the mock provider is live, messages are
 * recorded and not sent, and this says so plainly. A dialog that reported "78 sent" from a provider
 * that delivers nothing would be the most damaging screen in the application.
 */
export function PublishAnnouncementDialog({
  announcement,
  onOpenChange,
  onDone,
}: {
  announcement: AnnouncementRow
  onOpenChange: (open: boolean) => void
  onDone: (notice: string) => void
}) {
  const { t } = useTranslation(['announcements', 'common'])
  const describeError = useAnnouncementError()
  const publish = usePublishAnnouncement()
  const preview = useAudiencePreview(announcement.id, true)

  const isStaffOnly = announcement.audience === 'STAFF'
  const [sendSms, setSendSms] = useState(false)
  const [result, setResult] = useState<SendResult | null>(null)

  const audience = preview.data

  function submit(): void {
    publish.mutate(
      { id: announcement.id, sendSms: sendSms && !isStaffOnly },
      {
        onSuccess: (data) => {
          if (data.sms) {
            // Stay open and report what happened per recipient. Closing on a partial send would
            // hide the one member who was not reached.
            setResult(data.sms)
            return
          }
          onDone(t('announcements:notice.published', { title: announcement.title }))
          onOpenChange(false)
        },
      },
    )
  }

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={t('announcements:publish.title')}
      description={t('announcements:publish.body')}
      busy={publish.isPending}
      footer={
        result ? (
          <Button onClick={() => onOpenChange(false)}>{t('common:actions.close')}</Button>
        ) : (
          <>
            <Button
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={publish.isPending}
            >
              {t('common:actions.cancel')}
            </Button>
            <Button onClick={submit} loading={publish.isPending}>
              {sendSms && !isStaffOnly
                ? t('announcements:publish.confirmAndSend')
                : t('announcements:publish.confirm')}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {publish.isError ? (
          <Alert tone="danger">{describeError(publish.error).message}</Alert>
        ) : null}

        {result ? (
          <SendReport result={result} />
        ) : (
          <>
            <p className="text-base text-ink">{announcement.title}</p>

            {isStaffOnly ? (
              <Alert tone="info">{t('announcements:publish.staffOnly')}</Alert>
            ) : preview.isPending ? (
              <Skeleton className="h-24 w-full" />
            ) : audience ? (
              <>
                <dl className="grid grid-cols-2 gap-3 rounded-lg border border-line bg-surface-subtle p-3 text-sm">
                  <div>
                    <dt className="text-ink-muted">{t('announcements:publish.members')}</dt>
                    <dd className="mt-0.5 text-lg font-semibold tabular-nums text-ink">
                      {audience.total}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted">{t('announcements:publish.reachable')}</dt>
                    <dd className="mt-0.5 text-lg font-semibold tabular-nums text-ink">
                      {audience.withPhone}
                    </dd>
                  </div>
                </dl>

                {audience.withoutPhone > 0 ? (
                  <Alert tone="warning">
                    {t('announcements:publish.withoutPhone', { count: audience.withoutPhone })}
                  </Alert>
                ) : null}

                <p className="flex items-start gap-2 text-sm text-ink-secondary">
                  <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  <span>
                    {t('announcements:publish.cost', {
                      count: audience.segments,
                      messages: audience.withPhone * audience.segments,
                    })}
                    {audience.unicode ? ` ${t('announcements:publish.unicode')}` : ''}
                  </span>
                </p>

                {!audience.delivers ? (
                  <Alert tone="warning" title={t('announcements:publish.mockTitle')}>
                    {t('announcements:publish.mockBody')}
                  </Alert>
                ) : null}

                <Switch
                  checked={sendSms}
                  onCheckedChange={setSendSms}
                  label={t('announcements:publish.sendSms')}
                  description={t('announcements:publish.sendSmsHint')}
                />
              </>
            ) : null}
          </>
        )}
      </div>
    </Dialog>
  )
}

/** What happened, per recipient. The failures are the part worth reading. */
function SendReport({ result }: { result: SendResult }) {
  const { t } = useTranslation('announcements')

  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-ink-muted">{t('publish.report.sent')}</dt>
          <dd className="mt-0.5 text-lg font-semibold tabular-nums text-success-fg">
            {result.sent}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">{t('publish.report.failed')}</dt>
          <dd
            className={
              result.failed > 0
                ? 'mt-0.5 text-lg font-semibold tabular-nums text-danger-fg'
                : 'mt-0.5 text-lg font-semibold tabular-nums text-ink'
            }
          >
            {result.failed}
          </dd>
        </div>
      </dl>

      {result.failed > 0 ? (
        <Alert tone="danger">{t('publish.report.failedBody', { count: result.failed })}</Alert>
      ) : null}

      {result.alreadySent > 0 ? (
        <p className="text-sm text-ink-muted">
          {t('publish.report.alreadySent', { count: result.alreadySent })}
        </p>
      ) : null}

      {result.withoutPhone > 0 ? (
        <p className="text-sm text-ink-muted">
          {t('publish.report.withoutPhone', { count: result.withoutPhone })}
        </p>
      ) : null}

      {!result.delivered ? (
        <Alert tone="warning" title={t('publish.mockTitle')}>
          {t('publish.report.mockBody')}
        </Alert>
      ) : null}
    </div>
  )
}
