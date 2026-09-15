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
import { DECISION_TYPES, type DecisionType, type MeetingDetail } from './meetings.api'
import { useAttendanceOptions, useCreateDecision, useMeetingsError } from './meetings.hooks'

/**
 * Recording a decision.
 *
 * The dialog says plainly that what is typed here cannot be edited afterwards, because it cannot:
 * the update endpoint accepts only the follow-up — done, who is responsible, by when — and refuses
 * a new title or a new vote count. Minutes that could be rewritten would be worth nothing, and a
 * form that let somebody discover that rule by being refused would be worse than one that says it
 * up front.
 *
 * The three vote counts are optional together. A committee that reached a decision by consensus
 * took no vote, and writing 0/0/0 for that would claim something untrue.
 */
export function DecisionDialog({
  open,
  onOpenChange,
  meeting,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  meeting: MeetingDetail
  onDone: (notice: string) => void
}) {
  const { t } = useTranslation(['meetings', 'common'])
  const describeError = useMeetingsError()
  const create = useCreateDecision()
  const options = useAttendanceOptions(open)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [decisionType, setDecisionType] = useState<DecisionType>('RESOLUTION')
  const [agendaItemId, setAgendaItemId] = useState('')
  const [votesFor, setVotesFor] = useState('')
  const [votesAgainst, setVotesAgainst] = useState('')
  const [abstentions, setAbstentions] = useState('')
  const [dueOn, setDueOn] = useState('')
  const [responsible, setResponsible] = useState('')

  const typeOptions: SelectOption[] = DECISION_TYPES.map((value) => ({
    value,
    label: t(`meetings:decisionType.${value}`),
  }))
  const agendaOptions: SelectOption[] = [
    { value: '', label: t('meetings:decisionForm.noAgendaItem') },
    ...meeting.agenda.map((item) => ({
      value: item.id,
      label: `${item.position}. ${item.title}`,
    })),
  ]
  const staffOptions: SelectOption[] = [
    { value: '', label: t('meetings:decisionForm.noResponsible') },
    ...(options.data?.staff ?? []).map((row) => ({ value: row.id, label: row.name })),
  ]

  const numberOrNull = (value: string): number | null =>
    value.trim().length > 0 ? Number(value) : null

  function submit(): void {
    create.mutate(
      {
        id: meeting.id,
        decision: {
          title: title.trim(),
          description: description.trim().length > 0 ? description.trim() : null,
          decisionType,
          agendaItemId: agendaItemId || null,
          votesFor: numberOrNull(votesFor),
          votesAgainst: numberOrNull(votesAgainst),
          abstentions: numberOrNull(abstentions),
          dueOn: dueOn || null,
          responsibleStaffId: responsible || null,
        },
      },
      {
        onSuccess: () => {
          onDone(t('meetings:notice.decisionRecorded'))
          onOpenChange(false)
        },
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('meetings:decisionForm.title')}
      description={t('meetings:decisionForm.description')}
      busy={create.isPending}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={create.isPending}
          >
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={submit} disabled={create.isPending || title.trim().length === 0}>
            {create.isPending ? t('meetings:decisionForm.saving') : t('meetings:decisionForm.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {create.isError ? <Alert tone="danger">{describeError(create.error).message}</Alert> : null}

        <FormField label={t('meetings:decisionForm.titleLabel')}>
          <Input
            value={title}
            placeholder={t('meetings:decisionForm.titlePlaceholder')}
            onChange={(event) => setTitle(event.target.value)}
          />
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('meetings:decisionForm.kind')}>
            <Select
              value={decisionType}
              options={typeOptions}
              onChange={(event) => setDecisionType(event.target.value as DecisionType)}
            />
          </FormField>
          <FormField label={t('meetings:decisionForm.agendaItem')} optional>
            <Select
              value={agendaItemId}
              options={agendaOptions}
              onChange={(event) => setAgendaItemId(event.target.value)}
            />
          </FormField>
        </div>

        <FormField label={t('meetings:decisionForm.descriptionLabel')} optional>
          <Textarea
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </FormField>

        <fieldset className="grid gap-3 sm:grid-cols-3">
          <legend className="mb-1 text-sm text-ink-muted">
            {t('meetings:decisionForm.votesHint')}
          </legend>
          <FormField label={t('meetings:decisionForm.votesFor')} optional>
            <Input
              type="number"
              min={0}
              value={votesFor}
              onChange={(event) => setVotesFor(event.target.value)}
            />
          </FormField>
          <FormField label={t('meetings:decisionForm.votesAgainst')} optional>
            <Input
              type="number"
              min={0}
              value={votesAgainst}
              onChange={(event) => setVotesAgainst(event.target.value)}
            />
          </FormField>
          <FormField label={t('meetings:decisionForm.abstentions')} optional>
            <Input
              type="number"
              min={0}
              value={abstentions}
              onChange={(event) => setAbstentions(event.target.value)}
            />
          </FormField>
        </fieldset>

        {/* An action has somebody responsible and a date. A resolution usually has neither, which
            is why both are optional rather than shown only for one kind. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('meetings:decisionForm.dueOn')} optional>
            <Input type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} />
          </FormField>
          <FormField label={t('meetings:decisionForm.responsible')} optional>
            <Select
              value={responsible}
              options={staffOptions}
              onChange={(event) => setResponsible(event.target.value)}
            />
          </FormField>
        </div>
      </div>
    </Dialog>
  )
}
