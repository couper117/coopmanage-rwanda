import { RotateCcw, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Alert, Button } from '@/components/ui'

/**
 * "You were in the middle of this."
 *
 * A stored draft is offered rather than applied. A form that quietly fills itself with yesterday's
 * half-typed entry is worse than an empty one, because somebody submits it without reading — and a
 * sale with the wrong buyer on it is harder to undo than a sale that had to be typed twice.
 *
 * So: one line saying a draft exists, a button that takes it up, and a button that throws it away.
 * Both are explicit, and nothing happens until one is pressed.
 */
export function DraftNotice({
  onRestore,
  onDiscard,
}: {
  onRestore: () => void
  onDiscard: () => void
}) {
  const { t } = useTranslation('common')

  return (
    <Alert
      tone="info"
      title={t('draft.title')}
      action={
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={<RotateCcw aria-hidden="true" className="size-4" />}
            onClick={onRestore}
          >
            {t('draft.restore')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={<X aria-hidden="true" className="size-4" />}
            onClick={onDiscard}
          >
            {t('draft.discard')}
          </Button>
        </div>
      }
    >
      {t('draft.body')}
    </Alert>
  )
}
