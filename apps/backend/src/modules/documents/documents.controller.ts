import type { Request, Response } from 'express'
import { buildPageMeta, sendCollection, sendData } from '../../lib/envelope.js'
import { AppError } from '../../lib/errors.js'
import { requireContext } from '../../middleware/requirePermission.js'
import {
  archiveDocument,
  documentFormOptions,
  getDocument,
  listDocuments,
  readDocument,
  restoreDocument,
  updateDocument,
  uploadDocument,
} from './documents.service.js'
import type {
  ArchiveDocumentInput,
  DownloadDocumentQuery,
  ListDocumentsQuery,
  UpdateDocumentInput,
  UploadDocumentInput,
} from './documents.schemas.js'

export async function getDocuments(req: Request, res: Response): Promise<void> {
  const query = req.validated?.query as ListDocumentsQuery
  const { items, total } = await listDocuments(requireContext(req), query)
  sendCollection(
    res,
    items,
    buildPageMeta({ page: query.page, pageSize: query.pageSize, total, sort: query.sort }),
  )
}

export function getOptions(_req: Request, res: Response): void {
  sendData(res, documentFormOptions())
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  sendData(res, await getDocument(requireContext(req), id))
}

export async function postDocument(req: Request, res: Response): Promise<void> {
  const input = req.validated?.body as UploadDocumentInput
  const file = req.file

  // No file at all is a validation failure on the field, not a malformed request: somebody
  // submitted the form without choosing a file, and that is what the message should say.
  if (!file) {
    throw AppError.validationFailed([{ field: 'file', messageKey: 'validation.files.required' }])
  }

  sendData(
    res,
    await uploadDocument(
      requireContext(req),
      {
        originalName: file.originalname,
        declaredMime: file.mimetype,
        bytes: file.buffer,
      },
      input,
    ),
    201,
  )
}

export async function patchDocument(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  const changes = req.validated?.body as UpdateDocumentInput
  sendData(res, await updateDocument(requireContext(req), id, changes))
}

export async function postArchive(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  const input = req.validated?.body as ArchiveDocumentInput
  sendData(res, await archiveDocument(requireContext(req), id, input))
}

export async function postRestore(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  sendData(res, await restoreDocument(requireContext(req), id))
}

/**
 * Streams a document's bytes.
 *
 * Every header here is load-bearing.
 *
 * `X-Content-Type-Options: nosniff` stops a browser second-guessing the type and treating a text
 * file as HTML, which is the whole attack that a user-supplied file inline enables.
 * `Content-Security-Policy: sandbox` neutralises a PDF's own scripting when it is previewed.
 * `Content-Disposition` is `attachment` unless the type is one this application will render and the
 * caller asked for a preview, and the filename is quoted with its quotes already stripped by
 * `safeFileName`, so a name cannot close the parameter early and inject another.
 * `Cache-Control: private, no-store` keeps a cooperative's contract out of a shared proxy and off
 * disk on a machine in an internet café.
 *
 * The stream is piped rather than buffered, so a 10 MB scan does not become 10 MB of process
 * memory per concurrent download, and an error part-way through destroys the response instead of
 * completing it with a truncated file.
 */
export async function getDownload(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  const { disposition } = req.validated?.query as DownloadDocumentQuery

  const document = await readDocument(requireContext(req), id, disposition)

  res.setHeader('Content-Type', document.mimeType)
  res.setHeader('Content-Length', document.sizeBytes)
  res.setHeader('Content-Disposition', `${document.disposition}; filename="${document.fileName}"`)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'")
  res.setHeader('Cache-Control', 'private, no-store')

  document.stream.on('error', () => {
    // The headers have already gone, so there is no status left to send. Destroying the response
    // makes the download fail visibly rather than arriving short and looking corrupt.
    res.destroy()
  })

  document.stream.pipe(res)
}
