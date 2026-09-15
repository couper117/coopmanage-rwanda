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
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_VISIBILITIES,
  type DocumentCategory,
  type DocumentRow,
  type DocumentVisibility,
} from './documents.api'
import { useDocumentsError, useUpdateDocument } from './documents.hooks'

/**
 * Changing a document's details.
 *
 * Everything except the file. The bytes, the name, the size and the checksum are fixed for good: a
 * document whose content could be swapped while its title and its history stayed the same would
 * let a new file inherit an old one's provenance, which is worse than having no document store. A
 * corrected version is a new upload and this one is archived, which the dialog's own description
 * says so nobody goes looking for a replace button.
 */
/**
 * Mounted only while it is open, so its fields start from the document each time rather than being
 * reset by an effect. A reset effect would also fire on every unrelated re-render of the parent.
 */
export function EditDocumentDialog({
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
  const update = useUpdateDocument()

  const [title, setTitle] = useState(document.title)
  const [category, setCategory] = useState<DocumentCategory>(document.category)
  const [description, setDescription] = useState(document.description ?? '')
  const [visibility, setVisibility] = useState<DocumentVisibility>(document.visibility)
  const [tags, setTags] = useState(document.tags.join(', '))

  const categoryOptions: SelectOption[] = DOCUMENT_CATEGORIES.map((value) => ({
    value,
    label: t(`documents:category.${value}`),
  }))
  const visibilityOptions: SelectOption[] = DOCUMENT_VISIBILITIES.map((value) => ({
    value,
    label: t(`documents:visibility.${value}`),
  }))

  function submit(): void {
    update.mutate(
      {
        id: document.id,
        changes: {
          title: title.trim(),
          category,
          description: description.trim().length > 0 ? description.trim() : null,
          visibility,
          tags: tags
            .split(',')
            .map((tag) => tag.trim())
            .filter((tag) => tag.length > 0)
            .slice(0, 10),
        },
      },
      {
        onSuccess: () => {
          onDone(t('documents:notice.updated'))
          onOpenChange(false)
        },
      },
    )
  }

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={t('documents:edit.title')}
      description={t('documents:edit.description')}
      busy={update.isPending}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={update.isPending}
          >
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={submit} disabled={update.isPending || title.trim().length === 0}>
            {update.isPending ? t('documents:edit.saving') : t('documents:edit.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {update.isError ? <Alert tone="danger">{describeError(update.error).message}</Alert> : null}

        <FormField label={t('documents:upload.titleLabel')}>
          <Input value={title} onChange={(event) => setTitle(event.target.value)} />
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('documents:upload.categoryLabel')}>
            <Select
              value={category}
              options={categoryOptions}
              onChange={(event) => setCategory(event.target.value as DocumentCategory)}
            />
          </FormField>
          <FormField label={t('documents:upload.visibilityLabel')}>
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
          <Input value={tags} onChange={(event) => setTags(event.target.value)} />
        </FormField>
      </div>
    </Dialog>
  )
}
