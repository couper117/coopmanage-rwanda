import { Download, FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Alert, Badge, Button, Dialog } from '@/components/ui'
import { usePermission } from '@/features/auth/useSession'
import type { DocumentRow } from './documents.api'
import {
  useDocumentPreview,
  useDocumentsError,
  useDownloadDocument,
  useFileSize,
} from './documents.hooks'

/**
 * One document, with a preview where the type allows one.
 *
 * The preview is an object URL over bytes fetched with the session's own headers, because a
 * document has no address of its own — that is the whole point of the storage design. An `<img>`
 * or an `<iframe>` pointed at the API would be sent without the bearer token and the cooperative
 * header and would fail, so the bytes are fetched, held as a blob, and released when the dialog
 * closes.
 *
 * A PDF is shown in an `<iframe>`; the server serves it with `Content-Security-Policy: sandbox`,
 * which neutralises any script the PDF carries. Anything the server will not serve inline says so
 * and offers the download instead, rather than showing an empty frame.
 */
export function DocumentDetailDialog({
  document,
  onOpenChange,
}: {
  document: DocumentRow | null
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation(['documents', 'common'])
  const describeError = useDocumentsError()
  const fileSize = useFileSize()
  const canDownload = usePermission('documents:view')

  const preview = useDocumentPreview(document)
  const download = useDownloadDocument()

  const open = document !== null

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={document?.title ?? ''}
      width="lg"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('documents:actions.close')}
          </Button>
          {canDownload && document ? (
            <Button
              leadingIcon={<Download aria-hidden="true" className="size-4" />}
              onClick={() => download.mutate(document)}
              disabled={download.isPending}
            >
              {t('documents:actions.download')}
            </Button>
          ) : null}
        </>
      }
    >
      {document ? (
        <div className="flex flex-col gap-4">
          {download.isError ? (
            <Alert tone="danger">{describeError(download.error).message}</Alert>
          ) : null}

          {document.isArchived ? (
            <Alert tone="warning">
              {document.archiveReason
                ? t('documents:detail.archivedBecause', { reason: document.archiveReason })
                : t('documents:detail.archived', { when: document.archivedAt ?? '' })}
            </Alert>
          ) : null}

          <dl className="grid gap-3 sm:grid-cols-2">
            <Detail label={t('documents:detail.fileName')} value={document.fileName} />
            <Detail label={t('documents:detail.size')} value={fileSize(document.sizeBytes)} />
            <Detail
              label={t('documents:list.columns.category')}
              value={t(`documents:category.${document.category}`)}
            />
            <Detail
              label={t('documents:upload.visibilityLabel')}
              value={t(`documents:visibilityShort.${document.visibility}`)}
            />
            <Detail label={t('documents:detail.uploadedBy')} value={document.uploadedBy} />
            <Detail label={t('documents:detail.member')} value={document.memberName} />
            <Detail label={t('documents:detail.meeting')} value={document.meetingTitle} />
            <Detail label={t('documents:detail.notes')} value={document.description} />
          </dl>

          {document.tags.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-ink-muted">{t('documents:detail.tags')}</span>
              {document.tags.map((tag) => (
                <Badge key={tag} tone="neutral">
                  {tag}
                </Badge>
              ))}
            </div>
          ) : null}

          <div>
            <p className="text-sm text-ink-muted">{t('documents:detail.checksum')}</p>
            {/*
              Shown in full and breakable, so somebody can compare it against a checksum they
              computed on their own copy. A truncated hash would be decoration.
            */}
            <p className="mt-0.5 break-all font-mono text-xs text-ink">{document.checksumSha256}</p>
            <p className="mt-0.5 text-xs text-ink-muted">{t('documents:detail.checksumHint')}</p>
          </div>

          {document.canPreview ? (
            <div className="overflow-hidden rounded-md border border-line bg-canvas">
              {preview.failed ? (
                <p className="p-4 text-sm text-ink-muted">
                  {t('documents:detail.previewUnavailable')}
                </p>
              ) : preview.url ? (
                document.mimeType === 'application/pdf' ? (
                  <iframe
                    src={preview.url}
                    title={document.title}
                    className="h-[60vh] w-full"
                    // The server already sends a sandbox policy for the response; this is the
                    // second layer, on the frame itself.
                    sandbox=""
                  />
                ) : (
                  <img src={preview.url} alt={document.title} className="mx-auto max-h-[60vh]" />
                )
              ) : (
                <p className="p-4 text-sm text-ink-muted">{t('common:state.loading')}</p>
              )}
            </div>
          ) : (
            <p className="flex items-center gap-2 rounded-md border border-line bg-canvas p-4 text-sm text-ink-muted">
              <FileText aria-hidden="true" className="size-4" />
              {t('documents:detail.previewUnavailable')}
            </p>
          )}
        </div>
      ) : null}
    </Dialog>
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
