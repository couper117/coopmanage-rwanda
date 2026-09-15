import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Alert,
  Button,
  Dialog,
  FormField,
  Input,
  Select,
  Textarea,
  type SelectOption,
} from '@/components/ui'
import { MEETING_TYPES, type MeetingDetail, type MeetingType } from './meetings.api'
import {
  fromLocalInputValue,
  toLocalInputValue,
  useCreateMeeting,
  useMeetingsError,
  useUpdateMeeting,
} from './meetings.hooks'

/**
 * Scheduling a meeting, or changing one that has not happened yet.
 *
 * The time is a `datetime-local` input, so what a secretary types is the time in the room. It is
 * converted to a moment in UTC on the way out and back again on the way in, because a general
 * assembly is called for two in the afternoon in Musanze and that has to mean the same instant
 * whatever machine reads it afterwards.
 *
 * The quorum field is deliberately empty by default. Inventing a number would be worse than having
 * none: the report says "not required" for a meeting with no quorum and "not met" for one that
 * missed it, and those are different findings at an audit.
 */
export function MeetingDialog({
  open,
  onOpenChange,
  meeting,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Null schedules a new meeting; a meeting edits it. */
  meeting: MeetingDetail | null
  onDone: (notice: string) => void
}) {
  const { t } = useTranslation(['meetings', 'common'])
  const describeError = useMeetingsError()
  const create = useCreateMeeting()
  const update = useUpdateMeeting()
  const pending = create.isPending || update.isPending

  /**
   * Nine in the morning a week from today, which is when a Rwandan cooperative's assembly is
   * usually called. A default the secretary edits beats an empty field they have to fill.
   */
  function suggestedTime(): string {
    const suggested = new Date()
    suggested.setDate(suggested.getDate() + 7)
    suggested.setHours(9, 0, 0, 0)
    return toLocalInputValue(suggested.toISOString())
  }

  // Initial state rather than a reset effect: the page mounts this only while it is open, so
  // opening it is a fresh mount and the fields already start from the meeting being edited.
  const [title, setTitle] = useState(meeting?.title ?? '')
  const [type, setType] = useState<MeetingType>(meeting?.type ?? 'GENERAL_ASSEMBLY')
  const [scheduledFor, setScheduledFor] = useState(
    meeting ? toLocalInputValue(meeting.scheduledFor) : suggestedTime(),
  )
  const [endsAt, setEndsAt] = useState(meeting?.endsAt ? toLocalInputValue(meeting.endsAt) : '')
  const [location, setLocation] = useState(meeting?.location ?? '')
  const [quorum, setQuorum] = useState(
    meeting?.quorumRequired === null || meeting?.quorumRequired === undefined
      ? ''
      : String(meeting.quorumRequired),
  )
  const [notes, setNotes] = useState(meeting?.notes ?? '')

  const typeOptions: SelectOption[] = MEETING_TYPES.map((value) => ({
    value,
    label: t(`meetings:type.${value}`),
  }))

  function submit(): void {
    const body = {
      title: title.trim(),
      type,
      scheduledFor: fromLocalInputValue(scheduledFor),
      endsAt: endsAt ? fromLocalInputValue(endsAt) : null,
      location: location.trim().length > 0 ? location.trim() : null,
      quorumRequired: quorum.trim().length > 0 ? Number(quorum) : null,
      notes: notes.trim().length > 0 ? notes.trim() : null,
    }

    if (meeting) {
      update.mutate(
        { id: meeting.id, changes: body },
        {
          onSuccess: () => {
            onDone(t('meetings:notice.updated'))
            onOpenChange(false)
          },
        },
      )
      return
    }

    create.mutate(body, {
      onSuccess: (created) => {
        onDone(t('meetings:notice.scheduled', { reference: created.reference }))
        onOpenChange(false)
      },
    })
  }

  const error = create.isError ? create.error : update.isError ? update.error : null

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={meeting ? t('meetings:form.editTitle') : t('meetings:form.scheduleTitle')}
      busy={pending}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            onClick={submit}
            disabled={pending || title.trim().length === 0 || scheduledFor.length === 0}
          >
            {pending ? t('meetings:form.saving') : t('meetings:form.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? <Alert tone="danger">{describeError(error).message}</Alert> : null}

        <FormField label={t('meetings:form.titleLabel')}>
          <Input
            value={title}
            placeholder={t('meetings:form.titlePlaceholder')}
            onChange={(event) => setTitle(event.target.value)}
          />
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('meetings:form.type')}>
            <Select
              value={type}
              options={typeOptions}
              onChange={(event) => setType(event.target.value as MeetingType)}
            />
          </FormField>
          <FormField label={t('meetings:form.location')} optional>
            <Input
              value={location}
              placeholder={t('meetings:form.locationPlaceholder')}
              onChange={(event) => setLocation(event.target.value)}
            />
          </FormField>
          <FormField label={t('meetings:form.scheduledFor')}>
            <Input
              type="datetime-local"
              value={scheduledFor}
              onChange={(event) => setScheduledFor(event.target.value)}
            />
          </FormField>
          <FormField label={t('meetings:form.endsAt')} optional>
            <Input
              type="datetime-local"
              value={endsAt}
              onChange={(event) => setEndsAt(event.target.value)}
            />
          </FormField>
        </div>

        <FormField
          label={t('meetings:form.quorumRequired')}
          hint={t('meetings:form.quorumHint')}
          optional
        >
          <Input
            type="number"
            min={1}
            value={quorum}
            onChange={(event) => setQuorum(event.target.value)}
          />
        </FormField>

        <FormField label={t('meetings:form.notes')} optional>
          <Textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </FormField>
      </div>
    </Dialog>
  )
}
