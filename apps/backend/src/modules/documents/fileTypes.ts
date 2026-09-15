/**
 * What a cooperative may upload, and how the claim is checked.
 *
 * Three things have to agree before a file is accepted: the **extension** on the name, the
 * **declared MIME type** the client sent, and the **actual first bytes** of the content. Any one of
 * them alone is a claim the uploader controls. A file called `certificate.pdf`, declared as
 * `application/pdf`, whose content begins `MZ` is a Windows executable, and accepting it would put
 * it in a cooperative's document list for a member of staff to download and double-click.
 *
 * SVG is not on the list. It is an image to a user and a script host to a browser, and there is no
 * way to serve one to a cooperative's staff safely enough to be worth it.
 *
 * The list is deliberately short: the papers a Rwandan cooperative actually keeps. A scanned
 * certificate, a photograph of a delivery, a contract, a spreadsheet of figures, a plain-text note.
 * Anything wider is surface with no demand behind it.
 */

export interface FileKind {
  /** Extensions that may carry this content, lower case, without the dot. */
  extensions: readonly string[]
  /** MIME types a browser or a client may legitimately declare for it. */
  mimeTypes: readonly string[]
  /** The MIME type this application stores and serves, whatever was declared. */
  canonicalMime: string
  /** True when the content's own bytes say it is this kind. */
  matches: (bytes: Buffer) => boolean
  /** Safe to show inside the browser rather than only as a download. */
  inlineSafe: boolean
  /** A short name for a log line, in English; a message shown to a user is translated by key. */
  label: string
}

function startsWith(bytes: Buffer, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false
  return signature.every((byte, index) => bytes[index] === byte)
}

/** A ZIP container: `PK\x03\x04`, or the empty and spanned variants. */
function isZip(bytes: Buffer): boolean {
  return (
    startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWith(bytes, [0x50, 0x4b, 0x07, 0x08])
  )
}

/**
 * An Office file is a ZIP, and so is a renamed archive of anything at all.
 *
 * Every OOXML document carries `[Content_Types].xml`, written first so that a reader can find it,
 * so its name appears in the first few hundred bytes. Looking for it is what separates a real
 * `.docx` from an executable somebody put in a zip and renamed — which the ZIP signature alone
 * would have accepted. The part prefix (`word/`, `xl/`) is checked too: a file named `.docx` whose
 * package holds only a spreadsheet is not a document whatever its name says.
 */
function isOoxml(bytes: Buffer, marker: string): boolean {
  if (!isZip(bytes)) return false
  const head = bytes.subarray(0, 4096).toString('latin1')
  return head.includes('[Content_Types].xml') && head.includes(marker)
}

/**
 * Text has no signature, so it is checked the other way round: nothing in it may look like
 * something else.
 *
 * A NUL byte is the giveaway — no text file a cooperative types has one, and every executable
 * format is full of them. The executable headers are refused explicitly as well, because a shell
 * script or a Windows batch file is valid text and would otherwise pass: `.txt` is offered so
 * somebody can keep a note, not so they can keep a program.
 *
 * The content must also be valid UTF-8, so a Kinyarwanda note keeps its apostrophes and a binary
 * that happens to contain no NUL byte does not slip through.
 */
function isPlainText(bytes: Buffer): boolean {
  const head = bytes.subarray(0, 8192)
  if (head.includes(0x00)) return false
  if (isExecutable(bytes)) return false
  return Buffer.compare(Buffer.from(head.toString('utf8'), 'utf8'), head) === 0
}

const SHEBANG = '#!'
const BATCH_HEADER = /^\s*@echo\s+off/i

/**
 * The headers of the formats that run.
 *
 * Checked before anything else, on every upload, whatever the extension claims. This is the test
 * the phase's exit criterion names: a disguised executable is rejected on upload.
 */
export function isExecutable(bytes: Buffer): boolean {
  return (
    // Windows PE and MS-DOS: `MZ`
    startsWith(bytes, [0x4d, 0x5a]) ||
    // ELF, which is Linux and Android
    startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46]) ||
    // Mach-O, 32- and 64-bit, both byte orders
    startsWith(bytes, [0xfe, 0xed, 0xfa, 0xce]) ||
    startsWith(bytes, [0xfe, 0xed, 0xfa, 0xcf]) ||
    startsWith(bytes, [0xce, 0xfa, 0xed, 0xfe]) ||
    startsWith(bytes, [0xcf, 0xfa, 0xed, 0xfe]) ||
    // A Mach-O universal binary, and a Java class file, which share this signature
    startsWith(bytes, [0xca, 0xfe, 0xba, 0xbe]) ||
    // A shell script, and a Windows batch file. Both are text, and both are programs.
    bytes.subarray(0, SHEBANG.length).toString('latin1') === SHEBANG ||
    BATCH_HEADER.test(bytes.subarray(0, 64).toString('latin1'))
  )
}

export const FILE_KINDS: Readonly<Record<string, FileKind>> = {
  pdf: {
    extensions: ['pdf'],
    mimeTypes: ['application/pdf'],
    canonicalMime: 'application/pdf',
    matches: (bytes) => startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]), // %PDF-
    inlineSafe: true,
    label: 'PDF',
  },
  jpeg: {
    extensions: ['jpg', 'jpeg'],
    mimeTypes: ['image/jpeg', 'image/jpg'],
    canonicalMime: 'image/jpeg',
    matches: (bytes) => startsWith(bytes, [0xff, 0xd8, 0xff]),
    inlineSafe: true,
    label: 'JPEG image',
  },
  png: {
    extensions: ['png'],
    mimeTypes: ['image/png'],
    canonicalMime: 'image/png',
    matches: (bytes) => startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    inlineSafe: true,
    label: 'PNG image',
  },
  webp: {
    extensions: ['webp'],
    mimeTypes: ['image/webp'],
    canonicalMime: 'image/webp',
    matches: (bytes) =>
      startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
      bytes.subarray(8, 12).toString('latin1') === 'WEBP',
    inlineSafe: true,
    label: 'WebP image',
  },
  docx: {
    extensions: ['docx'],
    mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    canonicalMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    matches: (bytes) => isOoxml(bytes, 'word/'),
    inlineSafe: false,
    label: 'Word document',
  },
  xlsx: {
    extensions: ['xlsx'],
    mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    canonicalMime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    matches: (bytes) => isOoxml(bytes, 'xl/'),
    inlineSafe: false,
    label: 'Excel workbook',
  },
  csv: {
    extensions: ['csv'],
    mimeTypes: ['text/csv', 'application/csv', 'text/plain'],
    canonicalMime: 'text/csv',
    matches: isPlainText,
    // Served as an attachment even though it is text: a browser rendering a CSV inline is of no use
    // to anybody, and serving `text/*` inline from a user upload is the shape of a stored-XSS bug.
    inlineSafe: false,
    label: 'CSV file',
  },
  txt: {
    extensions: ['txt'],
    mimeTypes: ['text/plain'],
    canonicalMime: 'text/plain',
    matches: isPlainText,
    inlineSafe: false,
    label: 'text file',
  },
}

export const ALLOWED_EXTENSIONS: readonly string[] = Object.values(FILE_KINDS).flatMap(
  (kind) => kind.extensions,
)

/**
 * The extension of a filename, with any path an uploader put in front of it discarded.
 *
 * A browser sends the base name, but a scripted client can send anything, so
 * `../../etc/passwd.pdf` has to become `pdf` and nothing else. The name is kept only as metadata;
 * it never builds a path.
 */
export function extensionOf(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

/**
 * The filename as it is stored: the base name only, cleaned, length capped.
 *
 * A control character in a filename is how a line break gets into a `Content-Disposition` header,
 * and a double quote is how the filename parameter gets closed early — both are header injection
 * through a field the uploader controls. A 4,000-character name is how a list view gets broken.
 * None of these is a normal upload and none needs to be refused outright: the name is metadata, so
 * it is cleaned and kept, and the download header quotes what is left.
 */
export function safeFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? ''
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f";]/g, '').trim()
  return cleaned.length > 0 ? cleaned.slice(0, 200) : 'document'
}

export type RejectionReason =
  'empty' | 'extension' | 'mimeMismatch' | 'contentMismatch' | 'executable'

export type FileCheck =
  | { ok: true; kind: FileKind; extension: string; fileName: string }
  | { ok: false; reason: RejectionReason; extension: string }

/**
 * Decides whether a file may be stored.
 *
 * The order is the point. The executable check runs **first**, on the content, before the extension
 * is even looked at — so a `.pdf` holding a Windows binary is refused as an executable rather than
 * reaching the PDF signature check and being refused for a vaguer reason. Then the extension has to
 * be one this application accepts, the declared type has to be one that extension can legitimately
 * carry, and the content's own bytes have to agree with both.
 */
export function checkFile(input: {
  fileName: string
  declaredMime: string
  bytes: Buffer
}): FileCheck {
  const extension = extensionOf(input.fileName)

  if (input.bytes.length === 0) return { ok: false, reason: 'empty', extension }
  if (isExecutable(input.bytes)) return { ok: false, reason: 'executable', extension }

  const kind = Object.values(FILE_KINDS).find((candidate) =>
    candidate.extensions.includes(extension),
  )
  if (!kind) return { ok: false, reason: 'extension', extension }

  const declared = input.declaredMime.split(';')[0]?.trim().toLowerCase() ?? ''
  if (!kind.mimeTypes.includes(declared)) {
    return { ok: false, reason: 'mimeMismatch', extension }
  }

  if (!kind.matches(input.bytes)) {
    return { ok: false, reason: 'contentMismatch', extension }
  }

  return { ok: true, kind, extension, fileName: safeFileName(input.fileName) }
}
