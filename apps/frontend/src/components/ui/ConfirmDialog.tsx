import { useTranslation } from 'react-i18next'
import { Alert } from './Alert'
import { Button } from './Button'
import { Dialog } from './Dialog'

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The question, phrased so the answer is obvious: "Deactivate Mukamana Chantal?" */
  title: string
  /** What will happen. Never left blank: a confirmation with no consequence is just friction. */
  consequence: string
  confirmLabel: string
  onConfirm: () => void
  busy?: boolean
  tone?: 'danger' | 'primary'
  /** Shown above the buttons when the action failed, so the dialog does not close on an error. */
  error?: string | null
}

/**
 * Reserved for actions that are hard to undo. Deactivating a member of staff, voiding a
 * transaction, cancelling a confirmed sale. Saving a draft or applying a filter is never confirmed,
 * because a dialog on every harmless action trains people to dismiss dialogs without reading them.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  consequence,
  confirmLabel,
  onConfirm,
  busy = false,
  tone = 'danger',
  error = null,
}: ConfirmDialogProps) {
  const { t } = useTranslation('common')

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      width="sm"
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('actions.cancel')}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            loading={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-base text-ink-secondary">{consequence}</p>
      {error ? (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      ) : null}
    </Dialog>
  )
}
