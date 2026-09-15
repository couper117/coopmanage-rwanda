import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Button, Dialog, FormField, Textarea } from '@/components/ui'
import type { DocumentRow } from './documents.api'
import { useArchiveDocument, useDocumentsError } from './documents.hooks'

/**
 * Archiving a document.
 *
 * A `Dialog` rather than `ConfirmDialog`, because this confirmation carries a field: the reason is
 * required and stored, and "archived" with nothing beside it is the same unanswerable question at
 * the next audit as a row that simply disappeared. `ConfirmDialog` is for actions where the only
 * input is yes or no.
 *
 * The dismiss button says what keeping the document means rather than "Cancel". On a screen whose
 * action is itself a kind of cancelling, a button labelled "Cancel" beside "Archive it" is
 * ambiguous — the pitfall `docs/glossary.md` §8 records from the contributions ledger.
 */
export function ArchiveDocumentDialog({
  document,
  onOpenChange,
  onDone,
}: {
  document: DocumentRow
  onOpenChange: (open: boolean) => void
  onDone: (notice: string) => void
}) {
  const { t } = useTranslation(['documents', 'common'])
  const describeError = useDocumentsError()
  const archive = useArchiveDocument()

  // Mounted only while it is open, so the field starts empty on every open without a reset effect.
  const [reason, setReason] = useState('')
  const [missing, setMissing] = useState(false)

  function submit(): void {
    const trimmed = reason.trim()
    if (trimmed.length === 0) {
      setMissing(true)
      return
    }
    archive.mutate(
      { id: document.id, reason: trimmed },
      {
        onSuccess: () => {
          onDone(t('documents:notice.archived', { title: document.title }))
          onOpenChange(false)
        },
      },
    )
  }

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={t('documents:archiveDialog.title')}
      description={t('documents:archiveDialog.body')}
      busy={archive.isPending}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={archive.isPending}
          >
            {t('documents:archiveDialog.keep')}
          </Button>
          <Button variant="danger" onClick={submit} disabled={archive.isPending}>
            {t('documents:archiveDialog.confirm')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {archive.isError ? (
          <Alert tone="danger">{describeError(archive.error).message}</Alert>
        ) : null}

        <FormField
          label={t('documents:archiveDialog.reason')}
          error={missing ? 'validation.required' : undefined}
        >
          <Textarea
            rows={3}
            value={reason}
            placeholder={t('documents:archiveDialog.reasonPlaceholder')}
            onChange={(event) => {
              setReason(event.target.value)
              setMissing(false)
            }}
          />
        </FormField>
      </div>
    </Dialog>
  )
}
