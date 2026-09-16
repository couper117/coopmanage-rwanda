import { Wifi, WifiOff, CloudOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { Tooltip } from '@/components/ui'

/**
 * Says plainly what state the connection is in.
 *
 * Cooperatives work on unreliable connections and a silent failure is worse than a visible one.
 * Three states, not two, because "offline" covers two situations that need different behaviour
 * from the person at the keyboard:
 *
 * - **No network at all.** Nothing will work; stop trying and write it on paper.
 * - **The server cannot be reached.** The office wifi is fine and the link out has dropped, which
 *   in a district office is the commoner of the two. What is already on the screen is still good,
 *   and the next attempt may well succeed.
 *
 * When everything is working this is a single quiet icon. The two failing states are a badge with
 * words in it, because a small grey icon is not how you tell somebody their work is not being
 * saved.
 */
export function ConnectionIndicator() {
  const { t } = useTranslation('common')
  const status = useOnlineStatus()

  if (status === 'online') {
    return (
      <Tooltip content={t('connection.online')}>
        <span className="flex items-center gap-1.5 text-xs text-ink-muted">
          <Wifi aria-hidden="true" className="size-4" strokeWidth={1.75} />
          <span className="sr-only">{t('connection.online')}</span>
        </span>
      </Tooltip>
    )
  }

  if (status === 'unreachable') {
    return (
      <Tooltip content={t('connection.unreachableHelp')}>
        <span
          role="status"
          className="flex items-center gap-1.5 rounded-sm border border-warning-line bg-warning-bg px-2 py-1 text-xs font-medium text-warning-fg"
        >
          <CloudOff aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
          {t('connection.unreachable')}
        </span>
      </Tooltip>
    )
  }

  return (
    <Tooltip content={t('connection.offlineHelp')}>
      <span
        role="status"
        className="flex items-center gap-1.5 rounded-sm border border-danger-line bg-danger-bg px-2 py-1 text-xs font-medium text-danger-fg"
      >
        <WifiOff aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
        {t('connection.offline')}
      </span>
    </Tooltip>
  )
}
