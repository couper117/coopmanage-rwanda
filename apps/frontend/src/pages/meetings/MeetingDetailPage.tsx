import {
  ArrowLeft,
  CheckCircle2,
  FileText,
  ListOrdered,
  Paperclip,
  Pencil,
  Play,
  Printer,
  Users,
  XCircle,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { PageHeader } from '@/components/PageHeader'
import { LoadError } from '@/components/LoadError'
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  FormField,
  Panel,
  Select,
  Skeleton,
  Textarea,
  type BadgeTone,
  type SelectOption,
} from '@/components/ui'
import { usePermission } from '@/features/auth/useSession'
import { EMPTY_DOCUMENT_FILTERS, type DocumentRow } from '@/features/documents/documents.api'
import { useDocumentsList } from '@/features/documents/documents.hooks'
import { AgendaDialog } from '@/features/meetings/AgendaDialog'
import { AttendanceDialog } from '@/features/meetings/AttendanceDialog'
import { DecisionDialog } from '@/features/meetings/DecisionDialog'
import { MeetingDialog } from '@/features/meetings/MeetingDialog'
import { isClosed, type DecisionStatus, type MeetingStatus } from '@/features/meetings/meetings.api'
import {
  useFormatMeetingDate,
  useFormatMeetingTime,
  useMeeting,
  useMeetingsError,
  useSetMeetingStatus,
  useUpdateDecision,
  useUpdateMeeting,
} from '@/features/meetings/meetings.hooks'

/**
 * One meeting: its agenda, who was there, what it decided, and the papers filed against it.
 *
 * The screen is arranged in the order the record is made. The details and the quorum first, because
 * whether the meeting could decide anything governs everything below. Then the agenda, then
 * attendance, then the decisions taken under it, then the papers.
 *
 * **A closed meeting shows no editing controls at all**, and says why in a sentence at the top.
 * Hiding the buttons is not the enforcement — the server refuses the request either way — but a
 * screen that offered them and then failed would teach a secretary that the system is unreliable
 * rather than that the record is final. The one control that survives is marking an action done,
 * because an action recorded in March is closed in June.
 *
 * The page prints. A cooperative files the minutes on paper and the print stylesheet strips the
 * shell, so what comes out is the meeting and nothing else.
 */

const STATUS_TONE: Readonly<Record<MeetingStatus, BadgeTone>> = {
  SCHEDULED: 'info',
  IN_PROGRESS: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
}

const DECISION_TONE: Readonly<Record<DecisionStatus, BadgeTone>> = {
  OPEN: 'warning',
  DONE: 'success',
  CANCELLED: 'neutral',
}

export function MeetingDetailPage() {
  const { t } = useTranslation(['meetings', 'documents', 'common'])
  const { id } = useParams<{ id: string }>()
  const describeError = useMeetingsError()
  const formatTime = useFormatMeetingTime()
  const formatDate = useFormatMeetingDate()

  const canManage = usePermission('meetings:manage')
  const canSeeDocuments = usePermission('documents:view')

  const meeting = useMeeting(id)
  const setStatus = useSetMeetingStatus()
  const updateMeeting = useUpdateMeeting()
  const updateDecision = useUpdateDecision()

  const [editing, setEditing] = useState(false)
  const [agendaOpen, setAgendaOpen] = useState(false)
  const [attendanceOpen, setAttendanceOpen] = useState(false)
  const [decisionOpen, setDecisionOpen] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [minutesOpen, setMinutesOpen] = useState(false)
  const [minutesChoice, setMinutesChoice] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  // Only fetched when the attach dialog is open, and only the documents that could be minutes.
  const candidates = useDocumentsList({
    ...EMPTY_DOCUMENT_FILTERS,
    category: 'MEETING_MINUTES',
    pageSize: 50,
  })

  if (meeting.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (meeting.isError || !meeting.data) {
    return (
      <LoadError
        error={meeting.error}
        onRetry={meeting.refetch}
        title={t('meetings:detail.loadFailed')}
      />
    )
  }

  const row = meeting.data
  const closed = isClosed(row.status)
  const editable = canManage && !closed

  const documentOptions: SelectOption[] = [
    { value: '', label: t('meetings:minutesDialog.document') },
    ...(candidates.data?.items ?? [])
      .filter((document: DocumentRow) => !document.isArchived)
      .map((document: DocumentRow) => ({ value: document.id, label: document.title })),
  ]

  function changeStatus(status: MeetingStatus, reason?: string): void {
    setStatus.mutate(
      { id: row.id, status, ...(reason ? { reason } : {}) },
      {
        onSuccess: () => {
          setNotice(t('meetings:notice.statusChanged', { status: t(`meetings:status.${status}`) }))
          setCompleting(false)
          setCancelling(false)
        },
      },
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div data-print="hide">
        <PageHeader
          title={row.title}
          description={`${row.reference} · ${t(`meetings:type.${row.type}`)}`}
          actions={
            <>
              <Button
                variant="secondary"
                asChild
                leadingIcon={<ArrowLeft aria-hidden="true" className="size-4" />}
              >
                <Link to="/meetings">{t('meetings:actions.backToMeetings')}</Link>
              </Button>
              <Button
                variant="secondary"
                leadingIcon={<Printer aria-hidden="true" className="size-4" />}
                onClick={() => window.print()}
              >
                {t('meetings:actions.print')}
              </Button>
              {editable ? (
                <Button
                  variant="secondary"
                  leadingIcon={<Pencil aria-hidden="true" className="size-4" />}
                  onClick={() => setEditing(true)}
                >
                  {t('meetings:actions.edit')}
                </Button>
              ) : null}
              {editable && row.status === 'SCHEDULED' ? (
                <Button
                  variant="secondary"
                  leadingIcon={<Play aria-hidden="true" className="size-4" />}
                  onClick={() => changeStatus('IN_PROGRESS')}
                  disabled={setStatus.isPending}
                >
                  {t('meetings:actions.begin')}
                </Button>
              ) : null}
              {editable ? (
                <>
                  <Button
                    leadingIcon={<CheckCircle2 aria-hidden="true" className="size-4" />}
                    onClick={() => setCompleting(true)}
                  >
                    {t('meetings:actions.complete')}
                  </Button>
                  <Button
                    variant="danger"
                    leadingIcon={<XCircle aria-hidden="true" className="size-4" />}
                    onClick={() => {
                      setCancelReason('')
                      setCancelling(true)
                    }}
                  >
                    {t('meetings:actions.cancel')}
                  </Button>
                </>
              ) : null}
            </>
          }
        />
      </div>

      {notice ? (
        <Alert
          tone="success"
          className="print:hidden"
          action={
            <Button variant="ghost" size="sm" onClick={() => setNotice(null)}>
              {t('common:actions.close')}
            </Button>
          }
        >
          {notice}
        </Alert>
      ) : null}

      {setStatus.isError ? (
        <Alert tone="danger" className="print:hidden">
          {describeError(setStatus.error).message}
        </Alert>
      ) : null}

      {closed ? (
        <Alert tone="info" className="print:hidden">
          {row.status === 'CANCELLED' && row.cancelReason
            ? t('meetings:detail.cancelledBecause', { reason: row.cancelReason })
            : t('meetings:detail.closedNotice')}
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2" title={t('meetings:detail.whenAndWhere')}>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Detail label={t('meetings:form.scheduledFor')} value={formatTime(row.scheduledFor)} />
            <Detail
              label={t('meetings:form.endsAt')}
              value={row.endsAt ? formatTime(row.endsAt) : null}
            />
            <Detail label={t('meetings:form.location')} value={row.location} />
            <div>
              <dt className="text-sm text-ink-muted">{t('meetings:list.columns.status')}</dt>
              <dd className="mt-0.5">
                <Badge tone={STATUS_TONE[row.status]}>{t(`meetings:status.${row.status}`)}</Badge>
                <span className="mt-1 block text-sm text-ink-muted">
                  {t(`meetings:statusMeaning.${row.status}`)}
                </span>
              </dd>
            </div>
            <Detail label={t('meetings:form.notes')} value={row.notes} />
            <Detail
              label={t('meetings:detail.createdBy', { name: '' }).trim()}
              value={row.createdBy}
            />
          </dl>
        </Panel>

        <Panel title={t('meetings:detail.quorum')}>
          <div className="flex flex-col gap-2">
            <p className="text-2xl font-semibold tabular-nums text-ink">{row.presentCount}</p>
            {row.quorumRequired === null ? (
              <p className="text-sm text-ink-muted">{t('meetings:detail.quorumNone')}</p>
            ) : (
              <>
                {/* The members present, not everybody in the room: that is what the quorum is
                    measured against, and showing the larger figure beside a "not met" badge would
                    read as a contradiction. */}
                <p className="text-sm text-ink-muted">
                  {t('meetings:detail.quorumOf', {
                    present: row.memberPresentCount,
                    required: row.quorumRequired,
                  })}
                </p>
                <Badge tone={row.quorumMet ? 'success' : 'danger'}>
                  {row.quorumMet
                    ? t('meetings:detail.quorumMet')
                    : t('meetings:detail.quorumNotMet')}
                </Badge>
              </>
            )}
            {/* Said plainly, and only while the meeting is still open: a meeting short of its
                quorum cannot decide anything, and the secretary needs to know before it does. */}
            {row.quorumMet === false && !closed ? (
              <Alert tone="warning" className="print:hidden">
                {t('meetings:detail.quorumWarning')}
              </Alert>
            ) : null}
          </div>
        </Panel>
      </div>

      <Panel
        title={t('meetings:detail.agendaTitle')}
        actions={
          editable ? (
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<ListOrdered aria-hidden="true" className="size-4" />}
              onClick={() => setAgendaOpen(true)}
            >
              {t('meetings:actions.agenda')}
            </Button>
          ) : null
        }
      >
        {row.agenda.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('meetings:detail.agendaEmpty')}</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {row.agenda.map((item) => (
              <li key={item.id} className="flex gap-3">
                <span className="w-6 text-sm tabular-nums text-ink-muted">{item.position}.</span>
                <div>
                  <p className="font-medium text-ink">{item.title}</p>
                  {item.description ? (
                    <p className="text-sm text-ink-muted">{item.description}</p>
                  ) : null}
                  {item.presenterName ? (
                    <p className="text-sm text-ink-muted">
                      {t('meetings:detail.presenter', { name: item.presenterName })}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <Panel
        title={t('meetings:detail.attendanceTitle')}
        actions={
          editable ? (
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Users aria-hidden="true" className="size-4" />}
              onClick={() => setAttendanceOpen(true)}
            >
              {t('meetings:actions.attendance')}
            </Button>
          ) : null
        }
      >
        {row.attendees.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('meetings:detail.attendanceEmpty')}</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{t('meetings:detail.attendanceCaption')}</caption>
            <thead className="print:table-header-group">
              <tr className="border-b border-line text-left print:border-black">
                <th scope="col" className="py-1.5 pr-3 font-semibold">
                  {t('meetings:list.columns.title')}
                </th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">
                  {t('meetings:list.columns.status')}
                </th>
                <th scope="col" className="py-1.5 font-semibold">
                  {t('meetings:agendaForm.itemDescription')}
                </th>
              </tr>
            </thead>
            <tbody>
              {row.attendees.map((attendee) => (
                <tr
                  key={attendee.id}
                  className="border-b border-line last:border-0 print:border-black"
                >
                  <td className="py-1.5 pr-3">{attendee.name}</td>
                  <td className="py-1.5 pr-3">{t(`meetings:attendance.${attendee.status}`)}</td>
                  <td className="py-1.5 text-ink-muted">{attendee.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel
        title={t('meetings:detail.decisionsTitle')}
        actions={
          editable ? (
            <Button variant="secondary" size="sm" onClick={() => setDecisionOpen(true)}>
              {t('meetings:actions.decision')}
            </Button>
          ) : null
        }
      >
        {row.decisions.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('meetings:detail.decisionsEmpty')}</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {row.decisions.map((decision) => (
              <li key={decision.id} className="border-b border-line pb-3 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-ink">{decision.title}</p>
                    {decision.description ? (
                      <p className="text-sm text-ink-muted">{decision.description}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="neutral">
                      {t(`meetings:decisionType.${decision.decisionType}`)}
                    </Badge>
                    <Badge tone={DECISION_TONE[decision.status]}>
                      {t(`meetings:decisionStatus.${decision.status}`)}
                    </Badge>
                  </div>
                </div>

                <p className="mt-1 text-sm text-ink-muted">
                  {decision.votesFor === null &&
                  decision.votesAgainst === null &&
                  decision.abstentions === null
                    ? t('meetings:detail.noVotes')
                    : t('meetings:detail.votes', {
                        for: decision.votesFor ?? 0,
                        against: decision.votesAgainst ?? 0,
                        abstentions: decision.abstentions ?? 0,
                      })}
                </p>

                {decision.responsibleName ? (
                  <p className="text-sm text-ink-muted">
                    {t('meetings:detail.responsible', { name: decision.responsibleName })}
                  </p>
                ) : null}
                {decision.dueOn ? (
                  <p className="text-sm text-ink-muted">
                    {t('meetings:detail.due', { date: formatDate(decision.dueOn) })}
                  </p>
                ) : null}

                {/*
                  The one control that survives a closed meeting. An action recorded in March is
                  marked done in June, and a record that could not say so would be useless within
                  a year.
                */}
                {canManage && decision.status === 'OPEN' ? (
                  <div className="mt-2 print:hidden">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        updateDecision.mutate(
                          {
                            meetingId: row.id,
                            decisionId: decision.id,
                            changes: { status: 'DONE' },
                          },
                          { onSuccess: () => setNotice(t('meetings:notice.decisionUpdated')) },
                        )
                      }
                      disabled={updateDecision.isPending}
                    >
                      {t('meetings:decisionStatus.DONE')}
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {updateDecision.isError ? (
          <Alert tone="danger" className="mt-3 print:hidden">
            {describeError(updateDecision.error).message}
          </Alert>
        ) : null}
      </Panel>

      <Panel
        title={t('meetings:detail.documentsTitle')}
        actions={
          canManage && canSeeDocuments ? (
            row.minutesDocumentId ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  updateMeeting.mutate(
                    { id: row.id, changes: { minutesDocumentId: null } },
                    { onSuccess: () => setNotice(t('meetings:notice.minutesDetached')) },
                  )
                }
                disabled={updateMeeting.isPending}
              >
                {t('meetings:actions.detachMinutes')}
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<Paperclip aria-hidden="true" className="size-4" />}
                onClick={() => {
                  setMinutesChoice('')
                  setMinutesOpen(true)
                }}
              >
                {t('meetings:actions.attachMinutes')}
              </Button>
            )
          ) : null
        }
      >
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-sm text-ink-muted">{t('meetings:detail.minutes')}</p>
            <p className="mt-0.5 text-sm text-ink">
              {row.minutesTitle ?? (
                <span className="text-ink-muted">{t('meetings:detail.minutesNone')}</span>
              )}
            </p>
          </div>

          {row.documents.length === 0 ? (
            <p className="text-sm text-ink-muted">{t('meetings:detail.documentsEmpty')}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {row.documents.map((document) => (
                <li key={document.id} className="flex items-center gap-2 text-sm">
                  <FileText aria-hidden="true" className="size-4 text-ink-muted" />
                  <span className="text-ink">{document.title}</span>
                  <span className="text-ink-muted">{document.fileName}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>

      <MeetingDialog open={editing} onOpenChange={setEditing} meeting={row} onDone={setNotice} />

      {agendaOpen ? (
        <AgendaDialog
          open={agendaOpen}
          onOpenChange={setAgendaOpen}
          meeting={row}
          onDone={setNotice}
        />
      ) : null}

      {attendanceOpen ? (
        <AttendanceDialog
          open={attendanceOpen}
          onOpenChange={setAttendanceOpen}
          meeting={row}
          onDone={setNotice}
        />
      ) : null}

      {decisionOpen ? (
        <DecisionDialog
          open={decisionOpen}
          onOpenChange={setDecisionOpen}
          meeting={row}
          onDone={setNotice}
        />
      ) : null}

      <ConfirmDialog
        open={completing}
        onOpenChange={setCompleting}
        title={t('meetings:completeDialog.title')}
        consequence={t('meetings:completeDialog.body')}
        confirmLabel={t('meetings:completeDialog.confirm')}
        busy={setStatus.isPending}
        error={setStatus.isError ? describeError(setStatus.error).message : null}
        onConfirm={() => changeStatus('COMPLETED')}
      />

      {/* Cancelling carries a field, so it is a Dialog rather than a ConfirmDialog. The dismiss
          button says what keeping it means: "Cancel" beside "Call it off" would be two opposite
          meanings of the same word. */}
      <Dialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={t('meetings:cancelDialog.title')}
        description={t('meetings:cancelDialog.body')}
        busy={setStatus.isPending}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setCancelling(false)}
              disabled={setStatus.isPending}
            >
              {t('meetings:cancelDialog.keep')}
            </Button>
            <Button
              variant="danger"
              onClick={() => changeStatus('CANCELLED', cancelReason.trim())}
              disabled={setStatus.isPending || cancelReason.trim().length === 0}
            >
              {t('meetings:cancelDialog.confirm')}
            </Button>
          </>
        }
      >
        <FormField label={t('meetings:cancelDialog.reason')}>
          <Textarea
            rows={3}
            value={cancelReason}
            placeholder={t('meetings:cancelDialog.reasonPlaceholder')}
            onChange={(event) => setCancelReason(event.target.value)}
          />
        </FormField>
      </Dialog>

      <Dialog
        open={minutesOpen}
        onOpenChange={setMinutesOpen}
        title={t('meetings:minutesDialog.title')}
        description={t('meetings:minutesDialog.body')}
        busy={updateMeeting.isPending}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setMinutesOpen(false)}
              disabled={updateMeeting.isPending}
            >
              {t('common:actions.cancel')}
            </Button>
            <Button
              onClick={() =>
                updateMeeting.mutate(
                  { id: row.id, changes: { minutesDocumentId: minutesChoice } },
                  {
                    onSuccess: () => {
                      setNotice(t('meetings:notice.minutesAttached'))
                      setMinutesOpen(false)
                    },
                  },
                )
              }
              disabled={updateMeeting.isPending || minutesChoice.length === 0}
            >
              {t('meetings:minutesDialog.confirm')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {updateMeeting.isError ? (
            <Alert tone="danger">{describeError(updateMeeting.error).message}</Alert>
          ) : null}

          {documentOptions.length <= 1 ? (
            <p className="text-sm text-ink-muted">{t('meetings:minutesDialog.noDocuments')}</p>
          ) : (
            <FormField label={t('meetings:minutesDialog.document')}>
              <Select
                value={minutesChoice}
                options={documentOptions}
                onChange={(event) => setMinutesChoice(event.target.value)}
              />
            </FormField>
          )}
        </div>
      </Dialog>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string | null }) {
  const { t } = useTranslation('documents')
  return (
    <div>
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">
        {value ?? <span className="text-ink-muted">{t('detail.nothingRecorded')}</span>}
      </dd>
    </div>
  )
}
