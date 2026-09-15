import { Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Button, Dialog, FormField, Input, Select, type SelectOption } from '@/components/ui'
import {
  ATTENDANCE_STATUSES,
  type AttendanceDraftEntry,
  type AttendanceStatus,
  type MeetingDetail,
} from './meetings.api'
import { useAttendanceOptions, useMeetingsError, usePutAttendance } from './meetings.hooks'

/**
 * Taking attendance.
 *
 * The register is the list. Every member appears with their code and a state, defaulting to
 * absent, and the secretary marks those who came — which is the opposite of a form where names are
 * typed in, and it is what makes the quorum provable: a member who is not in the register cannot
 * be marked present, and a count taken from typed names would prove nothing.
 *
 * The present count is shown live against the quorum, so a secretary can see while taking
 * attendance whether the meeting will be able to decide anything.
 *
 * A search filters the list rather than fetching: a cooperative of a few hundred members is a
 * list the browser can hold, and a request per keystroke over a district office connection would
 * make marking a hall of people slower than doing it on paper.
 */
export function AttendanceDialog({
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
  const save = usePutAttendance()
  const options = useAttendanceOptions(open)

  /**
   * Whatever was recorded before is where this starts, so reopening the dialog after a partial
   * attendance does not lose it. Members with no row default to absent, which is the truthful
   * starting point for a meeting whose attendance has not been taken.
   */
  const [states, setStates] = useState<Record<string, AttendanceStatus>>(() => {
    const existing: Record<string, AttendanceStatus> = {}
    for (const row of meeting.attendees) {
      if (row.memberId) existing[row.memberId] = row.status
    }
    return existing
  })
  const [guests, setGuests] = useState<{ name: string; status: AttendanceStatus }[]>(() =>
    meeting.attendees
      .filter((row) => row.guestName !== null)
      .map((row) => ({ name: row.guestName as string, status: row.status })),
  )
  const [search, setSearch] = useState('')

  const members = useMemo(() => options.data?.members ?? [], [options.data])

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (term.length === 0) return members
    return members.filter(
      (member) =>
        member.name.toLowerCase().includes(term) || member.memberCode.toLowerCase().includes(term),
    )
  }, [members, search])

  /**
   * Members marked present, and members only.
   *
   * The guests are counted separately and never added in here. A quorum is a number of members, so
   * a running total that included the district officer and the accountant would tell a secretary
   * the assembly could decide something when it could not — which is the same defect the server
   * had until the counts were split.
   */
  const presentCount = Object.values(states).filter((status) => status === 'PRESENT').length
  const guestsPresent = guests.filter((guest) => guest.status === 'PRESENT').length

  const statusOptions: SelectOption[] = ATTENDANCE_STATUSES.map((value) => ({
    value,
    label: t(`meetings:attendance.${value}`),
  }))

  function submit(): void {
    const entries: AttendanceDraftEntry[] = [
      ...members
        .filter((member) => states[member.id] !== undefined)
        .map((member) => ({
          memberId: member.id,
          status: states[member.id] as AttendanceStatus,
        })),
      ...guests
        .filter((guest) => guest.name.trim().length > 0)
        .map((guest) => ({ guestName: guest.name.trim(), status: guest.status })),
    ]

    save.mutate(
      { id: meeting.id, entries },
      {
        onSuccess: () => {
          onDone(t('meetings:notice.attendanceSaved'))
          onOpenChange(false)
        },
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('meetings:attendanceForm.title')}
      description={t('meetings:attendanceForm.description')}
      width="lg"
      busy={save.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            {save.isPending
              ? t('meetings:attendanceForm.saving')
              : t('meetings:attendanceForm.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {save.isError ? <Alert tone="danger">{describeError(save.error).message}</Alert> : null}

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-[14rem] flex-1">
            <FormField label={t('meetings:attendanceForm.search')}>
              <Input
                value={search}
                placeholder={t('meetings:attendanceForm.searchPlaceholder')}
                onChange={(event) => setSearch(event.target.value)}
              />
            </FormField>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setStates(Object.fromEntries(members.map((member) => [member.id, 'PRESENT'])))
              }
            >
              {t('meetings:attendanceForm.markAllPresent')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setStates(Object.fromEntries(members.map((member) => [member.id, 'ABSENT'])))
              }
            >
              {t('meetings:attendanceForm.markAllAbsent')}
            </Button>
          </div>
        </div>

        {/*
          The running count against the quorum, while attendance is being taken. Knowing at the
          door that the assembly is two members short is worth far more than knowing afterwards.
        */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-canvas px-3 py-2">
          <p className="text-sm text-ink">
            {t('meetings:attendanceForm.presentCount', {
              present: presentCount,
              total: members.length,
            })}
            {guestsPresent > 0 ? (
              <span className="ml-2 text-ink-muted">
                {t('meetings:attendanceForm.guestsPresent', { count: guestsPresent })}
              </span>
            ) : null}
          </p>
          {meeting.quorumRequired !== null ? (
            <p
              className={
                presentCount >= meeting.quorumRequired
                  ? 'text-sm font-medium text-success-fg'
                  : 'text-sm font-medium text-danger-fg'
              }
            >
              {presentCount >= meeting.quorumRequired
                ? t('meetings:detail.quorumMet')
                : t('meetings:detail.quorumNotMet')}
            </p>
          ) : (
            <p className="text-sm text-ink-muted">{t('meetings:detail.quorumNone')}</p>
          )}
        </div>

        <div className="max-h-[40vh] overflow-y-auto rounded-md border border-line">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{t('meetings:detail.attendanceCaption')}</caption>
            <thead>
              <tr className="border-b border-line bg-canvas text-left">
                <th scope="col" className="px-3 py-2 font-semibold">
                  {t('meetings:list.columns.title')}
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  {t('meetings:list.columns.status')}
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((member) => (
                <tr key={member.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-1.5">
                    <span className="text-ink">{member.name}</span>
                    <span className="block text-xs text-ink-muted">{member.memberCode}</span>
                  </td>
                  <td className="px-3 py-1.5">
                    <Select
                      value={states[member.id] ?? 'ABSENT'}
                      options={statusOptions}
                      aria-label={member.name}
                      onChange={(event) =>
                        setStates((current) => ({
                          ...current,
                          [member.id]: event.target.value as AttendanceStatus,
                        }))
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-ink">{t('meetings:attendanceForm.guests')}</h3>
          {guests.map((guest, index) => (
            <div key={index} className="flex items-end gap-2">
              <div className="flex-1">
                <FormField label={t('meetings:attendanceForm.guestName')}>
                  <Input
                    value={guest.name}
                    onChange={(event) =>
                      setGuests((current) =>
                        current.map((row, position) =>
                          position === index ? { ...row, name: event.target.value } : row,
                        ),
                      )
                    }
                  />
                </FormField>
              </div>
              <Button
                variant="ghost"
                size="sm"
                aria-label={t('meetings:attendanceForm.removeGuest')}
                onClick={() =>
                  setGuests((current) => current.filter((_, position) => position !== index))
                }
              >
                <Trash2 aria-hidden="true" className="size-4" />
              </Button>
            </div>
          ))}
          <div>
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Plus aria-hidden="true" className="size-4" />}
              onClick={() => setGuests((current) => [...current, { name: '', status: 'PRESENT' }])}
            >
              {t('meetings:attendanceForm.addGuest')}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  )
}
