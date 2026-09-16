import { AlertTriangle, Bell, CheckCheck, Info, X } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Button, Skeleton } from '@/components/ui'
import { useLazyNamespaces } from '@/hooks/useLazyNamespaces'
import { AUDIT_MESSAGE_NAMESPACES } from '@/i18n'
import { toI18nKey, translateParams } from '@/lib/messageKey'
import { cn } from '@/lib/cn'
import type { NotificationRow, NotificationSeverity } from './notifications.api'
import {
  useDismissNotification,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationSummary,
} from './notifications.hooks'

/**
 * What is waiting, without leaving the screen you are on.
 *
 * The bell shows a count and, on a click, the newest five with the work each one points at. It is
 * deliberately not the notification centre: somebody who has just been told that the fertiliser is
 * below its minimum wants to go to the store screen, not to read a paginated list. The centre is
 * one click further on for the times when reading the list *is* the task.
 *
 * **A notification is a sentence, composed here.** The server sends a key and its parameters, so
 * the same row reads in the reader's language — and an enum inside it, which the server sends as a
 * key of its own, is resolved too. Those strings live in namespaces the shell does not carry, so
 * the bell asks for them when it is opened rather than adding them to every first load.
 *
 * **A plain panel, not a portalled popover.** The same choice `SearchSelect` and the global search
 * box made, for the same two reasons: a portal is where focus handling goes wrong, and on the
 * phones this product is used on a list that escapes its container ends up half off the screen.
 * There is a third reason here — a portalled popper cannot be tested in this environment at all,
 * because its measuring loop never settles under jsdom, and a control nobody can write a test for
 * is a control that quietly breaks.
 */

/**
 * Hoisted, and it matters.
 *
 * `useTranslation` takes this array in its dependencies. Building it inline — `['notifications',
 * ...AUDIT_MESSAGE_NAMESPACES]` in the call — hands react-i18next a new array on every render,
 * which re-runs its effect, which sets state, which renders again: a loop that pins a CPU and
 * never settles. One constant, one identity.
 */
const BELL_NAMESPACES = ['notifications', ...AUDIT_MESSAGE_NAMESPACES]

const SEVERITY_ICON: Readonly<Record<NotificationSeverity, typeof Info>> = {
  INFO: Info,
  WARNING: AlertTriangle,
  CRITICAL: AlertTriangle,
}

const SEVERITY_COLOUR: Readonly<Record<NotificationSeverity, string>> = {
  INFO: 'text-ink-muted',
  WARNING: 'text-warning-fg',
  CRITICAL: 'text-danger-fg',
}

export function NotificationBell() {
  const { t } = useTranslation(['notifications', 'common'])
  const [open, setOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const summary = useNotificationSummary()
  const markAll = useMarkAllNotificationsRead()

  const close = useCallback(() => setOpen(false), [])

  // A click anywhere else closes it, so the panel does not sit over the screen the reader has
  // moved on to.
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent | TouchEvent) {
      if (!wrapper.current?.contains(event.target as Node)) close()
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, close])

  const unread = summary.data?.unread ?? 0
  const label =
    unread > 0 ? t('notifications:bell.withCount', { count: unread }) : t('notifications:bell.none')

  return (
    <div ref={wrapper} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        className="relative rounded-md p-1.5 text-ink-secondary hover:bg-surface-subtle hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
      >
        <Bell aria-hidden="true" className="size-5" strokeWidth={1.75} />
        {unread > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-danger-fg px-1 text-2xs font-semibold text-white"
          >
            {/* Past nine the exact number stops being useful and starts being a wide badge. */}
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          id={panelId}
          className="absolute right-0 top-full z-40 mt-1 w-88 max-w-[calc(100vw-1rem)] overflow-hidden rounded-lg border border-line-strong bg-surface shadow-overlay"
        >
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
            <p className="text-base font-medium text-ink">{t('notifications:title')}</p>
            {unread > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                loading={markAll.isPending}
                leadingIcon={<CheckCheck aria-hidden="true" className="size-4" />}
                onClick={() => markAll.mutate()}
              >
                {t('notifications:actions.readAll')}
              </Button>
            ) : null}
          </div>

          <BellBody summary={summary.data?.latest ?? []} loading={summary.isPending} />

          <div className="border-t border-line px-3 py-2">
            <Link
              to="/notifications"
              onClick={close}
              className="text-sm text-primary-600 hover:underline"
            >
              {t('notifications:actions.seeAll')}
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Mounted only while the bell is open, which is what keeps the audit namespaces out of the first
 * load: a reader who never opens the bell never downloads the strings for it.
 */
function BellBody({ summary, loading }: { summary: NotificationRow[]; loading: boolean }) {
  const { t } = useTranslation(BELL_NAMESPACES)
  const ready = useLazyNamespaces(AUDIT_MESSAGE_NAMESPACES)

  if (loading || !ready) {
    return (
      <div aria-busy="true" className="flex flex-col gap-2 p-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    )
  }

  if (summary.length === 0) {
    return <p className="px-3 py-4 text-sm text-ink-muted">{t('notifications:empty.body')}</p>
  }

  return (
    <ul className="max-h-96 divide-y divide-line overflow-y-auto">
      {summary.map((row) => (
        <NotificationLine key={row.id} row={row} />
      ))}
    </ul>
  )
}

/** One notification: what happened, when, and the screen it is about. */
export function NotificationLine({
  row,
  showDismiss = true,
}: {
  row: NotificationRow
  showDismiss?: boolean
}) {
  const { t, i18n } = useTranslation(BELL_NAMESPACES)
  const markRead = useMarkNotificationRead()
  const dismissed = useDismissNotification()
  const Icon = SEVERITY_ICON[row.severity]

  const when = new Intl.DateTimeFormat(i18n.language === 'rw' ? 'rw-RW' : 'en-RW', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(row.createdAt))

  const sentence = t(toI18nKey(row.messageKey), {
    ...translateParams(row.messageParams, (key) => t(key)),
    // A notification written by a module this build does not carry strings for still says
    // something, rather than showing a dotted key at a reader.
    defaultValue: t(`notifications:type.${row.type}`),
  })

  return (
    <li
      className={cn('flex items-start gap-2 px-3 py-2.5', row.readAt === null && 'bg-primary-50')}
    >
      <Icon
        aria-hidden="true"
        className={cn('mt-0.5 size-4 shrink-0', SEVERITY_COLOUR[row.severity])}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink">{sentence}</p>
        <p className="mt-0.5 text-xs text-ink-muted">
          {t(`notifications:type.${row.type}`)} · {when}
        </p>
        {row.actionUrl ? (
          <Link
            to={row.actionUrl}
            onClick={() => {
              // Opening the thing it is about is the same as having read it.
              if (row.readAt === null) markRead.mutate(row.id)
            }}
            className="mt-1 inline-block text-sm text-primary-600 hover:underline"
          >
            {t('notifications:actions.open')}
          </Link>
        ) : null}
      </div>
      {showDismiss ? (
        <button
          type="button"
          aria-label={t('notifications:actions.dismiss')}
          onClick={() => dismissed.mutate(row.id)}
          disabled={dismissed.isPending}
          className="rounded p-1 text-ink-muted hover:bg-surface-subtle hover:text-ink"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      ) : null}
    </li>
  )
}
