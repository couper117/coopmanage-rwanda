import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useApiError } from '@/hooks/useApiErrorMessage'
import { saveFile } from '@/lib/saveFile'
import { useAuthStore } from '@/stores/authStore'
import {
  archiveDocument,
  downloadDocument,
  fetchDocument,
  fetchDocumentOptions,
  formatFileSize,
  listDocuments,
  previewDocument,
  restoreDocument,
  updateDocument,
  uploadDocument,
  type DocumentFilters,
  type DocumentRow,
  type UpdateDocumentInput,
  type UploadDocumentInput,
} from './documents.api'

/**
 * Server state for documents.
 *
 * Keyed under the cooperative, like every other feature, so switching tenant cannot show the
 * previous cooperative's papers out of cache. Mutations invalidate the whole namespace rather than
 * patching a row: archiving a document changes the working list, the archived list and the counts
 * at once.
 */
export const documentKeys = {
  all: ['documents'] as const,
  scope: (cooperativeId: string | null) => ['documents', cooperativeId] as const,
  list: (cooperativeId: string | null, filters: DocumentFilters) =>
    ['documents', cooperativeId, 'list', filters] as const,
  one: (cooperativeId: string | null, id: string | undefined) =>
    ['documents', cooperativeId, 'one', id] as const,
  options: (cooperativeId: string | null) => ['documents', cooperativeId, 'options'] as const,
}

function useCooperativeId(): string | null {
  return useAuthStore((state) => state.activeCooperativeId)
}

export function useDocumentsList(filters: DocumentFilters) {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: documentKeys.list(cooperativeId, filters),
    queryFn: () => listDocuments(filters),
    enabled: cooperativeId !== null,
  })
}

export function useDocument(id: string | undefined) {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: documentKeys.one(cooperativeId, id),
    queryFn: () => fetchDocument(id as string),
    enabled: cooperativeId !== null && typeof id === 'string',
  })
}

export function useDocumentOptions(enabled: boolean) {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: documentKeys.options(cooperativeId),
    queryFn: fetchDocumentOptions,
    enabled: enabled && cooperativeId !== null,
    // The accepted types change when the server changes, which is a deployment, not a session.
    staleTime: 60 * 60 * 1000,
  })
}

function useDocumentMutation<TInput, TResult>(fn: (input: TInput) => Promise<TResult>) {
  const client = useQueryClient()
  const cooperativeId = useCooperativeId()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: documentKeys.scope(cooperativeId) })
    },
  })
}

export function useUploadDocument() {
  return useDocumentMutation((input: UploadDocumentInput) => uploadDocument(input))
}

export function useUpdateDocument() {
  return useDocumentMutation((input: { id: string; changes: UpdateDocumentInput }) =>
    updateDocument(input.id, input.changes),
  )
}

export function useArchiveDocument() {
  return useDocumentMutation((input: { id: string; reason: string }) =>
    archiveDocument(input.id, input.reason),
  )
}

export function useRestoreDocument() {
  return useDocumentMutation((input: { id: string }) => restoreDocument(input.id))
}

/** Downloads a document and hands it to the browser. */
export function useDownloadDocument() {
  return useMutation({
    mutationFn: (row: DocumentRow) => downloadDocument(row),
    onSuccess: saveFile,
  })
}

/**
 * Fetches a document's bytes for showing in the page, and revokes the object URL afterwards.
 *
 * A document has no URL of its own — every byte comes through an authenticated request — so a
 * preview means holding a blob and making a temporary URL for it. That URL pins the file in memory
 * until it is revoked, so the effect revokes the previous one whenever the preview changes and the
 * cleanup revokes the last one when the component goes away. A cooperative flicking through twenty
 * scanned certificates would otherwise hold all twenty.
 */
export function useDocumentPreview(row: DocumentRow | null) {
  const [state, setState] = useState<{ key: string; url: string | null; failed: boolean }>({
    key: '',
    url: null,
    failed: false,
  })

  const key = row && row.canPreview ? row.id : ''

  useEffect(() => {
    if (key === '') return

    let objectUrl: string | null = null
    let cancelled = false

    void previewDocument(row as DocumentRow)
      .then(({ blob }) => {
        if (cancelled) return
        if (typeof URL.createObjectURL !== 'function') return
        objectUrl = URL.createObjectURL(blob)
        setState({ key, url: objectUrl, failed: false })
      })
      .catch(() => {
        if (!cancelled) setState({ key, url: null, failed: true })
      })

    return () => {
      cancelled = true
      if (objectUrl && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(objectUrl)
    }
    // `row` is read inside, but the effect is keyed on the document's identity: a refetch that
    // returns an equal row with a new object identity must not refetch the bytes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // Derived rather than stored: a preview belonging to a different document is simply not this
  // one's, so there is no state to clear when the dialog moves on. Clearing it in the effect was
  // what made this a cascading render.
  if (state.key !== key) return { url: null, failed: false }
  return { url: state.url, failed: state.failed }
}

export function useDocumentsError() {
  return useApiError()
}

/** A file size in the reader's language: `2.4 MB`, `812 KB`. */
export function useFileSize(): (bytes: string) => string {
  const { t } = useTranslation('documents')
  return useCallback(
    (bytes: string) => {
      const { unit, size } = formatFileSize(bytes)
      return t(`sizes.${unit}`, { size })
    },
    [t],
  )
}
