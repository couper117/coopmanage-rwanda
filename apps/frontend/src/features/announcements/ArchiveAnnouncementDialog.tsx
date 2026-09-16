import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Button, Dialog, FormField, Textarea } from '@/components/ui'
import type { AnnouncementRow } from './announcements.api'
import { useAnnouncementError, useArchiveAnnouncement } from './announcements.hooks'

/**
 * Withdrawing an announcement.
 *
 * It stays in the record — a published announcement is part of what the cooperative told its
 * members, which is exactly what a committee is later asked about — so this asks for the reason
 * and keeps it. "Archived" with nothing beside it is an unanswerable question at the next
 * assembly.
 *
 * The dismiss button says what keeping it means rather than "Cancel", because on a screen whose
 * action is itself a kind of cancelling, "Cancel" beside "Archive it" is ambiguous. The pitfall is
 * recorded in `docs/glossary.md` §8.
 */
export function ArchiveAnnouncementDialog({
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
  const archive = useArchiveAnnouncement()

  const [reason, setReason] = useState('')
  const [missing, setMissing] = useState(false)

  function submit(): void {
    const trimmed = reason.trim()
    if (trimmed.length < 3) {
      setMissing(true)
      return
    }
    archive.mutate(
      { id: announcement.id, reason: trimmed },
      {
        onSuccess: () => {
          onDone(t('announcements:notice.archived', { title: announcement.title }))
          onOpenChange(false)
        },
      },
    )
  }

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={t('announcements:archive.title')}
      description={
        announcement.messageCount > 0
          ? t('announcements:archive.bodySent', { count: announcement.messageCount })
          : t('announcements:archive.body')
      }
      busy={archive.isPending}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={archive.isPending}
          >
            {t('announcements:archive.keep')}
          </Button>
          <Button variant="danger" onClick={submit} loading={archive.isPending}>
            {t('announcements:archive.confirm')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {archive.isError ? (
          <Alert tone="danger">{describeError(archive.error).message}</Alert>
        ) : null}

        <FormField
          label={t('announcements:archive.reason')}
          error={missing ? 'validation.required' : undefined}
        >
          <Textarea
            rows={3}
            value={reason}
            placeholder={t('announcements:archive.reasonPlaceholder')}
            onChange={(event) => {
              setReason(event.target.value)
              setMissing(false)
            }}
          />
        </FormField>
      </div>
    </Dialog>
  )
}
