/**
 * Rwandan phone numbers.
 *
 * Staff type these however they are written down: `0788123456`, `+250 788 123 456`,
 * `250-788-123-456`. Rejecting a number because of where the spaces fall would be the software
 * making the cooperative's life harder, which is the opposite of the point. So separators are
 * stripped first and the digits are validated afterwards.
 *
 * Storage is always one canonical form, `+250788123456`, so two records for the same person can
 * never differ only by formatting, and a later SMS integration has nothing to guess.
 *
 * A member's phone number is optional everywhere. This module says whether a number that *was*
 * given is usable; it never says a number is required.
 */

/** Mobile prefixes in service in Rwanda: MTN 078/079, Airtel 072/073, and the 07x range generally. */
const NATIONAL_MOBILE = /^7[0-9]{8}$/

export const RWANDA_DIALLING_CODE = '+250'

function stripSeparators(input: string): string {
  return input.replace(/[\s\-().]/g, '')
}

/**
 * Returns the canonical `+250XXXXXXXXX` form, or null when the input is not a Rwandan mobile
 * number. An empty or whitespace-only string returns null rather than throwing: "not given" and
 * "not valid" are the caller's to distinguish.
 */
export function normalizeRwandanPhone(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null
  const compact = stripSeparators(input)
  if (compact.length === 0) return null

  let national = compact
  if (national.startsWith('+250')) national = national.slice(4)
  else if (national.startsWith('250')) national = national.slice(3)
  else if (national.startsWith('0')) national = national.slice(1)

  if (!NATIONAL_MOBILE.test(national)) return null
  return `${RWANDA_DIALLING_CODE}${national}`
}

export function isRwandanPhone(input: string | null | undefined): boolean {
  return normalizeRwandanPhone(input) !== null
}

/** `+250788123456` becomes `0788 123 456`, which is how it is read aloud and written down. */
export function formatRwandanPhone(stored: string | null | undefined): string {
  const normalized = normalizeRwandanPhone(stored)
  if (!normalized) return ''
  const national = normalized.slice(RWANDA_DIALLING_CODE.length)
  return `0${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6)}`
}
