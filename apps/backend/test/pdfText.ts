import { inflateSync } from 'node:zlib'

/**
 * Reads the text back out of a PDF this application produced.
 *
 * Written rather than installed. Every PDF-reading library worth using is large, and a report only
 * has to be readable back in tests — shipping a dependency to production for the sake of a test
 * assertion is a poor trade, and one more thing to keep patched on a cooperative's server.
 *
 * It understands exactly as much PDF as pdfkit writes: content streams compressed with Flate, and
 * text shown with `Tj` or `TJ`. pdfkit writes almost everything as an array of hex strings with
 * kerning numbers between them — `[<4d656d626572> 15 <73686970> 0] TJ` is the word "Membership" —
 * so the pieces of one array are joined and the numbers dropped. Bytes are read as Windows-1252,
 * which is what pdfkit encodes a standard font's text in, and that is what makes the Kinyarwanda
 * apostrophe in `imigabane y’abanyamuryango` come back as an apostrophe rather than as a stray
 * byte.
 *
 * Enough to assert that a report printed the figure it was meant to print, that the column headers
 * were repeated on the second page, and that a Kinyarwanda report is actually in Kinyarwanda.
 * It is not a general PDF reader and is used nowhere but in tests.
 */

/** The few Windows-1252 positions that are not Latin-1, which is all pdfkit needs of it. */
const CP1252: Readonly<Record<number, string>> = {
  0x80: '€',
  0x82: '‚',
  0x83: 'ƒ',
  0x84: '„',
  0x85: '…',
  0x86: '†',
  0x87: '‡',
  0x88: 'ˆ',
  0x89: '‰',
  0x8a: 'Š',
  0x8b: '‹',
  0x8c: 'Œ',
  0x8e: 'Ž',
  0x91: '‘',
  0x92: '’',
  0x93: '“',
  0x94: '”',
  0x95: '•',
  0x96: '–',
  0x97: '—',
  0x98: '˜',
  0x99: '™',
  0x9a: 'š',
  0x9b: '›',
  0x9c: 'œ',
  0x9e: 'ž',
  0x9f: 'Ÿ',
}

function decode(bytes: Buffer): string {
  let out = ''
  for (const byte of bytes) out += CP1252[byte] ?? String.fromCharCode(byte)
  return out
}

/** Every Flate content stream in the file, in the order pdfkit wrote them. */
function contentStreams(pdf: Buffer): string[] {
  const text = pdf.toString('latin1')
  const out: string[] = []
  let at = 0

  for (;;) {
    const found = text.indexOf('stream', at)
    if (found === -1) break
    // `stream` is followed by a newline, optionally preceded by a carriage return.
    const body = text[found + 6] === '\r' ? found + 8 : found + 7
    const end = text.indexOf('endstream', body)
    if (end === -1) break
    at = end + 'endstream'.length

    try {
      out.push(inflateSync(pdf.subarray(body, end)).toString('latin1'))
    } catch {
      // Not a Flate stream: an embedded font, or the XMP metadata. Skipped rather than treated as
      // a failure, because a PDF legitimately contains streams that hold no text.
    }
  }
  return out
}

function pieceText(piece: string): string {
  if (piece.startsWith('<')) {
    return decode(Buffer.from(piece.slice(1, -1).replace(/\s+/g, ''), 'hex'))
  }
  const inner = piece.slice(1, -1)
  return decode(
    Buffer.from(
      inner
        .replace(/\\([()\\])/g, '$1')
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, ''),
      'latin1',
    ),
  )
}

/** The strings one content stream draws, one entry per text-showing operator. */
function textOf(stream: string): string[] {
  const out: string[] = []
  const operator =
    /\[((?:<[0-9a-fA-F\s]*>|\((?:[^()\\]|\\.)*\)|[-\d.\s])*)\]\s*TJ|(<[0-9a-fA-F\s]*>|\((?:[^()\\]|\\.)*\))\s*Tj/g

  for (const match of stream.matchAll(operator)) {
    if (match[1] !== undefined) {
      const pieces = [...match[1].matchAll(/<[0-9a-fA-F\s]*>|\((?:[^()\\]|\\.)*\)/g)].map((piece) =>
        pieceText(piece[0]),
      )
      if (pieces.length > 0) out.push(pieces.join(''))
      continue
    }
    if (match[2] !== undefined) out.push(pieceText(match[2]))
  }
  return out
}

/**
 * Each page's strings, in the order they were drawn.
 *
 * The footers are written at the end, after every page has been laid out, which is the only moment
 * the page count is known. pdfkit appends them to the page they belong to, so they come back in
 * the right page here.
 */
export function pdfPages(pdf: Buffer): string[][] {
  return contentStreams(pdf)
    .map(textOf)
    .filter((page) => page.length > 0)
}

/** Everything the document says, flattened, with a form feed between pages. */
export function pdfText(pdf: Buffer): string {
  return pdfPages(pdf)
    .map((page) => page.join('\n'))
    .join('\n\f\n')
}
