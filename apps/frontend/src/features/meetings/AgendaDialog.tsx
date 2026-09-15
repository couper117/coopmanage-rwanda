import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
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
import type { AgendaDraftItem, MeetingDetail } from './meetings.api'
import { useAttendanceOptions, useMeetingsError, usePutAgenda } from './meetings.hooks'

/**
 * Setting the agenda.
 *
 * The whole list is edited here and sent once, which is what the endpoint takes. That is why "move
 * up" and "remove" are instant and free: they are array operations on local state, not requests. A
 * secretary reorders three items, merges two and drops one before saving, and the server sees the
 * list as it should now read rather than a sequence of edits it has to apply in order.
 *
 * Positions are not shown or edited. The order on screen is the order, numbered from one by the
 * server when it saves — a client that had to supply positions is the client that eventually sends
 * two items numbered three.
 */
export function AgendaDialog({
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
  const save = usePutAgenda()
  const options = useAttendanceOptions(open)

  // The meeting's own agenda is where the editing starts. Initial state rather than a reset
  // effect, because the detail page mounts this only while it is open.
  const [items, setItems] = useState<AgendaDraftItem[]>(() =>
    meeting.agenda.map((item) => ({
      title: item.title,
      description: item.description,
      presenterStaffId: item.presenterStaffId,
    })),
  )

  const presenterOptions: SelectOption[] = [
    { value: '', label: t('meetings:agendaForm.noPresenter') },
    ...(options.data?.staff ?? []).map((row) => ({ value: row.id, label: row.name })),
  ]

  function update(index: number, changes: Partial<AgendaDraftItem>): void {
    setItems((current) =>
      current.map((item, position) => (position === index ? { ...item, ...changes } : item)),
    )
  }

  function move(index: number, by: -1 | 1): void {
    setItems((current) => {
      const next = [...current]
      const target = index + by
      if (target < 0 || target >= next.length) return current
      const moved = next[index]
      const displaced = next[target]
      if (!moved || !displaced) return current
      next[index] = displaced
      next[target] = moved
      return next
    })
  }

  function submit(): void {
    save.mutate(
      {
        id: meeting.id,
        items: items
          .filter((item) => item.title.trim().length > 0)
          .map((item) => ({
            title: item.title.trim(),
            description: item.description?.trim() ? item.description.trim() : null,
            presenterStaffId: item.presenterStaffId ?? null,
          })),
      },
      {
        onSuccess: () => {
          onDone(t('meetings:notice.agendaSaved'))
          onOpenChange(false)
        },
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('meetings:agendaForm.title')}
      description={t('meetings:agendaForm.description')}
      width="lg"
      busy={save.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            {save.isPending ? t('meetings:agendaForm.saving') : t('meetings:agendaForm.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {save.isError ? <Alert tone="danger">{describeError(save.error).message}</Alert> : null}

        {items.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('meetings:agendaForm.empty')}</p>
        ) : null}

        {items.map((item, index) => (
          <div key={index} className="flex flex-col gap-3 rounded-md border border-line p-3">
            <div className="flex items-start gap-2">
              <span className="mt-2 w-6 text-sm tabular-nums text-ink-muted">{index + 1}.</span>
              <div className="flex-1">
                <FormField label={t('meetings:agendaForm.itemTitle')}>
                  <Input
                    value={item.title}
                    onChange={(event) => update(index, { title: event.target.value })}
                  />
                </FormField>
              </div>
              <div className="mt-6 flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('meetings:agendaForm.moveUp')}
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                >
                  <ChevronUp aria-hidden="true" className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('meetings:agendaForm.moveDown')}
                  onClick={() => move(index, 1)}
                  disabled={index === items.length - 1}
                >
                  <ChevronDown aria-hidden="true" className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('meetings:agendaForm.remove')}
                  onClick={() =>
                    setItems((current) => current.filter((_, position) => position !== index))
                  }
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                </Button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label={t('meetings:agendaForm.presenter')} optional>
                <Select
                  value={item.presenterStaffId ?? ''}
                  options={presenterOptions}
                  onChange={(event) =>
                    update(index, { presenterStaffId: event.target.value || null })
                  }
                />
              </FormField>
              <FormField label={t('meetings:agendaForm.itemDescription')} optional>
                <Textarea
                  rows={2}
                  value={item.description ?? ''}
                  onChange={(event) => update(index, { description: event.target.value })}
                />
              </FormField>
            </div>
          </div>
        ))}

        <div>
          <Button
            variant="secondary"
            leadingIcon={<Plus aria-hidden="true" className="size-4" />}
            onClick={() =>
              setItems((current) => [
                ...current,
                { title: '', description: null, presenterStaffId: null },
              ])
            }
          >
            {t('meetings:agendaForm.add')}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
