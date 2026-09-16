/**
 * What an SMS costs to carry.
 *
 * Shared because both sides need the same answer and a disagreement would be the worst kind: the
 * screen quoting one price as a cooperative types, the server billing another. The interface shows
 * the count beside the field; the server caps a body at four segments and records what was sent.
 *
 * Nothing here talks to a provider. This is arithmetic on the GSM alphabet, and it is the same
 * arithmetic every gateway bills by.
 */

/** The longest body a single GSM message carries. Longer is split by the network and billed twice. */
export const SMS_SINGLE_SEGMENT = 160

/** A segment of a split message, which loses seven characters to the concatenation header. */
const SMS_CONCATENATED_SEGMENT = 153

/** The same two numbers on the 16-bit alphabet, where every character is twice the size. */
const SMS_UNICODE_SINGLE = 70
const SMS_UNICODE_CONCATENATED = 67

/**
 * Whether a body needs the 16-bit alphabet.
 *
 * The GSM 03.38 alphabet covers printable ASCII and a handful of extras, which is enough for
 * Kinyarwanda written with the straight apostrophe this product settled on. One character outside
 * it — a curly apostrophe pasted from a word processor, an accented vowel — switches the **whole**
 * message to the 16-bit alphabet, where a segment holds 70 characters instead of 160. That is why
 * `docs/glossary.md` §8 treats the apostrophe as part of the word rather than as typography: here
 * the wrong one costs a cooperative money.
 *
 * Written as a loop over code points rather than as a regular expression, because the expression
 * would have to hold literal control characters — a tab and a newline inside a character class —
 * which is both unreadable and exactly what `no-control-regex` exists to stop. Tab, newline and
 * carriage return are the three control characters a message may legitimately contain.
 */
export function smsIsUnicode(body: string): boolean {
  for (const character of body) {
    const code = character.codePointAt(0) ?? 0
    const printableAscii = code >= 0x20 && code <= 0x7e
    const allowedWhitespace = code === 0x09 || code === 0x0a || code === 0x0d
    if (!printableAscii && !allowedWhitespace) return true
  }
  return false
}

/** How many segments a body will be billed as. Zero for an empty body: nothing is sent. */
export function smsSegments(body: string): number {
  if (body.length === 0) return 0
  const unicode = smsIsUnicode(body)
  const single = unicode ? SMS_UNICODE_SINGLE : SMS_SINGLE_SEGMENT
  const concatenated = unicode ? SMS_UNICODE_CONCATENATED : SMS_CONCATENATED_SEGMENT
  if (body.length <= single) return 1
  return Math.ceil(body.length / concatenated)
}
