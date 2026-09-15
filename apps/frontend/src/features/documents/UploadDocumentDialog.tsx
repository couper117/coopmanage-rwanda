import { useRef, useState } from 'react'
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
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_VISIBILITIES,
  formatFileSize,
  type DocumentCategory,
  type DocumentRow,
  type DocumentVisibility,
} from './documents.api'
import {
  useDocumentOptions,
  useDocumentsError,
  useFileSize,
  useUploadDocument,
} from './documents.hooks'

/**
 * Adding a document.
 *
 * Not React Hook Form, unlike every other form in this application, and the reason is the file
 * input. A file input cannot be controlled — a browser will not let a page set its value, for
 * obvious reasons — so the one field that matters here is held by the DOM and read from a ref at
 * submit. Wrapping that in a form library would mean pretending to control something that cannot
 * be controlled, so the four text fields are plain state instead.
 *
 * The accepted types come from the server rather than being listed here, so the hint a member of
 * staff reads is the same list the upload will actually be checked against.
 */
export function UploadDocumentDialog({
  open,
  onOpenChange,
  onDone,
  memberId,
  meetingId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: (notice: string) => void
  /** Preselected when the dialog is opened from a member's or a meeting's own screen. */
  memberId?: string
  meetingId?: string
}) {
  const { t } = useTranslation(['documents', 'common'])
  const describeError = useDocumentsError()
  const fileSize = useFileSize()

  const options = useDocumentOptions(open)
  const upload = useUploadDocument()
  const fileInput = useRef<HTMLInputElement>(null)

  // Initial state rather than a reset effect: the page mounts this dialog only while it is open,
  // so opening it is a fresh mount and there is nothing to clear. A failed upload therefore keeps
  // what was typed — the reader corrects the file without filling the form in again.
  const [chosen, setChosen] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<DocumentCategory>(
    meetingId ? 'MEETING_MINUTES' : 'OTHER',
  )
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<DocumentVisibility>('COOPERATIVE')
  const [tags, setTags] = useState('')
  const [missingFile, setMissingFile] = useState(false)

  const categoryOptions: SelectOption[] = (options.data?.categories ?? DOCUMENT_CATEGORIES).map(
    (value) => ({ value, label: t(`documents:category.${value}`) }),
  )
  const visibilityOptions: SelectOption[] = DOCUMENT_VISIBILITIES.map((value) => ({
    value,
    label: t(`documents:visibility.${value}`),
  }))

  const accept = (options.data?.extensions ?? []).map((extension) => `.${extension}`).join(',')
  const extensionList = (options.data?.extensions ?? []).join(', ')

  function submit(): void {
    const file = chosen
    if (!file) {
      setMissingFile(true)
      return
    }

    upload.mutate(
      {
        file,
        title: title.trim().length > 0 ? title.trim() : file.name,
        category,
        description,
        visibility,
        memberId: memberId ?? '',
        meetingId: meetingId ?? '',
        tags,
      },
      {
        onSuccess: (row: DocumentRow) => {
          onDone(t('documents:notice.uploaded', { title: row.title }))
          onOpenChange(false)
        },
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('documents:upload.title')}
      description={t('documents:upload.description')}
      busy={upload.isPending}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={upload.isPending}
          >
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={submit} disabled={upload.isPending}>
            {upload.isPending ? t('documents:upload.saving') : t('documents:upload.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {upload.isError ? <Alert tone="danger">{describeError(upload.error).message}</Alert> : null}

        <FormField
          label={t('documents:upload.file')}
          hint={t('documents:upload.fileHint', {
            maxMb: 10,
            extensions: extensionList,
          })}
          error={missingFile ? t('documents:upload.file') : undefined}
        >
          <Input
            ref={fileInput}
            type="file"
            accept={accept}
            onChange={(event) => {
              setChosen(event.target.files?.[0] ?? null)
              setMissingFile(false)
            }}
          />
        </FormField>

        {chosen ? (
          <p className="text-sm text-ink-muted">
            {chosen.name} · {fileSize(String(chosen.size))}
          </p>
        ) : null}

        <FormField label={t('documents:upload.titleLabel')}>
          <Input
            value={title}
            placeholder={t('documents:upload.titlePlaceholder')}
            onChange={(event) => setTitle(event.target.value)}
          />
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('documents:upload.categoryLabel')}>
            <Select
              value={category}
              options={categoryOptions}
              onChange={(event) => setCategory(event.target.value as DocumentCategory)}
            />
          </FormField>

          <FormField
            label={t('documents:upload.visibilityLabel')}
            hint={t('documents:upload.visibilityHint')}
          >
            <Select
              value={visibility}
              options={visibilityOptions}
              onChange={(event) => setVisibility(event.target.value as DocumentVisibility)}
            />
          </FormField>
        </div>

        <FormField label={t('documents:upload.descriptionLabel')} optional>
          <Textarea
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </FormField>

        <FormField
          label={t('documents:upload.tagsLabel')}
          hint={t('documents:upload.tagsHint')}
          optional
        >
          <Input
            value={tags}
            placeholder={t('documents:upload.tagsPlaceholder')}
            onChange={(event) => setTags(event.target.value)}
          />
        </FormField>
      </div>
    </Dialog>
  )
}

/** Re-exported so a caller can show a size without reaching into the API module. */
export { formatFileSize }
