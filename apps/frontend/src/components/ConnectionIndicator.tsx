import { Wifi, WifiOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { Tooltip } from '@/components/ui'

/**
 * Says plainly what state the connection is in. Cooperatives work on unreliable connections and a
 * silent failure is worse than a visible one.
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

  return (
    <span
      role="status"
      className="flex items-center gap-1.5 rounded-sm border border-warning-line bg-warning-bg px-2 py-1 text-xs font-medium text-warning-fg"
    >
      <WifiOff aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
      {t('connection.offline')}
    </span>
  )
}
