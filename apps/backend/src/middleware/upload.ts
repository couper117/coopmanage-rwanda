import type { NextFunction, Request, RequestHandler, Response } from 'express'
import multer, { MulterError } from 'multer'
import { env } from '../config/env.js'
import { AppError } from '../lib/errors.js'

/**
 * Receives one uploaded file, in memory.
 *
 * **In memory, deliberately.** The alternative is a temporary file, and a temporary file means the
 * bytes are on disk before anything has looked at them: a window in which a disguised executable
 * exists as a real file on the server, and a path that has to be cleaned up on every failure. The
 * cap is 10 MB by default, so a handful of concurrent uploads is a few tens of megabytes — far
 * cheaper than the bookkeeping, and it lets the content be validated before it is written
 * anywhere.
 *
 * The limits are as tight as the endpoint needs: one file, on one known field, with a small number
 * of accompanying text fields. Multer's defaults allow unlimited files and fields, which is a way
 * to exhaust a process with a request that never gets as far as a permission check.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.MAX_UPLOAD_MB * 1024 * 1024,
    files: 1,
    // The metadata that comes alongside: title, category, description, tags, member, meeting.
    fields: 12,
    fieldSize: 8 * 1024,
    parts: 20,
    headerPairs: 64,
  },
})

/**
 * Turns multer's own failures into the application's errors.
 *
 * Without this a file over the cap reaches the error handler as an unrecognised exception and
 * becomes an opaque 500, which tells a member of staff with a large scan nothing about why it did
 * not work. The two that matter are the size cap and a request carrying a file on a field this
 * endpoint does not expect; anything else multer raises is a malformed multipart body.
 */
function translate(error: unknown): unknown {
  if (!(error instanceof MulterError)) return error

  switch (error.code) {
    case 'LIMIT_FILE_SIZE':
      return AppError.fileTooLarge(env.MAX_UPLOAD_MB)
    case 'LIMIT_FILE_COUNT':
    case 'LIMIT_UNEXPECTED_FILE':
      return AppError.validationFailed([
        { field: 'file', messageKey: 'validation.files.oneFileOnly' },
      ])
    default:
      return AppError.validationFailed([
        { field: 'file', messageKey: 'validation.files.malformedUpload' },
      ])
  }
}

/**
 * Accepts a single file on the `file` field. The route that uses this must still validate the
 * content: this middleware only gets the bytes into memory and enforces the size cap.
 */
export function singleFile(field = 'file'): RequestHandler {
  const handler = upload.single(field)

  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, (error: unknown) => {
      if (error) {
        next(translate(error))
        return
      }
      next()
    })
  }
}
