import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  ALLOWED_EXTENSIONS,
  checkFile,
  extensionOf,
  isExecutable,
  safeFileName,
} from '../src/modules/documents/fileTypes.js'

/**
 * The upload gate, tested on its own.
 *
 * This is the phase's exit criterion in unit form: **a disguised executable is rejected on upload**.
 * The integration test proves the endpoint refuses one; this file proves the decision itself is
 * right for every shape the disguise can take, which is far cheaper to cover here than over HTTP.
 *
 * The files are built byte by byte rather than read from fixtures. A test that depends on a real
 * `.docx` on disk is a test that quietly stops checking anything the day somebody tidies the
 * fixtures directory, and a repository holding a real Windows executable for test purposes is a
 * repository that trips somebody's antivirus.
 */

/** Just enough of a PDF for the signature check, which is all the gate reads. */
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('trailer\n%%EOF\n')])
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32),
])
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)])
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP'),
  Buffer.alloc(16),
])

/**
 * A minimal OOXML package: the ZIP signature, then the part names a real one carries in its first
 * local file header. Enough for the gate, which looks for `[Content_Types].xml` and the part
 * prefix rather than unzipping.
 */
function ooxml(part: 'word/' | 'xl/'): Buffer {
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from('\u0014\u0000\u0000\u0000\u0008\u0000'),
    Buffer.from('[Content_Types].xml'),
    Buffer.from(`${part}document.xml`),
    deflateSync(Buffer.from('<xml/>')),
  ])
}

/** A ZIP that is not an Office document: the trick a renamed archive plays. */
const PLAIN_ZIP = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from('\u0014\u0000\u0000\u0000\u0008\u0000'),
  Buffer.from('payload.exe'),
  Buffer.alloc(64),
])

const WINDOWS_EXE = Buffer.concat([
  Buffer.from('MZ'),
  Buffer.alloc(126),
  Buffer.from('PE\u0000\u0000'),
])
const LINUX_ELF = Buffer.concat([Buffer.from([0x7f]), Buffer.from('ELF'), Buffer.alloc(60)])
const MACH_O = Buffer.concat([Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), Buffer.alloc(60)])
const SHELL_SCRIPT = Buffer.from('#!/bin/sh\nrm -rf /\n')
const BATCH_FILE = Buffer.from('@echo off\r\ndel C:\\\\Windows\\\\*.*\r\n')
const JAVA_CLASS = Buffer.concat([Buffer.from([0xca, 0xfe, 0xba, 0xbe]), Buffer.alloc(60)])

const TEXT = Buffer.from('Umusanzu wa Nzeri 2026, y’abanyamuryango bose.\n', 'utf8')
const CSV = Buffer.from('member,amount\nUMU-00001,15000\n', 'utf8')

describe('a disguised executable', () => {
  const disguises = [
    {
      what: 'a Windows executable named .pdf',
      file: 'certificate.pdf',
      mime: 'application/pdf',
      bytes: WINDOWS_EXE,
    },
    {
      what: 'a Linux binary named .pdf',
      file: 'minutes.pdf',
      mime: 'application/pdf',
      bytes: LINUX_ELF,
    },
    { what: 'a macOS binary named .png', file: 'photo.png', mime: 'image/png', bytes: MACH_O },
    { what: 'a Java class named .jpg', file: 'scan.jpg', mime: 'image/jpeg', bytes: JAVA_CLASS },
    {
      what: 'a shell script named .txt',
      file: 'note.txt',
      mime: 'text/plain',
      bytes: SHELL_SCRIPT,
    },
    { what: 'a batch file named .csv', file: 'members.csv', mime: 'text/csv', bytes: BATCH_FILE },
    {
      what: 'a Windows executable named .docx',
      file: 'contract.docx',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: WINDOWS_EXE,
    },
  ]

  for (const disguise of disguises) {
    it(`is refused: ${disguise.what}`, () => {
      const result = checkFile({
        fileName: disguise.file,
        declaredMime: disguise.mime,
        bytes: disguise.bytes,
      })
      expect(result.ok).toBe(false)
      if (result.ok) return
      // Refused *as an executable*, not merely as a type mismatch, because the content check runs
      // first. The person uploading is told what the file actually is.
      expect(result.reason).toBe('executable')
    })
  }

  it('is recognised whatever it is called', () => {
    for (const bytes of [WINDOWS_EXE, LINUX_ELF, MACH_O, SHELL_SCRIPT, BATCH_FILE, JAVA_CLASS]) {
      expect(isExecutable(bytes)).toBe(true)
    }
    for (const bytes of [PDF, PNG, JPEG, WEBP, TEXT, CSV, ooxml('word/')]) {
      expect(isExecutable(bytes)).toBe(false)
    }
  })
})

describe('the three checks', () => {
  it('accepts a file whose name, declared type and content all agree', () => {
    const cases = [
      { file: 'certificate.pdf', mime: 'application/pdf', bytes: PDF, mimeOut: 'application/pdf' },
      { file: 'delivery.JPG', mime: 'image/jpeg', bytes: JPEG, mimeOut: 'image/jpeg' },
      { file: 'store.png', mime: 'image/png', bytes: PNG, mimeOut: 'image/png' },
      { file: 'sacks.webp', mime: 'image/webp', bytes: WEBP, mimeOut: 'image/webp' },
      {
        file: 'contract.docx',
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        bytes: ooxml('word/'),
        mimeOut: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
      {
        file: 'figures.xlsx',
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        bytes: ooxml('xl/'),
        mimeOut: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      { file: 'members.csv', mime: 'text/csv', bytes: CSV, mimeOut: 'text/csv' },
      { file: 'note.txt', mime: 'text/plain', bytes: TEXT, mimeOut: 'text/plain' },
    ]

    for (const candidate of cases) {
      const result = checkFile({
        fileName: candidate.file,
        declaredMime: candidate.mime,
        bytes: candidate.bytes,
      })
      expect(result.ok, candidate.file).toBe(true)
      if (!result.ok) continue
      // The stored type is the canonical one for what the content is, not what the client said.
      expect(result.kind.canonicalMime).toBe(candidate.mimeOut)
    }
  })

  it('refuses an extension this application does not accept', () => {
    for (const name of ['payroll.svg', 'archive.zip', 'database.sql', 'page.html', 'noextension']) {
      const result = checkFile({
        fileName: name,
        declaredMime: 'application/octet-stream',
        bytes: PDF,
      })
      expect(result.ok, name).toBe(false)
      if (!result.ok) expect(result.reason).toBe('extension')
    }
  })

  it('refuses SVG, which is an image to a reader and a script host to a browser', () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    )
    const result = checkFile({ fileName: 'logo.svg', declaredMime: 'image/svg+xml', bytes: svg })
    expect(result.ok).toBe(false)
    expect(ALLOWED_EXTENSIONS).not.toContain('svg')
  })

  it('refuses a declared type the extension cannot carry', () => {
    // The content really is a PNG and the name really says .png, but the client declared it a PDF.
    // Something is wrong with the request and guessing which of the two to believe is not the
    // application's job.
    const result = checkFile({ fileName: 'photo.png', declaredMime: 'application/pdf', bytes: PNG })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('mimeMismatch')
  })

  it('refuses content that does not match its name', () => {
    const result = checkFile({ fileName: 'scan.pdf', declaredMime: 'application/pdf', bytes: PNG })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('contentMismatch')
  })

  it('refuses a renamed archive claiming to be a Word document', () => {
    // The ZIP signature alone would have accepted this. Looking for the OOXML part names is what
    // separates a real document from an executable somebody zipped and renamed.
    const result = checkFile({
      fileName: 'contract.docx',
      declaredMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: PLAIN_ZIP,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('contentMismatch')
  })

  it('refuses a spreadsheet package named as a document', () => {
    const result = checkFile({
      fileName: 'contract.docx',
      declaredMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: ooxml('xl/'),
    })
    expect(result.ok).toBe(false)
  })

  it('refuses an empty file', () => {
    const result = checkFile({
      fileName: 'empty.pdf',
      declaredMime: 'application/pdf',
      bytes: Buffer.alloc(0),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('empty')
  })

  it('refuses binary content dressed as text', () => {
    // No executable header, but full of NUL bytes: not something anybody typed.
    const binary = Buffer.concat([Buffer.from('report'), Buffer.alloc(200)])
    const result = checkFile({ fileName: 'note.txt', declaredMime: 'text/plain', bytes: binary })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('contentMismatch')
  })

  it('accepts Kinyarwanda text, apostrophes and all', () => {
    const result = checkFile({
      fileName: 'icyemezo.txt',
      declaredMime: 'text/plain',
      bytes: Buffer.from('Imigabane y’abanyamuryango: 1,240.\n', 'utf8'),
    })
    expect(result.ok).toBe(true)
  })

  it('ignores the declared parameters, which a browser is entitled to send', () => {
    const result = checkFile({
      fileName: 'members.csv',
      declaredMime: 'text/csv; charset=utf-8',
      bytes: CSV,
    })
    expect(result.ok).toBe(true)
  })
})

describe('the filename', () => {
  it('keeps only the base name, whatever path was sent with it', () => {
    expect(extensionOf('../../etc/passwd.pdf')).toBe('pdf')
    expect(safeFileName('../../etc/passwd.pdf')).toBe('passwd.pdf')
    expect(safeFileName('C:\\Users\\coop\\contract.docx')).toBe('contract.docx')
  })

  it('strips what would break a Content-Disposition header', () => {
    // A quote closes the filename parameter early and a newline ends the header: both are header
    // injection through a field the uploader controls.
    expect(safeFileName('inv"oice.pdf')).toBe('invoice.pdf')
    expect(safeFileName('note\r\nSet-Cookie: x=1.txt')).toBe('noteSet-Cookie: x=1.txt')
    expect(safeFileName('a;b.pdf')).toBe('ab.pdf')
  })

  it('caps the length and never returns nothing', () => {
    expect(safeFileName(`${'a'.repeat(400)}.pdf`)).toHaveLength(200)
    expect(safeFileName('   ')).toBe('document')
    expect(safeFileName('')).toBe('document')
  })

  it('reads the extension case-insensitively and from the last dot', () => {
    expect(extensionOf('SCAN.PDF')).toBe('pdf')
    expect(extensionOf('minutes.2026.docx')).toBe('docx')
    expect(extensionOf('.hidden')).toBe('')
  })

  it('accepts a file whose name is upper case', () => {
    const result = checkFile({
      fileName: 'CERTIFICATE.PDF',
      declaredMime: 'application/pdf',
      bytes: PDF,
    })
    expect(result.ok).toBe(true)
  })
})
