import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Button, Dialog, FormField, Input, Select, Textarea } from '@/components/ui'
import { smsSegments } from '@coopmanage/shared'
import {
  ANNOUNCEMENT_AUDIENCES,
  type AnnouncementAudience,
  type AnnouncementRow,
} from './announcements.api'
import {
  useAnnouncementError,
  useCreateAnnouncement,
  useUpdateAnnouncement,
} from './announcements.hooks'

/**
 * Writing or correcting a draft.
 *
 * Two things this form does that a plain text field would not.
 *
 * **It counts the cost as you type.** An announcement is carried by SMS and billed per segment, so
 * the 161st character doubles the price of reaching five hundred members. The count is beside the
 * field, not in a warning after the fact, and it counts the Kinyarwanda text where there is one
 * because that is what most members will actually receive.
 *
 * **It asks for both languages and insists on neither.** A cooperative writing to its members
 * writes in Kinyarwanda; a district office reading the same notice may want the English. Being
 * made to write twice to send one sentence would mean nobody writes at all, so the second pair is
 * optional and clearly marked.
 */
export function AnnouncementDialog({
  announcement,
  onOpenChange,
  onDone,
}: {
  /** Null to write a new one. An existing row is edited, and only while it is a draft. */
  announcement: AnnouncementRow | null
  onOpenChange: (open: boolean) => void
  onDone: (notice: string) => void
}) {
  const { t } = useTranslation(['announcements', 'common'])
  const describeError = useAnnouncementError()
  const create = useCreateAnnouncement()
  const update = useUpdateAnnouncement()

  // Mounted only while open, so the fields start from the row on every open with no reset effect.
  const [title, setTitle] = useState(announcement?.title ?? '')
  const [titleRw, setTitleRw] = useState(announcement?.titleRw ?? '')
  const [body, setBody] = useState(announcement?.body ?? '')
  const [bodyRw, setBodyRw] = useState(announcement?.bodyRw ?? '')
  const [audience, setAudience] = useState<AnnouncementAudience>(
    announcement?.audience ?? 'ACTIVE_MEMBERS',
  )
  const [showErrors, setShowErrors] = useState(false)

  const pending = create.isPending || update.isPending
  const error = create.error ?? update.error

  // The text members receive is the Kinyarwanda one where the cooperative wrote it.
  const carried = bodyRw.trim().length > 0 ? bodyRw : body
  const segments = smsSegments(carried)

  const titleMissing = title.trim().length < 3
  const bodyMissing = body.trim().length < 3

  function submit(): void {
    if (titleMissing || bodyMissing) {
      setShowErrors(true)
      return
    }

    const input = {
      title: title.trim(),
      titleRw: titleRw.trim().length > 0 ? titleRw.trim() : null,
      body: body.trim(),
      bodyRw: bodyRw.trim().length > 0 ? bodyRw.trim() : null,
      audience,
    }

    if (announcement) {
      update.mutate(
        { id: announcement.id, changes: input },
        {
          onSuccess: () => {
            onDone(t('announcements:notice.saved', { title: input.title }))
            onOpenChange(false)
          },
        },
      )
      return
    }

    create.mutate(input, {
      onSuccess: () => {
        onDone(t('announcements:notice.drafted', { title: input.title }))
        onOpenChange(false)
      },
    })
  }

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      width="lg"
      title={announcement ? t('announcements:form.editTitle') : t('announcements:form.addTitle')}
      description={
        announcement
          ? t('announcements:form.editDescription')
          : t('announcements:form.addDescription')
      }
      busy={pending}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={submit} loading={pending}>
            {t('announcements:form.submit')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? <Alert tone="danger">{describeError(error).message}</Alert> : null}

        <FormField
          label={t('announcements:fields.audience')}
          hint={t('announcements:fields.audienceHint')}
        >
          <Select
            value={audience}
            onChange={(event) => setAudience(event.target.value as AnnouncementAudience)}
            options={ANNOUNCEMENT_AUDIENCES.map((value) => ({
              value,
              label: t(`announcements:audience.${value}`),
            }))}
          />
        </FormField>

        <FormField
          label={t('announcements:fields.title')}
          error={showErrors && titleMissing ? 'validation.required' : undefined}
        >
          <Input
            value={title}
            onChange={(event) => {
              setTitle(event.target.value)
              setShowErrors(false)
            }}
          />
        </FormField>

        <FormField
          label={t('announcements:fields.body')}
          hint={t('announcements:fields.bodyHint')}
          error={showErrors && bodyMissing ? 'validation.required' : undefined}
        >
          <Textarea
            rows={4}
            value={body}
            onChange={(event) => {
              setBody(event.target.value)
              setShowErrors(false)
            }}
          />
        </FormField>

        <FormField label={t('announcements:fields.titleRw')} optional>
          <Input value={titleRw} onChange={(event) => setTitleRw(event.target.value)} />
        </FormField>

        <FormField
          label={t('announcements:fields.bodyRw')}
          hint={t('announcements:fields.bodyRwHint')}
          optional
        >
          <Textarea rows={4} value={bodyRw} onChange={(event) => setBodyRw(event.target.value)} />
        </FormField>

        {/*
          The cost, as it is typed. Every character past the 160th doubles what reaching five
          hundred members costs, and a cooperative should see that before it sends rather than on
          an invoice afterwards.
        */}
        <p className="text-sm text-ink-muted">
          {t('announcements:form.cost', { characters: carried.trim().length, count: segments })}
        </p>
      </div>
    </Dialog>
  )
}
