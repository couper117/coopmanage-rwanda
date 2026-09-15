import { createModuleRouter, permission } from '../../lib/routeRegistry.js'
import { authenticate } from '../../middleware/authenticate.js'
import { requirePermission } from '../../middleware/requirePermission.js'
import { resolveCooperative } from '../../middleware/resolveCooperative.js'
import { singleFile } from '../../middleware/upload.js'
import { validate } from '../../middleware/validate.js'
import * as controller from './documents.controller.js'
import {
  archiveDocumentSchema,
  documentIdSchema,
  downloadDocumentSchema,
  listDocumentsSchema,
  updateDocumentSchema,
  uploadDocumentSchema,
} from './documents.schemas.js'

const module = createModuleRouter('/documents')

const tenant = [authenticate, resolveCooperative] as const

/**
 * The cooperative's documents.
 *
 * There is no `DELETE` here and there will not be one. A document is archived, which takes it out
 * of the working list and records who did it and why; the row and the file both stay, because a
 * registration certificate and a signed contract are the records an auditor asks for years later.
 *
 * `/documents/options` is registered before `/documents/:id`, so it is not read as a document whose
 * identifier is the word "options".
 *
 * The upload runs `singleFile` **after** authentication, the tenant and the permission, so an
 * anonymous request cannot make the server read ten megabytes before refusing it. The order also
 * means the multipart parser only ever runs for a caller who is allowed to upload.
 */
module.get(
  '/',
  permission('documents:view'),
  ...tenant,
  requirePermission('documents:view'),
  validate({ query: listDocumentsSchema }),
  controller.getDocuments,
)

module.get(
  '/options',
  permission('documents:upload'),
  ...tenant,
  requirePermission('documents:upload'),
  controller.getOptions,
)

module.post(
  '/',
  permission('documents:upload'),
  ...tenant,
  requirePermission('documents:upload'),
  singleFile(),
  validate({ body: uploadDocumentSchema }),
  controller.postDocument,
)

module.get(
  '/:id',
  permission('documents:view'),
  ...tenant,
  requirePermission('documents:view'),
  validate({ params: documentIdSchema }),
  controller.getOne,
)

/**
 * The bytes. Never a public URL: this endpoint authenticates, resolves the cooperative, checks the
 * permission and applies the document's own visibility rule before the store is touched.
 */
module.get(
  '/:id/download',
  permission('documents:view'),
  ...tenant,
  requirePermission('documents:view'),
  validate({ params: documentIdSchema, query: downloadDocumentSchema }),
  controller.getDownload,
)

/** Everything except the file. The bytes, the name, the size and the checksum are fixed for good. */
module.patch(
  '/:id',
  permission('documents:upload'),
  ...tenant,
  requirePermission('documents:upload'),
  validate({ params: documentIdSchema, body: updateDocumentSchema }),
  controller.patchDocument,
)

module.post(
  '/:id/archive',
  permission('documents:archive'),
  ...tenant,
  requirePermission('documents:archive'),
  validate({ params: documentIdSchema, body: archiveDocumentSchema }),
  controller.postArchive,
)

module.post(
  '/:id/restore',
  permission('documents:archive'),
  ...tenant,
  requirePermission('documents:archive'),
  validate({ params: documentIdSchema }),
  controller.postRestore,
)

export const documentsRouter = module.router
