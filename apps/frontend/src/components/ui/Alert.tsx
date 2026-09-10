import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type AlertTone = 'info' | 'success' | 'warning' | 'danger'

const TONES: Record<AlertTone, { box: string; icon: typeof Info }> = {
  info: { box: 'bg-info-bg border-info-line text-info-fg', icon: Info },
  success: { box: 'bg-success-bg border-success-line text-success-fg', icon: CheckCircle2 },
  warning: { box: 'bg-warning-bg border-warning-line text-warning-fg', icon: AlertTriangle },
  danger: { box: 'bg-danger-bg border-danger-line text-danger-fg', icon: XCircle },
}

export interface AlertProps {
  tone?: AlertTone
  title?: ReactNode
  children?: ReactNode
  action?: ReactNode
  className?: string
}

export function Alert({ tone = 'info', title, children, action, className }: AlertProps) {
  const { box, icon: Icon } = TONES[tone]
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-lg border px-3 py-2.5', box, className)}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        {title !== undefined ? <p className="font-medium">{title}</p> : null}
        {children !== undefined ? (
          <div className={cn('text-sm', title !== undefined && 'mt-0.5')}>{children}</div>
        ) : null}
      </div>
      {action !== undefined ? <div className="shrink-0 self-center">{action}</div> : null}
    </div>
  )
}
