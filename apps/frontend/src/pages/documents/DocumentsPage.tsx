import { Archive, Download, FileText, Pencil, RotateCcw, Upload } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/PageHeader'
import { LoadError } from '@/components/LoadError'
import {
  Alert,
  Badge,
  Button,
  DataTable,
  EmptyState,
  FormField,
  Input,
  Panel,
  Select,
  type Column,
  type SelectOption,
} from '@/components/ui'
import { usePermission } from '@/features/auth/useSession'
import { ArchiveDocumentDialog } from '@/features/documents/ArchiveDocumentDialog'
import { DocumentDetailDialog } from '@/features/documents/DocumentDetailDialog'
import { EditDocumentDialog } from '@/features/documents/EditDocumentDialog'
import { UploadDocumentDialog } from '@/features/documents/UploadDocumentDialog'
import {
  ARCHIVED_FILTERS,
  DOCUMENT_CATEGORIES,
  DOCUMENT_SORTS,
  EMPTY_DOCUMENT_FILTERS,
  countActiveDocumentFilters,
  type ArchivedFilter,
  type DocumentCategory,
  type DocumentRow,
  type DocumentSort,
} from '@/features/documents/documents.api'
import {
  useDocumentsError,
  useDocumentsList,
  useDownloadDocument,
  useFileSize,
  useRestoreDocument,
} from '@/features/documents/documents.hooks'
import { useDebouncedValue } from '@/features/finance/finance.hooks'

/**
 * The cooperative's filing cabinet.
 *
 * Built around the two things somebody actually comes here to do: find a paper they know exists,
 * and add one they have just scanned. So the search covers the title, the filename and the tags in
 * one field rather than asking which of the three to search, and adding a document is one button
 * rather than a separate screen.
 *
 * There is no delete control anywhere on this page, because there is no delete endpoint. A
 * superseded document is archived with a reason and stays findable behind a filter, because a
 * registration certificate and a signed contract are what an auditor asks for years later.
 *
 * A capitalised translation key would be the easy way to label the archived and sort filters. It is
 * not used: each option's label is looked up by its own key, so a reader of the translation file
 * can see every string the screen can show.
 */

const ARCHIVED_LABELS: Readonly<Record<ArchivedFilter, string>> = {
  exclude: 'archivedExclude',
  only: 'archivedOnly',
  include: 'archivedInclude',
}

const SORT_LABELS: Readonly<Record<DocumentSort, string>> = {
  newest: 'sortNewest',
  oldest: 'sortOldest',
  title: 'sortTitle',
  size: 'sortSize',
}

export function DocumentsPage() {
  const { t } = useTranslation(['documents', 'common'])
  const describeError = useDocumentsError()
  const fileSize = useFileSize()

  const canUpload = usePermission('documents:upload')
  const canArchive = usePermission('documents:archive')

  const [filters, setFilters] = useState(EMPTY_DOCUMENT_FILTERS)
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search)
  const documents = useDocumentsList({ ...filters, q: debounced })

  const [uploading, setUploading] = useState(false)
  const [viewing, setViewing] = useState<DocumentRow | null>(null)
  const [editing, setEditing] = useState<DocumentRow | null>(null)
  const [archiving, setArchiving] = useState<DocumentRow | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const download = useDownloadDocument()
  const restore = useRestoreDocument()

  const rows = documents.data?.items ?? []
  const meta = documents.data?.meta
  const activeFilters = countActiveDocumentFilters({ ...filters, q: debounced })

  const categoryOptions: SelectOption[] = [
    { value: '', label: t('documents:list.filters.allCategories') },
    ...DOCUMENT_CATEGORIES.map((value) => ({ value, label: t(`documents:category.${value}`) })),
  ]
  const archivedOptions: SelectOption[] = ARCHIVED_FILTERS.map((value) => ({
    value,
    label: t(`documents:list.filters.${ARCHIVED_LABELS[value]}`),
  }))
  const sortOptions: SelectOption[] = DOCUMENT_SORTS.map((value) => ({
    value,
    label: t(`documents:list.filters.${SORT_LABELS[value]}`),
  }))

  const columns: Column<DocumentRow>[] = [
    {
      key: 'title',
      header: t('documents:list.columns.title'),
      render: (row) => (
        <div>
          <span className="font-medium text-ink">{row.title}</span>
          <span className="block text-sm text-ink-muted">{row.fileName}</span>
          {row.tags.length > 0 ? (
            <span className="mt-1 flex flex-wrap gap-1">
              {row.tags.map((tag) => (
                <Badge key={tag} tone="neutral">
                  {tag}
                </Badge>
              ))}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'category',
      header: t('documents:list.columns.category'),
      render: (row) => (
        <div className="flex flex-col items-start gap-1">
          <span className="text-sm">{t(`documents:category.${row.category}`)}</span>
          {/* A restricted paper says so in the list, so nobody is surprised that a colleague
              cannot find it. */}
          {row.visibility === 'RESTRICTED' ? (
            <Badge tone="warning">{t('documents:visibilityShort.RESTRICTED')}</Badge>
          ) : null}
          {row.isArchived ? (
            <Badge tone="neutral">{t('documents:list.filters.archived')}</Badge>
          ) : null}
        </div>
      ),
    },
    {
      key: 'size',
      header: t('documents:list.columns.size'),
      align: 'right',
      secondary: true,
      render: (row) => <span className="tabular-nums">{fileSize(row.sizeBytes)}</span>,
    },
    {
      key: 'uploadedBy',
      header: t('documents:list.columns.uploadedBy'),
      secondary: true,
      render: (row) => <span className="text-sm">{row.uploadedBy ?? '—'}</span>,
    },
    {
      key: 'actions',
      header: t('documents:list.columns.actions'),
      align: 'right',
      width: '14rem',
      render: (row) => (
        <div className="flex flex-wrap justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={<Download aria-hidden="true" className="size-4" />}
            onClick={() => download.mutate(row)}
            disabled={download.isPending}
          >
            {t('documents:actions.download')}
          </Button>
          {canUpload && !row.isArchived ? (
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={<Pencil aria-hidden="true" className="size-4" />}
              onClick={() => setEditing(row)}
            >
              {t('documents:actions.edit')}
            </Button>
          ) : null}
          {canArchive && !row.isArchived ? (
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={<Archive aria-hidden="true" className="size-4" />}
              onClick={() => setArchiving(row)}
            >
              {t('documents:actions.archive')}
            </Button>
          ) : null}
          {canArchive && row.isArchived ? (
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={<RotateCcw aria-hidden="true" className="size-4" />}
              onClick={() =>
                restore.mutate(
                  { id: row.id },
                  {
                    onSuccess: () =>
                      setNotice(t('documents:notice.restored', { title: row.title })),
                  },
                )
              }
              disabled={restore.isPending}
            >
              {t('documents:actions.restore')}
            </Button>
          ) : null}
        </div>
      ),
    },
  ]

  const from = meta ? (meta.page - 1) * meta.pageSize + 1 : 0
  const to = meta ? Math.min(meta.page * meta.pageSize, meta.total) : 0

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('documents:title')}
        description={t('documents:description')}
        actions={
          canUpload ? (
            <Button
              leadingIcon={<Upload aria-hidden="true" className="size-4" />}
              onClick={() => setUploading(true)}
            >
              {t('documents:actions.upload')}
            </Button>
          ) : null
        }
      />

      {notice ? (
        <Alert
          tone="success"
          action={
            <Button variant="ghost" size="sm" onClick={() => setNotice(null)}>
              {t('common:actions.close')}
            </Button>
          }
        >
          {notice}
        </Alert>
      ) : null}

      {download.isError ? (
        <Alert tone="danger">{describeError(download.error).message}</Alert>
      ) : null}
      {restore.isError ? <Alert tone="danger">{describeError(restore.error).message}</Alert> : null}

      <Panel title={t('documents:list.filters.search')}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <FormField label={t('documents:list.filters.search')}>
            <Input
              value={search}
              placeholder={t('documents:list.filters.searchPlaceholder')}
              onChange={(event) => {
                setSearch(event.target.value)
                setFilters((current) => ({ ...current, page: 1 }))
              }}
            />
          </FormField>
          <FormField label={t('documents:list.filters.category')}>
            <Select
              value={filters.category}
              options={categoryOptions}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  category: event.target.value as DocumentCategory | '',
                  page: 1,
                }))
              }
            />
          </FormField>
          <FormField label={t('documents:list.filters.archived')}>
            <Select
              value={filters.archived}
              options={archivedOptions}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  archived: event.target.value as ArchivedFilter,
                  page: 1,
                }))
              }
            />
          </FormField>
          <FormField label={t('documents:list.filters.sort')}>
            <Select
              value={filters.sort}
              options={sortOptions}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  sort: event.target.value as DocumentSort,
                  page: 1,
                }))
              }
            />
          </FormField>
        </div>

        {activeFilters > 0 ? (
          <div className="mt-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setFilters(EMPTY_DOCUMENT_FILTERS)
                setSearch('')
              }}
            >
              {t('documents:list.filters.clear')}
            </Button>
          </div>
        ) : null}
      </Panel>

      <Panel flush>
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          caption={t('documents:list.caption')}
          loading={documents.isPending}
          rowMuted={(row) => row.isArchived}
          onRowClick={(row) => setViewing(row)}
          empty={
            <EmptyState
              icon={FileText}
              title={
                filters.archived === 'only'
                  ? t('documents:list.emptyArchived')
                  : t('documents:list.emptyTitle')
              }
              description={t('documents:list.emptyBody')}
            />
          }
          mobileRow={(row) => (
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-ink">{row.title}</span>
                <span className="text-sm text-ink-muted">{fileSize(row.sizeBytes)}</span>
              </div>
              <span className="text-sm text-ink-muted">{row.fileName}</span>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="neutral">{t(`documents:category.${row.category}`)}</Badge>
                {row.isArchived ? (
                  <Badge tone="warning">{t('documents:list.filters.archived')}</Badge>
                ) : null}
              </div>
            </div>
          )}
        />

        {meta && meta.total > 0 && !documents.isPending ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
            <p className="text-sm text-ink-muted">
              {t('documents:pagination.summary', { from, to, total: meta.total })}
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  setFilters((current) => ({ ...current, page: Math.max(1, current.page - 1) }))
                }
                disabled={meta.page <= 1}
              >
                {t('common:actions.previous')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))}
                disabled={meta.page >= meta.totalPages}
              >
                {t('common:actions.next')}
              </Button>
            </div>
          </div>
        ) : null}
      </Panel>

      {documents.isError ? <LoadError error={documents.error} onRetry={documents.refetch} /> : null}

      {/*
        Each dialog is mounted only while it is open. That makes opening one a fresh mount, so its
        fields start from the document rather than being cleared by an effect — which is both
        simpler and what React's own rules prefer.
      */}
      {uploading ? (
        <UploadDocumentDialog open onOpenChange={setUploading} onDone={setNotice} />
      ) : null}

      <DocumentDetailDialog
        document={viewing}
        onOpenChange={(open) => {
          if (!open) setViewing(null)
        }}
      />

      {editing ? (
        <EditDocumentDialog
          document={editing}
          onOpenChange={(open) => {
            if (!open) setEditing(null)
          }}
          onDone={setNotice}
        />
      ) : null}

      {archiving ? (
        <ArchiveDocumentDialog
          document={archiving}
          onOpenChange={(open) => {
            if (!open) setArchiving(null)
          }}
          onDone={setNotice}
        />
      ) : null}
    </div>
  )
}
